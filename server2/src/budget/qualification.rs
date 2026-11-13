//! Optional, preallocated qualification units across all keys and UTC windows.
//! The coordinator prices these units and reserves disjoint process allocations
//! durably before launch. This layer never assumes a free tier or refunds units.
use super::{BudgetError, Provider};
use std::sync::{Mutex, OnceLock};

pub const SETTING: &str = "SERVER2_SHADOW_PROVIDER_UNITS";
struct Allowance {
    initial: [u64; 4],
    left: Mutex<[u64; 4]>,
}
fn index(provider: Provider) -> Option<usize> {
    match provider {
        Provider::VisualCrossing => Some(0),
        Provider::Google => Some(1),
        Provider::GoogleAirQuality => Some(2),
        Provider::OpenWeather => Some(3),
        Provider::DataGoKr | Provider::Kakao | Provider::Waqi => None,
    }
}
impl Allowance {
    fn new(initial: [u64; 4]) -> Self {
        Self {
            initial,
            left: Mutex::new(initial),
        }
    }
    fn admit(&self, provider: Provider, units: u64) -> Result<(), BudgetError> {
        let Some(i) = index(provider) else {
            return Ok(());
        };
        let mut left = self.left.lock().map_err(|_| BudgetError::Exhausted)?;
        left[i] = left[i].checked_sub(units).ok_or(BudgetError::Exhausted)?;
        Ok(())
    }
}
fn parse(value: Option<String>) -> Result<Option<[u64; 4]>, BudgetError> {
    let Some(value) = value else { return Ok(None) };
    let parts: Vec<_> = value.split(',').collect();
    if parts.len() != 4
        || parts
            .iter()
            .any(|v| v.is_empty() || !v.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(BudgetError::Invalid("shadow provider allowance"));
    }
    let mut units = [0; 4];
    for (i, part) in parts.iter().enumerate() {
        units[i] = part
            .parse()
            .map_err(|_| BudgetError::Invalid("shadow provider allowance"))?;
        if units[i] > 1_000_000 {
            return Err(BudgetError::Invalid("shadow provider allowance"));
        }
    }
    Ok(Some(units))
}
static PROCESS: OnceLock<Option<Allowance>> = OnceLock::new();
/// Install before runtime construction. Repeating settings cannot replenish units.
pub fn install_process(var: &dyn Fn(&str) -> Option<String>) -> Result<(), BudgetError> {
    let requested = parse(var(SETTING))?;
    let installed = PROCESS.get_or_init(|| requested.map(Allowance::new));
    if installed.as_ref().map(|a| a.initial) != requested {
        return Err(BudgetError::Invalid(
            "shadow provider allowance already installed",
        ));
    }
    Ok(())
}
pub(crate) fn admit(provider: Provider, units: u64) -> Result<(), BudgetError> {
    if let Some(Some(allowance)) = PROCESS.get()
        && let Err(error) = allowance.admit(provider, units)
    {
        // This is local funding exhaustion, not an HTTP/provider 429 count.
        crate::storage::allowance::observe_rejection(crate::observability::Cause::Quota);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::{BudgetObject, BudgetPolicy, BudgetStore, BudgetTransport, Clock};
    use crate::storage::WriteCondition;
    use std::{sync::Arc, time::Duration};
    use tokio::time::Instant;

    #[test]
    fn strict_optional_provider_units() {
        assert_eq!(parse(None).unwrap(), None);
        assert_eq!(
            parse(Some("0,1,2,1000000".into())).unwrap(),
            Some([0, 1, 2, 1_000_000])
        );
        for bad in [
            "",
            "1,2,3",
            "1,2,3,4,5",
            "-1,0,0,0",
            "1, 2,3,4",
            "1000001,0,0,0",
            "999999999999999999999,0,0,0",
        ] {
            assert!(parse(Some(bad.into())).is_err(), "{bad}");
        }
    }
    #[test]
    fn concurrent_competitors_share_the_last_provider_unit() {
        let a = Arc::new(Allowance::new([1, 2, 3, 4]));
        let tasks: Vec<_> = (0..32)
            .map(|_| {
                let a = a.clone();
                std::thread::spawn(move || a.admit(Provider::VisualCrossing, 1).is_ok())
            })
            .collect();
        assert_eq!(
            tasks
                .into_iter()
                .map(|t| usize::from(t.join().unwrap()))
                .sum::<usize>(),
            1
        );
        assert_eq!(a.admit(Provider::Google, 3), Err(BudgetError::Exhausted));
        a.admit(Provider::Google, 2).unwrap();
    }
    struct Local;
    impl Clock for Local {
        fn now_ms(&self) -> Result<i64, BudgetError> {
            Ok(1000)
        }
    }
    impl BudgetTransport for Local {
        async fn get_budget(&self, _: &str) -> Result<BudgetObject, BudgetError> {
            Err(BudgetError::NotFound)
        }
        async fn put_budget(
            &self,
            _: &str,
            _: &[u8],
            _: &WriteCondition,
        ) -> Result<u16, BudgetError> {
            Ok(200)
        }
    }
    #[tokio::test]
    async fn process_case() {
        let Ok(mode) = std::env::var("SHADOW_PROVIDER_CHILD") else {
            return;
        };
        let vars = |_: &str| {
            if mode == "enabled" {
                Some("2,2,2,2".into())
            } else {
                None
            }
        };
        install_process(&vars).unwrap();
        for provider in [
            Provider::VisualCrossing,
            Provider::Google,
            Provider::GoogleAirQuality,
            Provider::OpenWeather,
            Provider::DataGoKr,
            Provider::Kakao,
            Provider::Waqi,
        ] {
            for attempt in 0..3 {
                // Independent authority/key/window owners cannot reset the process cap.
                let store = BudgetStore::new(
                    Arc::new(Local),
                    BudgetPolicy {
                        provider,
                        quota_id: format!("{attempt:064x}"),
                        window_id: format!("window-{attempt}"),
                        starts_at_ms: 0,
                        ends_at_ms: 10000,
                        limit: 100,
                        block_units: 1,
                    },
                    Arc::new(Local),
                )
                .unwrap();
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut reservation = store.reserve(1, deadline).await.unwrap();
                let blocked = mode == "enabled" && index(provider).is_some() && attempt == 2;
                assert_eq!(
                    reservation.consume(1, deadline).is_err(),
                    blocked,
                    "{provider:?} attempt {attempt}"
                );
                install_process(&vars).unwrap();
            }
        }
        assert!(install_process(&|_| Some("3,3,3,3".into())).is_err());
    }
    #[test]
    fn separate_process_checks_real_reservation_consumption() {
        for mode in ["enabled", "ordinary"] {
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "budget::qualification::tests::process_case",
                    "--nocapture",
                ])
                .env("SHADOW_PROVIDER_CHILD", mode)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stdout)
            );
        }
    }
}
