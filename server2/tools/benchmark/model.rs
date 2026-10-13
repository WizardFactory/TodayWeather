//! Local measurement schema. Pure validation/statistics, no credential discovery or network.
use serde::{Deserialize, Serialize};

pub fn quantile(values: &[u64], percentile: usize) -> Option<u64> {
    if values.is_empty() || !(1..=100).contains(&percentile) {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    Some(sorted[(sorted.len() * percentile).div_ceil(100) - 1])
}
pub fn loopback(endpoint: &str) -> bool {
    let Ok(u) = endpoint.parse::<reqwest::Url>() else {
        return false;
    };
    u.scheme() == "http"
        && u.host_str() == Some("127.0.0.1")
        && u.port().is_some()
        && u.username().is_empty()
        && u.password().is_none()
        && u.query().is_none()
        && u.fragment().is_none()
        && u.path() == "/"
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub schema: u8,
    pub run_id: String,
    pub s3_endpoint: String,
    pub provider_endpoint: String,
    pub cases: Vec<Case>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Case {
    pub name: String,
    pub workload: String,
    pub mode: String,
    pub selection: String,
    pub clients: usize,
    pub owners: usize,
    pub trials: usize,
    pub revisions: usize,
    pub record_bytes: usize,
    #[serde(default = "one")]
    pub siblings: usize,
    #[serde(default = "complete")]
    pub layout: String,
}
fn one() -> usize {
    1
}
fn complete() -> String {
    "complete".into()
}
fn label(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 48
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}
impl Config {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema != 1
            || !label(&self.run_id)
            || !loopback(&self.s3_endpoint)
            || !loopback(&self.provider_endpoint)
            || self.cases.is_empty()
            || self.cases.len() > 32
        {
            return Err("local configuration");
        }
        let mut names = std::collections::BTreeSet::new();
        let mut samples = 0usize;
        let mut trials = 0usize;
        let mut groups = 0usize;
        let mut fixture_bytes = 0usize;
        let mut catalog_versions = 0usize;
        for c in &self.cases {
            if !label(&c.name)
                || !names.insert(&c.name)
                || !matches!(c.workload.as_str(), "revisions" | "history8")
                || !matches!(
                    c.mode.as_str(),
                    "cold"
                        | "warm"
                        | "provider_data"
                        | "provider_nodata"
                        | "provider_denied"
                        | "provider_error"
                )
                || !matches!(c.selection.as_str(), "targeted" | "latest" | "full_history")
                || !(1..=64).contains(&c.clients)
                || !(1..=16).contains(&c.owners)
                || !(1..=100).contains(&c.trials)
                || !(1..=240).contains(&c.revisions)
                || !(32..=65536).contains(&c.record_bytes)
                || !(1..=2).contains(&c.siblings)
                || !matches!(c.layout.as_str(), "complete" | "orphan" | "partial")
                || (c.layout == "partial" && c.siblings != 2)
                || (c.workload == "history8"
                    && (c.revisions != 1
                        || c.selection != "full_history"
                        || c.mode.starts_with("provider_")))
                || (c.mode.starts_with("provider_")
                    && (c.workload != "revisions"
                        || c.revisions != 1
                        || c.siblings != 1
                        || c.layout != "complete"
                        || c.selection != "latest"))
            {
                return Err("case bounds or incompatible workload");
            }
            samples += c.clients * c.trials;
            trials += c.trials;
            let n = if c.workload == "history8" {
                192
            } else {
                c.revisions
            };
            groups += c.clients * c.trials * n;
            fixture_bytes += c.clients * c.trials * n * c.record_bytes;
            // Conservative bytes for identity catalogs retained at every seed publication.
            let revisions_per_catalog = if c.workload == "history8" {
                24
            } else {
                c.revisions
            };
            catalog_versions +=
                c.clients * c.trials * n * (revisions_per_catalog + 1) * c.siblings * 1200;
        }
        if trials > 128
            || samples > 4096
            || groups > 2048
            || fixture_bytes > 32 * 1024 * 1024
            || catalog_versions > 128 * 1024 * 1024
        {
            return Err("aggregate fixture/sample budget");
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Sample {
    pub trial: usize,
    pub client: usize,
    pub elapsed_us: Option<u64>,
    pub outcome: String,
    pub returned_bytes: usize,
    pub components: Vec<Component>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Component {
    pub elapsed_us: Option<u64>,
    pub outcome: String,
    pub returned_bytes: usize,
}
#[derive(Debug, Serialize)]
pub struct Distribution {
    pub count: usize,
    pub p50_us: Option<u64>,
    pub p95_us: Option<u64>,
    pub p99_us: Option<u64>,
}
impl Distribution {
    pub fn new(v: &[u64]) -> Self {
        Self {
            count: v.len(),
            p50_us: quantile(v, 50),
            p95_us: quantile(v, 95),
            p99_us: quantile(v, 99),
        }
    }
}
#[derive(Debug, Serialize)]
pub struct Summary {
    pub samples: usize,
    pub outcomes: std::collections::BTreeMap<String, usize>,
    pub all_requests: Distribution,
    pub successful_requests: Distribution,
    pub insufficient_for_tail_claim: bool,
    pub success_subset_insufficient_for_tail_claim: bool,
    pub unmeasured_samples: usize,
}
pub fn summarize(samples: &[Sample]) -> Summary {
    let all: Vec<_> = samples.iter().filter_map(|s| s.elapsed_us).collect();
    let ok: Vec<_> = samples
        .iter()
        .filter(|s| s.outcome == "success")
        .filter_map(|s| s.elapsed_us)
        .collect();
    let mut outcomes = std::collections::BTreeMap::new();
    for s in samples {
        *outcomes.entry(s.outcome.clone()).or_insert(0) += 1;
    }
    Summary {
        samples: samples.len(),
        outcomes,
        all_requests: Distribution::new(&all),
        successful_requests: Distribution::new(&ok),
        insufficient_for_tail_claim: all.len() < 100,
        success_subset_insufficient_for_tail_claim: ok.len() < 100,
        unmeasured_samples: samples.len() - all.len(),
    }
}
