use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    DataGoKr,
    VisualCrossing,
}
impl Provider {
    pub fn path(self) -> &'static str {
        match self {
            Self::DataGoKr => "data_go_kr",
            Self::VisualCrossing => "visual_crossing",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetPolicy {
    pub provider: Provider,
    pub quota_id: String,
    pub window_id: String,
    pub starts_at_ms: i64,
    pub ends_at_ms: i64,
    pub limit: u64,
    pub block_units: u64,
}
impl BudgetPolicy {
    pub fn validate(&self) -> Result<(), BudgetError> {
        if self.quota_id.len() != 64
            || !self
                .quota_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || self.window_id.is_empty()
            || self.window_id.len() > 64
            || !self
                .window_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            || self.starts_at_ms < 0
            || self.ends_at_ms <= self.starts_at_ms
            || self.limit == 0
            || self.block_units == 0
            || self.block_units > self.limit
        {
            return Err(BudgetError::Invalid("quota policy"));
        }
        Ok(())
    }
    pub fn prefix(&self) -> String {
        format!(
            "budgets/v2/{}/{}/{}/",
            self.provider.path(),
            self.quota_id,
            self.window_id
        )
    }
    pub fn authority_key(&self) -> String {
        format!("{}authority.json", self.prefix())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Authority {
    pub version: u8,
    pub policy: BudgetPolicy,
    pub used: u64,
}
impl Authority {
    pub fn validate(&self, p: &BudgetPolicy) -> Result<(), BudgetError> {
        if self.version != 2 || &self.policy != p || self.used > p.limit {
            return Err(BudgetError::Corrupt("authority policy/floor"));
        }
        p.validate()
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeWitness {
    pub version: u8,
    pub policy: BudgetPolicy,
    pub start: u64,
    pub end: u64,
}
impl RangeWitness {
    pub fn key(&self) -> String {
        format!(
            "{}blocks/{}-{}.json",
            self.policy.prefix(),
            self.start,
            self.end
        )
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetError {
    Invalid(&'static str),
    Corrupt(&'static str),
    Exhausted,
    Contention,
    Unknown,
    Deadline,
    Clock,
    Transport,
    NotFound,
    Status(u16),
}
impl fmt::Display for BudgetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "budget {self:?}")
    }
}
impl std::error::Error for BudgetError {}
/// Calculate an exclusive block end without exceeding the global ceiling.
pub fn grant(policy: &BudgetPolicy, used: u64, maximum: u64) -> Result<u64, BudgetError> {
    policy.validate()?;
    if maximum == 0 || maximum > policy.block_units {
        return Err(BudgetError::Invalid("maximum units"));
    }
    let available = policy
        .limit
        .checked_sub(used)
        .ok_or(BudgetError::Corrupt("authority overflow"))?;
    if available < maximum {
        return Err(BudgetError::Exhausted);
    }
    used.checked_add(available.min(policy.block_units))
        .ok_or(BudgetError::Corrupt("grant overflow"))
}
