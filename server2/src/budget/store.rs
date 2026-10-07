use super::{Authority, BudgetError, BudgetPolicy, BudgetTransport, RangeWitness, grant};
use crate::storage::WriteCondition;
use std::sync::{Arc, Mutex as ClockMutex};
use tokio::{
    sync::Mutex,
    time::{Instant, timeout_at},
};

/// Trusted cheap, nonblocking wall-clock observation; deadlines use monotonic Instant.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> Result<i64, BudgetError>;
}
pub struct SystemClock;
impl Clock for SystemClock {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| BudgetError::Clock)?
            .as_millis();
        i64::try_from(n).map_err(|_| BudgetError::Clock)
    }
}
fn check_clock(
    policy: &BudgetPolicy,
    clock: &dyn Clock,
    fence: &ClockMutex<i64>,
) -> Result<(), BudgetError> {
    // Capture the clock while holding the short fence lock: an earlier concurrent
    // observation delayed by scheduling cannot appear to be a clock rollback.
    let mut old = fence.lock().map_err(|_| BudgetError::Clock)?;
    let now = clock.now_ms()?;
    if now < policy.starts_at_ms || now >= policy.ends_at_ms || now < *old {
        return Err(BudgetError::Clock);
    }
    *old = now;
    Ok(())
}
#[derive(Default)]
struct Owned {
    next: u64,
    end: u64,
    floor: u64,
}
/// One live owner's block. Replacement must construct a new store, never restore leftovers.
pub struct BudgetStore<T> {
    transport: Arc<T>,
    policy: Arc<BudgetPolicy>,
    clock: Arc<dyn Clock>,
    fence: Arc<ClockMutex<i64>>,
    owned: Mutex<Owned>,
}
/// No Clone or public constructor. Dropping a reservation never refunds its units.
/// ```compile_fail
/// use server2::budget::Reservation;
/// fn duplicate(permit: Reservation) { let _ = permit.clone(); }
/// ```
pub struct Reservation {
    left: u64,
    policy: Arc<BudgetPolicy>,
    clock: Arc<dyn Clock>,
    fence: Arc<ClockMutex<i64>>,
    deadline: Instant,
}
impl Reservation {
    pub fn units(&self) -> u64 {
        self.left
    }
    pub(crate) fn consume(&mut self, units: u64, deadline: Instant) -> Result<(), BudgetError> {
        if Instant::now() >= self.deadline.min(deadline) {
            return Err(BudgetError::Deadline);
        }
        check_clock(&self.policy, self.clock.as_ref(), &self.fence)?;
        if units == 0 || units > self.left {
            return Err(BudgetError::Exhausted);
        }
        self.left -= units;
        Ok(())
    }
}
impl<T: BudgetTransport> BudgetStore<T> {
    pub fn new(
        transport: Arc<T>,
        policy: BudgetPolicy,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, BudgetError> {
        policy.validate()?;
        Ok(Self {
            transport,
            policy: Arc::new(policy),
            clock,
            fence: Arc::new(ClockMutex::new(-1)),
            owned: Mutex::new(Owned::default()),
        })
    }
    pub fn policy(&self) -> &BudgetPolicy {
        &self.policy
    }
    pub async fn reserve(
        &self,
        maximum: u64,
        deadline: Instant,
    ) -> Result<Reservation, BudgetError> {
        if maximum == 0 || maximum > self.policy.block_units {
            return Err(BudgetError::Invalid("maximum units"));
        }
        if Instant::now() >= deadline {
            return Err(BudgetError::Deadline);
        }
        check_clock(&self.policy, self.clock.as_ref(), &self.fence)?;
        let mut owned = timeout_at(deadline, self.owned.lock())
            .await
            .map_err(|_| BudgetError::Deadline)?;
        check_clock(&self.policy, self.clock.as_ref(), &self.fence)?;
        if owned.end.saturating_sub(owned.next) < maximum {
            // Leftovers are abandoned; the next remotely acknowledged range starts at the authority floor.
            owned.next = 0;
            owned.end = 0;
            let mut granted = false;
            for _ in 0..8 {
                let read = timeout_at(
                    deadline,
                    self.transport.get_budget(&self.policy.authority_key()),
                )
                .await
                .map_err(|_| BudgetError::Deadline)?;
                let (used, condition) = match read {
                    Ok(object) => {
                        let a: Authority = serde_json::from_slice(&object.body)
                            .map_err(|_| BudgetError::Corrupt("authority json"))?;
                        a.validate(&self.policy)?;
                        if a.used < owned.floor {
                            return Err(BudgetError::Corrupt("authority decreased"));
                        }
                        (a.used, WriteCondition::Match(object.etag))
                    }
                    Err(BudgetError::NotFound) if owned.floor == 0 => (0, WriteCondition::Absent),
                    Err(BudgetError::NotFound) => {
                        return Err(BudgetError::Corrupt("authority disappeared"));
                    }
                    Err(e) => return Err(e),
                };
                owned.floor = used;
                let end = grant(&self.policy, used, maximum)?;
                let authority = serde_json::to_vec(&Authority {
                    version: 2,
                    policy: (*self.policy).clone(),
                    used: end,
                })
                .map_err(|_| BudgetError::Invalid("authority json"))?;
                check_clock(&self.policy, self.clock.as_ref(), &self.fence)?;
                let status = timeout_at(
                    deadline,
                    self.transport
                        .put_budget(&self.policy.authority_key(), &authority, &condition),
                )
                .await
                .map_err(|_| BudgetError::Unknown)?
                .map_err(|_| BudgetError::Unknown)?;
                if status == 412 {
                    continue;
                }
                if status != 200 {
                    return Err(if (400..500).contains(&status) && status != 409 {
                        BudgetError::Status(status)
                    } else {
                        BudgetError::Unknown
                    });
                }
                owned.floor = end;
                let witness = RangeWitness {
                    version: 2,
                    policy: (*self.policy).clone(),
                    start: used,
                    end,
                };
                let bytes = serde_json::to_vec(&witness)
                    .map_err(|_| BudgetError::Invalid("witness json"))?;
                check_clock(&self.policy, self.clock.as_ref(), &self.fence)?;
                let status = timeout_at(
                    deadline,
                    self.transport
                        .put_budget(&witness.key(), &bytes, &WriteCondition::Absent),
                )
                .await
                .map_err(|_| BudgetError::Unknown)?
                .map_err(|_| BudgetError::Unknown)?;
                if status != 200 {
                    return Err(if (400..500).contains(&status) && status != 409 {
                        BudgetError::Status(status)
                    } else {
                        BudgetError::Unknown
                    });
                }
                check_clock(&self.policy, self.clock.as_ref(), &self.fence)?;
                if Instant::now() >= deadline {
                    return Err(BudgetError::Deadline);
                }
                owned.next = used;
                owned.end = end;
                granted = true;
                break;
            }
            if !granted {
                return Err(BudgetError::Contention);
            }
        }
        owned.next = owned
            .next
            .checked_add(maximum)
            .ok_or(BudgetError::Corrupt("local range overflow"))?;
        Ok(Reservation {
            left: maximum,
            policy: self.policy.clone(),
            clock: self.clock.clone(),
            fence: self.fence.clone(),
            deadline,
        })
    }
}
