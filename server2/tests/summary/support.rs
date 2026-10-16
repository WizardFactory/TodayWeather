//! Test doubles for S16. TEST ONLY.
#![allow(dead_code)]
use server2::gateway::OrderedJson;
use server2::storage::{Error, ListPage};
use server2::summary::SummaryTransport;
use server2::summary::{InputId, Inputs, Summary, SummaryKey};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Volatile `summary/v2/` objects with create-only PUT and paged LIST.
#[derive(Default)]
pub struct MemorySummaries {
    pub objects: Mutex<BTreeMap<String, Vec<u8>>>,
    pub gets: AtomicUsize,
    pub puts: AtomicUsize,
    pub lists: AtomicUsize,
    /// Every operation fails with a transport error while set.
    pub failing: Mutex<bool>,
    pub page_size: usize,
}
impl MemorySummaries {
    pub fn new() -> Self {
        Self {
            page_size: 2,
            ..Self::default()
        }
    }
    pub fn calls(&self) -> usize {
        self.gets.load(Ordering::SeqCst)
            + self.puts.load(Ordering::SeqCst)
            + self.lists.load(Ordering::SeqCst)
    }
    pub fn keys(&self) -> Vec<String> {
        self.objects.lock().unwrap().keys().cloned().collect()
    }
    pub fn plant(&self, key: &str, body: &[u8]) {
        self.objects
            .lock()
            .unwrap()
            .insert(key.to_owned(), body.to_vec());
    }
    pub fn fail(&self, on: bool) {
        *self.failing.lock().unwrap() = on;
    }
    fn check(&self) -> Result<(), Error> {
        if *self.failing.lock().unwrap() {
            Err(Error::Transport)
        } else {
            Ok(())
        }
    }
}
impl SummaryTransport for MemorySummaries {
    async fn get_summary(&self, key: &str) -> Result<Option<Vec<u8>>, Error> {
        self.gets.fetch_add(1, Ordering::SeqCst);
        self.check()?;
        Ok(self.objects.lock().unwrap().get(key).cloned())
    }
    async fn put_summary(&self, key: &str, body: &[u8]) -> Result<u16, Error> {
        self.puts.fetch_add(1, Ordering::SeqCst);
        self.check()?;
        let mut map = self.objects.lock().unwrap();
        if map.contains_key(key) {
            return Ok(412);
        }
        map.insert(key.to_owned(), body.to_vec());
        Ok(200)
    }
    async fn list_summary(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, Error> {
        self.lists.fetch_add(1, Ordering::SeqCst);
        self.check()?;
        let map = self.objects.lock().unwrap();
        let keys: Vec<String> = map
            .keys()
            .filter(|k| k.starts_with(prefix) && token.is_none_or(|t| k.as_str() > t))
            .cloned()
            .collect();
        let page: Vec<String> = keys.iter().take(self.page_size).cloned().collect();
        let next = (keys.len() > page.len()).then(|| page.last().cloned().unwrap());
        Ok(ListPage { keys: page, next })
    }
}

pub fn s(v: &str) -> OrderedJson {
    OrderedJson::String(v.encode_utf16().collect())
}
pub fn n(v: f64) -> OrderedJson {
    OrderedJson::Number(v)
}
pub fn obj(members: Vec<(&str, OrderedJson)>) -> OrderedJson {
    OrderedJson::Object(
        members
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
/// A `_getDaySummaryList` row as the legacy port emits it.
pub fn day_row(date: &str, hours: f64, ta_max: f64, ta_min: f64) -> OrderedJson {
    obj(vec![
        ("date", s(date)),
        ("lgt", n(0.)),
        ("pty", n(0.)),
        ("reh", n(60.)),
        ("rn1", n(0.)),
        ("sky", n(1.)),
        ("t1d", n((ta_max + ta_min) / 2.)),
        ("wsd", n(1.5)),
        ("taMax", n(ta_max)),
        ("taMin", n(ta_min)),
        ("observationType", s("hourly-summary")),
        ("observationHours", n(hours)),
    ])
}
pub fn input(family: &str, start_ms: i64, end_ms: i64, fetched: u64) -> InputId {
    InputId {
        family: family.into(),
        start_ms,
        end_ms,
        fetched_at_ms: fetched,
        content_sha256: format!("{fetched:064x}"),
    }
}
pub fn town() -> [String; 3] {
    ["서울특별시".into(), "종로구".into(), "청운효자동".into()]
}
pub fn grid_summary(date: u32, ta_max: f64, latest: u64) -> Summary {
    Summary {
        key: SummaryKey::Grid { town: town() },
        date,
        grid: Some((60, 127)),
        values: day_row(&format!("{date:08}"), 24., ta_max, 10.),
        inputs: Inputs::of([&input("ultra-srt-ncst", 0, 0, latest)]),
    }
}
/// KST wall clock as epoch ms.
pub fn kst(date: u32, time: u16) -> f64 {
    server2::history::schedule::to_ms(
        server2::domestic::publication::Publication::new(date, time).unwrap(),
    ) as f64
}
pub fn deadline() -> tokio::time::Instant {
    tokio::time::Instant::now() + std::time::Duration::from_secs(5)
}
