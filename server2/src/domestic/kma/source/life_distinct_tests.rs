//! KMA-LIFE-DISTINCT (design revision 3, tests T1-T5): the life read restores each distinct content
//! of a partition once (D1), and an owned UV or pollen acquisition whose content a stored group
//! already holds is not published again (D2). An isolated in-memory S3 stands for the bucket and a
//! provider double answers the life index; the tests run on a paused clock with a wall clock that
//! follows it. No provider or AWS is reached.
use super::*;
use crate::budget::{BudgetError, BudgetObject, BudgetTransport};
use crate::domestic::kma::source::life_live::{LifeSettings, LiveLife, mfds_acquirer};
use crate::domestic::kma::source::observe::DailyAcquirer;
use crate::providers::{
    HttpPublicTransport, ProviderResponse, ProviderTransport, ProviderTransportError, Request,
};
use crate::storage::{
    CatalogTransport, ControlObject, Error, ListPage, Object, ObjectTransport, PreparedRecord,
    WriteCondition,
};
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Mutex;

/// S3 requests of one kind.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Calls {
    catalogs: usize,
    descriptors: usize,
    raw: usize,
    lists: usize,
    puts: usize,
}
/// An isolated in-memory S3: raw objects, conditional control objects, the catalog index and
/// budget objects, with its requests counted. It does no I/O; a control key can stall once (virtual
/// time) and a LIST prefix can wait at a gate the test opens.
#[derive(Clone, Default)]
struct Memory(Arc<Mutex<Objects>>);
#[derive(Default)]
struct Objects {
    raw: BTreeMap<String, Object>,
    control: BTreeMap<String, ControlObject>,
    budgets: BTreeMap<String, Vec<u8>>,
    revision: u64,
    calls: Calls,
    listed: Vec<String>,
    stall: Option<(String, Duration)>,
    hold: Option<(String, Arc<tokio::sync::Semaphore>)>,
    reached: bool,
}
impl Memory {
    fn calls(&self) -> Calls {
        self.0.lock().unwrap().calls
    }
    /// LISTs of the four life-index kinds so far.
    fn life_lists(&self) -> usize {
        let objects = self.0.lock().unwrap();
        objects
            .listed
            .iter()
            .filter(|prefix| {
                LIFE_FAMILIES
                    .iter()
                    .any(|(family, _)| prefix.contains(&format!("/{}/", family.kind())))
            })
            .count()
    }
    /// The next GET of control object `key` takes `delay` more.
    fn stall_next(&self, key: &str, delay: Duration) {
        self.0.lock().unwrap().stall = Some((key.to_owned(), delay));
    }
    /// LISTs under `prefix` wait until the returned gate gets permits.
    fn hold(&self, prefix: &str) -> Arc<tokio::sync::Semaphore> {
        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        self.0.lock().unwrap().hold = Some((prefix.to_owned(), gate.clone()));
        gate
    }
    fn reached(&self) -> bool {
        self.0.lock().unwrap().reached
    }
    /// Lose an object (raw or control).
    fn remove(&self, key: &str) {
        let mut objects = self.0.lock().unwrap();
        assert!(
            objects.raw.remove(key).is_some() || objects.control.remove(key).is_some(),
            "no object {key}"
        );
    }
    /// Replace a raw object's body with bytes that do not decode.
    fn corrupt(&self, key: &str) {
        let mut objects = self.0.lock().unwrap();
        objects.raw.get_mut(key).expect("a raw object").body = b"not a record".to_vec();
    }
}
impl ObjectTransport for Memory {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        let mut objects = self.0.lock().unwrap();
        objects.calls.puts += 1;
        if objects.raw.contains_key(&record.key) {
            return Ok(412);
        }
        let object = Object {
            metadata: record.metadata.clone(),
            length: record.body.len(),
            body: record.body.clone(),
        };
        objects.raw.insert(record.key.clone(), object);
        Ok(200)
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        let objects = self.0.lock().unwrap();
        let object = objects.raw.get(key).ok_or(Error::NotFound)?;
        Ok(Object {
            body: Vec::new(),
            ..object.clone()
        })
    }
    async fn get(&self, key: &str, _: usize) -> Result<Object, Error> {
        let mut objects = self.0.lock().unwrap();
        objects.calls.raw += 1;
        objects.raw.get(key).cloned().ok_or(Error::NotFound)
    }
}
impl CatalogTransport for Memory {
    async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
        let stall = {
            let mut objects = self.0.lock().unwrap();
            match objects.stall.take() {
                Some((stalled, delay)) if stalled == key => Some(delay),
                other => {
                    objects.stall = other;
                    None
                }
            }
        };
        if let Some(delay) = stall {
            tokio::time::sleep(delay).await;
        }
        let mut objects = self.0.lock().unwrap();
        if key.starts_with("index/v2/groups/") {
            objects.calls.descriptors += 1;
        } else {
            objects.calls.catalogs += 1;
        }
        objects.control.get(key).cloned().ok_or(Error::NotFound)
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        let mut objects = self.0.lock().unwrap();
        objects.calls.puts += 1;
        let agrees = match (condition, objects.control.get(key)) {
            (WriteCondition::Absent, None) => true,
            (WriteCondition::Match(etag), Some(current)) => *etag == current.etag,
            _ => false,
        };
        if !agrees {
            return Ok(412);
        }
        objects.revision += 1;
        let etag = format!("\"v{}\"", objects.revision);
        objects.control.insert(
            key.to_owned(),
            ControlObject {
                body: body.to_vec(),
                etag,
                version: None,
            },
        );
        Ok(200)
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        panic!("the life inputs list the catalog index")
    }
}
impl IndexListing for Memory {
    async fn list_index(&self, prefix: &str, _: Option<&str>) -> Result<ListPage, Error> {
        let gate = {
            let mut objects = self.0.lock().unwrap();
            objects.calls.lists += 1;
            objects.listed.push(prefix.to_owned());
            match &objects.hold {
                Some((held, gate)) if prefix.starts_with(held.as_str()) => {
                    let gate = gate.clone();
                    objects.reached = true;
                    Some(gate)
                }
                _ => None,
            }
        };
        if let Some(gate) = gate {
            let _open = gate.acquire().await;
        }
        let objects = self.0.lock().unwrap();
        Ok(ListPage {
            keys: objects
                .control
                .keys()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect(),
            next: None,
        })
    }
}
impl BudgetTransport for Memory {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        let objects = self.0.lock().unwrap();
        objects
            .budgets
            .get(key)
            .cloned()
            .map(|body| BudgetObject {
                body,
                etag: "\"1\"".into(),
            })
            .ok_or(BudgetError::NotFound)
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        let mut objects = self.0.lock().unwrap();
        if matches!(condition, WriteCondition::Absent) && objects.budgets.contains_key(key) {
            return Ok(412);
        }
        objects.budgets.insert(key.into(), body.into());
        Ok(200)
    }
}

/// The wall clock of a test: `base` (ms) plus the virtual time since it was made.
struct Wall {
    base: i64,
    start: Instant,
}
impl Clock for Wall {
    fn now_ms(&self) -> Result<i64, BudgetError> {
        Ok(self.base + self.start.elapsed().as_millis() as i64)
    }
}
impl Wall {
    fn now(&self) -> f64 {
        self.now_ms().unwrap() as f64
    }
}
/// The instant (ms) of a KST date and `HHMM`.
fn kst(date: u32, time: u16) -> u64 {
    crate::history::schedule::to_ms(Publication::new(date, time).unwrap()) as u64
}
/// A wall clock starting at a KST date and `HHMM`.
fn wall_at(date: u32, time: u16) -> Arc<Wall> {
    Arc::new(Wall {
        base: kst(date, time) as i64,
        start: Instant::now(),
    })
}
fn far() -> Instant {
    Instant::now() + Duration::from_secs(60)
}
/// Keeps the KASI capture out of a test.
const HOLD: Duration = Duration::from_secs(3600);
const SECOND: u64 = 1000;
const MINUTE: u64 = 60 * SECOND;

/// The test's life-index areas.
const TEST_AREAS: [&str; 4] = ["1100000000", "1111051500", "2611051000", "4113500000"];
fn area(a: &str) -> f64 {
    a.parse().unwrap()
}
/// One data.go.kr answer page holding `items`.
fn page_body(items: Vec<Value>, n: usize, total: usize) -> Vec<u8> {
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": n, "numOfRows": 1000,
                 "totalCount": total}}}))
    .unwrap()
}
/// The provider's no-data answer.
fn no_data() -> Vec<u8> {
    serde_json::to_vec(
        &json!({"response": {"header": {"resultCode": "03", "resultMsg": "NO_DATA"}}}),
    )
    .unwrap()
}
/// Page `n` of `pages` of a UV answer issued at `issued` (`YYYYMMDDHH`): the areas of that page, with
/// the values of variant `v`.
fn uv_page(issued: &str, v: usize, n: usize, pages: usize) -> Vec<u8> {
    let items = TEST_AREAS
        .iter()
        .enumerate()
        .filter(|(i, _)| i % pages == n - 1)
        .map(|(_, a)| {
            let mut item = json!({"code": "A07_2", "areaNo": a, "date": issued});
            for h in (0..=75).step_by(3) {
                item[format!("h{h}")] = json!(format!("{}", (h + v) % 11));
            }
            item
        })
        .collect();
    page_body(items, n, TEST_AREAS.len())
}
/// A UV acquisition of `pages` pages.
fn uv(issued: &str, v: usize, pages: usize) -> Vec<Vec<u8>> {
    (1..=pages).map(|n| uv_page(issued, v, n, pages)).collect()
}
/// A one-page pollen answer issued at `issued`, with the grades of variant `v` and a day+3.
fn pollen(issued: &str, v: usize) -> Vec<Vec<u8>> {
    let items = TEST_AREAS
        .iter()
        .map(|a| {
            json!({"code": "D07", "areaNo": a, "date": issued, "today": format!("{}", v % 4),
                   "tomorrow": format!("{}", (v + 1) % 4), "dayaftertomorrow": "0",
                   "twodaysaftertomorrow": format!("{}", (v + 2) % 4)})
        })
        .collect();
    vec![page_body(items, 1, TEST_AREAS.len())]
}
/// Publish one acquisition group of `kind` for publication `p` in its partition, as the S13
/// acquirer declares it: page `i` fetched at `fetched[i]`.
async fn store_group(
    store: &CatalogStore<Memory>,
    kind: &str,
    p: Publication,
    fetched: &[u64],
    pages: &[Vec<u8>],
) -> (GroupDeclaration, Vec<RawRecord>) {
    let limits = CatalogLimits::default();
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let record = RawRecord::new(
            DATA_GO_KR,
            kind,
            &all_areas(),
            p.period(),
            fetched[i],
            200,
            "application/json",
            Some(Pagination {
                page: i as u32 + 1,
                pages: n,
                complete: true,
            }),
            page.clone().into(),
            &limits.raw,
        )
        .unwrap();
        members.push(GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![
                CatalogId::for_record(&record.envelope.identity, &p.partition()).unwrap(),
            ],
        });
        records.push(record);
    }
    let declaration = GroupDeclaration::new(members, &limits).unwrap();
    store
        .publish(declaration.clone(), records.clone(), far())
        .await
        .unwrap();
    (declaration, records)
}
/// [`store_group`] completing at `at`, its pages fetched one second apart.
async fn store_at(
    store: &CatalogStore<Memory>,
    kind: &str,
    p: Publication,
    at: u64,
    pages: &[Vec<u8>],
) -> (GroupDeclaration, Vec<RawRecord>) {
    let n = pages.len() as u64;
    let fetched: Vec<u64> = (0..n).map(|i| at - (n - 1 - i) * SECOND).collect();
    store_group(store, kind, p, &fetched, pages).await
}
fn descriptor_key(declaration: &GroupDeclaration) -> String {
    declaration
        .reference(&CatalogLimits::default())
        .unwrap()
        .descriptor_key()
        .unwrap()
}
fn raw_key(record: &RawRecord) -> String {
    record.envelope.identity.object_key().unwrap()
}
fn publication(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn reader(mem: &Memory, store: &Arc<CatalogStore<Memory>>) -> Reader<Memory> {
    Reader {
        transport: mem.clone(),
        store: store.clone(),
    }
}
/// Life inputs over the in-memory S3 that read stored records only.
fn stored_only(
    mem: &Memory,
    store: &Arc<CatalogStore<Memory>>,
    wall: &Arc<Wall>,
) -> LifeInputs<Memory> {
    LifeInputs::build(reader(mem, store), None, (HOLD, HOLD), wall.clone())
}

type Applied = HashSet<(usize, String, u64)>;
type Last = Option<(u64, &'static str, String)>;
/// The oracle: every listed partition of the window restored as before KMA-LIFE-DISTINCT
/// (`Reader::all`: S06 `lookup` of every group of a catalog) and folded as the life read folds
/// (completion, legacy kind name, partition) up to `cut`: the fold, its applied set and the order
/// key of the last applied acquisition.
async fn oracle(reader: &Reader<Memory>, cut: f64) -> Result<(LifeIndex, Applied, Last), String> {
    let from = Publication::new(kst_date(cut - LIFE_LOOKBACK_MS), 0)
        .map(Publication::partition)
        .unwrap_or_default();
    let window = months(cut - LIFE_LOOKBACK_MS, cut);
    let mut found: Vec<(usize, Fetched)> = Vec::new();
    for (k, (family, _)) in LIFE_FAMILIES.iter().enumerate() {
        let parts: Vec<String> = reader
            .partitions(DATA_GO_KR, family.kind(), &all_areas(), &window, far())
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|p| *p >= from)
            .collect();
        let fetched = reader
            .all(DATA_GO_KR, family.kind(), &all_areas(), &parts, far())
            .await
            .map_err(|e| e.to_string())?;
        found.extend(fetched.into_iter().map(|f| (k, f)));
    }
    let order = |(k, f): &(usize, Fetched)| (f.fetched_at_ms, KINDS[*k], f.partition.clone());
    let mut fresh: Vec<(usize, Fetched)> = found
        .into_iter()
        .filter(|(_, f)| f.fetched_at_ms as f64 <= cut)
        .collect();
    fresh.sort_by_key(order);
    let mut fold = LifeIndex::default();
    for (k, f) in &fresh {
        if let Some(items) = life_items(&f.pages) {
            fold.apply(KINDS[*k], f.fetched_at_ms as f64, &items);
        }
    }
    let applied = fresh
        .iter()
        .map(|(k, f)| (*k, f.partition.clone(), f.fetched_at_ms))
        .collect();
    let last = fresh.last().map(order);
    Ok((fold, applied, last))
}
/// The committed life state equals `expected`: rows, every kind's last issuance, the pollen day+3,
/// the applied set and the last applied acquisition.
fn assert_fold(inputs: &LifeInputs<Memory>, expected: &(LifeIndex, Applied, Last), what: &str) {
    assert!(!expected.0.is_empty(), "{what}: a fold with rows");
    let state = inputs.shared.life.lock().unwrap();
    assert_eq!(
        String::from_utf8(state.folded.json().to_bytes()).unwrap(),
        String::from_utf8(expected.0.json().to_bytes()).unwrap(),
        "{what}: rows"
    );
    for kind in KINDS {
        assert_eq!(
            state.folded.last_issued(kind),
            expected.0.last_issued(kind),
            "{what}: last issuance of {kind}"
        );
    }
    for a in TEST_AREAS {
        assert_eq!(
            state.folded.pollen_day3(area(a)),
            expected.0.pollen_day3(area(a)),
            "{what}: day+3 of {a}"
        );
    }
    assert_eq!(state.seen, expected.1, "{what}: applied set");
    assert_eq!(state.last, expected.2, "{what}: last applied");
}
/// The issuances (`lastUpdateDate`) of an area's UV rows in a fold.
fn uv_issued(fold: &LifeIndex, a: &str) -> Vec<String> {
    serde_json::from_slice::<Value>(&fold.by_area(area(a)).to_bytes())
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| d["indexType"] == "ultrv")
        .map(|d| d["lastUpdateDate"].as_str().unwrap().to_owned())
        .collect()
}

/// What a read returns of each acquisition: completion, partition, pages and raw ids, in order.
type Read = Vec<(u64, String, Vec<Vec<u8>>, Vec<String>)>;
fn read_view(fetched: &[Fetched]) -> Read {
    fetched
        .iter()
        .map(|f| {
            let pages = f.pages.iter().map(|p| p.to_vec()).collect();
            (
                f.fetched_at_ms,
                f.partition.clone(),
                pages,
                f.raw_ids.clone(),
            )
        })
        .collect()
}
/// Every listed life-index partition: [`Reader::distinct`] returns what today's restore returns
/// ([`Reader::acquisitions_counted`], S06 `lookup`): the same acquisitions in the same order, with
/// their completions, partitions, pages and raw ids, and the same exclusions.
async fn assert_partitions(reader: &Reader<Memory>, what: &str) {
    for (family, _) in LIFE_FAMILIES {
        let kind = family.kind();
        let parts = reader
            .key_partitions(DATA_GO_KR, kind, &all_areas(), far())
            .await
            .unwrap();
        for p in parts {
            let (want, want_excluded) = reader
                .acquisitions_counted(DATA_GO_KR, kind, &all_areas(), &p, far())
                .await
                .unwrap();
            let (got, got_excluded) = reader
                .distinct(DATA_GO_KR, kind, &all_areas(), &p, far())
                .await
                .unwrap();
            assert_eq!(got_excluded, want_excluded, "{what}: {kind} {p} excluded");
            assert_eq!(read_view(&got), read_view(&want), "{what}: {kind} {p}");
        }
    }
}

// ---- D1: the life read ----

/// T1 (I1, guard): partitions of 1, 5 (then 6) and 30 identical UV acquisitions; distinct UV
/// issuances before and after them; equal completions with different contents of one issuance; a
/// pollen kind; UV acquisitions completing at the 10-day `remove_old` edge and one millisecond
/// after it; an older issuance completing after a newer one. The fold, every last issuance, the
/// pollen day+3, the applied set and the last applied acquisition equal the oracle's after the
/// initial (needed-first and full), an incremental and a full read.
#[tokio::test(start_paused = true)]
async fn the_life_read_folds_as_every_group_restored() {
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let uv_kind = "uv-idx-v5";
    let weeds = "weeds-pollen-v3";
    // UV issued 10-31 12:00: its rows of 10-31 (00:00 UTC) leave once a UV acquisition completes
    // after 11-10 00:00 UTC (09:00 KST).
    store_at(
        &store,
        uv_kind,
        publication(20261031, 1200),
        kst(20261031, 1210),
        &uv("2026103112", 0, 1),
    )
    .await;
    // Distinct issuances before the identical ones.
    store_at(
        &store,
        uv_kind,
        publication(20261110, 0),
        kst(20261110, 10),
        &uv("2026111000", 1, 2),
    )
    .await;
    store_at(
        &store,
        uv_kind,
        publication(20261110, 300),
        kst(20261110, 310),
        &uv("2026111003", 0, 1),
    )
    .await;
    // Five identical acquisitions of 06:00.
    for i in 0..5 {
        store_at(
            &store,
            uv_kind,
            publication(20261110, 600),
            kst(20261110, 610) + i * 10 * MINUTE,
            &uv("2026111006", 0, 2),
        )
        .await;
    }
    // Thirty identical acquisitions of 09:00: the first completes exactly at the edge (the 10-31
    // rows stay), the second a millisecond later (they leave).
    for i in 0..30u64 {
        let at = match i {
            0 => kst(20261110, 900),
            1 => kst(20261110, 900) + 1,
            _ => kst(20261110, 900) + i * MINUTE,
        };
        store_at(
            &store,
            uv_kind,
            publication(20261110, 900),
            at,
            &uv("2026111009", 0, 4),
        )
        .await;
    }
    // The 06:00 issuance acquired again after the 09:00 one.
    store_at(
        &store,
        uv_kind,
        publication(20261110, 600),
        kst(20261110, 940),
        &uv("2026111006", 0, 2),
    )
    .await;
    // 12:00: four contents completing together, ordered by their first pages (V2 and V4 share its
    // fetch instant, so their raw hashes order them); a repetition of the first a millisecond
    // later, and one of V2 after the first cut.
    let p12 = publication(20261110, 1200);
    let done = kst(20261110, 1210);
    for (first, v) in [(40, 3), (30, 6), (20, 2), (20, 4)] {
        store_group(
            &store,
            uv_kind,
            p12,
            &[done - first * SECOND, done],
            &uv("2026111012", v, 2),
        )
        .await;
    }
    store_group(
        &store,
        uv_kind,
        p12,
        &[done - 10 * SECOND, done + 1],
        &uv("2026111012", 3, 2),
    )
    .await;
    store_at(
        &store,
        uv_kind,
        p12,
        kst(20261110, 1240),
        &uv("2026111012", 2, 2),
    )
    .await;
    // Weeds pollen: yesterday's 18:00 issuance and three identical acquisitions of today's 06:00.
    store_at(
        &store,
        weeds,
        publication(20261109, 1800),
        kst(20261109, 1810),
        &pollen("2026110918", 0),
    )
    .await;
    for i in 0..3 {
        store_at(
            &store,
            weeds,
            publication(20261110, 600),
            kst(20261110, 610) + i * 10 * MINUTE,
            &pollen("2026111006", 1),
        )
        .await;
    }
    let inputs = stored_only(&mem, &store, &wall);
    let reader = reader(&mem, &store);
    assert_partitions(&reader, "seeded").await;
    // The initial read: today's partitions and the latest before them first, then the window.
    let cut1 = kst(20261110, 1230) as f64;
    read_life(&inputs.shared, cut1, far()).await.unwrap();
    assert_fold(
        &inputs,
        &oracle(&reader, cut1).await.unwrap(),
        "initial read",
    );
    let full = inputs.shared.life.lock().unwrap().full;
    // Another host's acquisitions in the recent partitions, after the last applied one: an
    // incremental read.
    store_at(
        &store,
        uv_kind,
        p12,
        kst(20261110, 1300),
        &uv("2026111012", 2, 2),
    )
    .await;
    for i in 0..3 {
        store_at(
            &store,
            uv_kind,
            publication(20261110, 1500),
            kst(20261110, 1510) + i * MINUTE,
            &uv("2026111015", 5, 2),
        )
        .await;
    }
    store_at(
        &store,
        weeds,
        publication(20261110, 600),
        kst(20261110, 1330),
        &pollen("2026111006", 1),
    )
    .await;
    let cut2 = kst(20261110, 1530) as f64;
    assert_partitions(&reader, "added").await;
    read_life(&inputs.shared, cut2, far()).await.unwrap();
    assert_eq!(
        inputs.shared.life.lock().unwrap().full,
        full,
        "an incremental read"
    );
    assert_fold(
        &inputs,
        &oracle(&reader, cut2).await.unwrap(),
        "incremental read",
    );
    // An acquisition completed before the last applied one: everything is read again.
    store_at(
        &store,
        uv_kind,
        publication(20261110, 1500),
        kst(20261110, 1505),
        &uv("2026111015", 5, 2),
    )
    .await;
    assert_partitions(&reader, "late").await;
    read_life(&inputs.shared, cut2, far()).await.unwrap();
    assert_ne!(inputs.shared.life.lock().unwrap().full, full, "a full read");
    assert_fold(&inputs, &oracle(&reader, cut2).await.unwrap(), "full read");
}

/// T2 (I2): the first read of today's UV partition holding 1, 10 or 50 identical 4-page
/// acquisitions makes the same descriptor and body GETs: the catalog, then one restore (the catalog
/// again, the descriptor and the four pages).
#[tokio::test(start_paused = true)]
async fn identical_acquisitions_cost_the_first_read_nothing() {
    for n in [1u64, 10, 50] {
        let mem = Memory::default();
        let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
        let wall = wall_at(20261110, 1230);
        for i in 0..n {
            store_at(
                &store,
                "uv-idx-v5",
                publication(20261110, 1200),
                kst(20261110, 1210) + i * SECOND,
                &uv("2026111012", 0, 4),
            )
            .await;
        }
        let before = mem.calls();
        let inputs = stored_only(&mem, &store, &wall);
        read_life(&inputs.shared, wall.now(), far()).await.unwrap();
        let after = mem.calls();
        assert_eq!(
            (
                after.descriptors - before.descriptors,
                after.raw - before.raw
            ),
            (1, 4),
            "{n} identical acquisitions: one descriptor and the four pages"
        );
        assert_eq!(
            after.catalogs - before.catalogs,
            2,
            "{n}: the catalog twice"
        );
        let state = inputs.shared.life.lock().unwrap();
        assert_eq!(state.seen.len(), n as usize, "every acquisition applied");
        assert_eq!(uv_issued(&state.folded, TEST_AREAS[0]), ["2026111012"; 4]);
    }
}

/// T3 (guard): the first acquisition of a content whose descriptor is lost is left out and the
/// next one of that content is read; a different content between them keeps its place, so it
/// applies first, as when every acquisition is read.
#[tokio::test(start_paused = true)]
async fn a_content_whose_first_acquisition_is_lost_is_read_from_the_next() {
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let p = publication(20261110, 1200);
    let done = kst(20261110, 1210);
    // In `lookup` order: A1 (lost) and B completing together, then A2 and A3 repeating A1. B is the
    // first acquisition read, so its content applies, not A's.
    let (a1, _) = store_group(
        &store,
        "uv-idx-v5",
        p,
        &[done - 40 * SECOND, done],
        &uv("2026111012", 1, 2),
    )
    .await;
    store_group(
        &store,
        "uv-idx-v5",
        p,
        &[done - 30 * SECOND, done],
        &uv("2026111012", 2, 2),
    )
    .await;
    store_group(
        &store,
        "uv-idx-v5",
        p,
        &[done - 20 * SECOND, done + 1],
        &uv("2026111012", 1, 2),
    )
    .await;
    store_group(
        &store,
        "uv-idx-v5",
        p,
        &[done - 10 * SECOND, done + 2],
        &uv("2026111012", 1, 2),
    )
    .await;
    mem.remove(&descriptor_key(&a1));
    let reader = reader(&mem, &store);
    let expected = oracle(&reader, wall.now()).await.unwrap();
    assert_eq!(
        expected.1.len(),
        3,
        "the oracle leaves the lost acquisition out"
    );
    assert_partitions(&reader, "a lost first acquisition").await;
    let (_, excluded) = reader
        .distinct(DATA_GO_KR, "uv-idx-v5", &all_areas(), &p.partition(), far())
        .await
        .unwrap();
    assert_eq!(excluded, 1, "counted");
    let inputs = stored_only(&mem, &store, &wall);
    read_life(&inputs.shared, wall.now(), far()).await.unwrap();
    assert_fold(&inputs, &expected, "a lost first acquisition");
}

/// T3 (guard): a corrupt member of the acquisition a content is read from fails the read, as
/// before; so does a partition whose every acquisition is lost (an incomplete catalog).
#[tokio::test(start_paused = true)]
async fn a_corrupt_or_wholly_lost_partition_fails_the_read_as_before() {
    for corrupt in [true, false] {
        let mem = Memory::default();
        let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
        let wall = wall_at(20261110, 1230);
        let p = publication(20261110, 1200);
        let mut groups = Vec::new();
        for i in 0..3 {
            groups.push(
                store_at(
                    &store,
                    "uv-idx-v5",
                    p,
                    kst(20261110, 1210) + i * MINUTE,
                    &uv("2026111012", 0, 2),
                )
                .await,
            );
        }
        if corrupt {
            mem.corrupt(&raw_key(&groups[0].1[1]));
        } else {
            for (declaration, _) in &groups {
                mem.remove(&descriptor_key(declaration));
            }
        }
        let reader = reader(&mem, &store);
        assert!(
            oracle(&reader, wall.now()).await.is_err(),
            "the read failed before"
        );
        let partition = p.partition();
        let before = reader
            .acquisitions_counted(DATA_GO_KR, "uv-idx-v5", &all_areas(), &partition, far())
            .await
            .unwrap_err();
        let now = reader
            .distinct(DATA_GO_KR, "uv-idx-v5", &all_areas(), &partition, far())
            .await
            .unwrap_err();
        assert_eq!(now, before, "corrupt: {corrupt}");
        if !corrupt {
            assert_eq!(now, Error::Corrupt("incomplete catalog"));
        }
        let inputs = stored_only(&mem, &store, &wall);
        let read = read_life(&inputs.shared, wall.now(), far()).await;
        assert!(read.is_err(), "corrupt: {corrupt}: {read:?}");
        assert!(inputs.shared.life.lock().unwrap().refreshed.is_none());
    }
}

/// T3 (the stated difference, I1): a later acquisition of a content whose own descriptor or page is
/// lost is applied with the pages of the acquisition the content was read from, at its own
/// completion: the fold equals the oracle's while nothing was lost. Here its completion also
/// passes the 10-day edge of the rows issued on 10-31.
#[tokio::test(start_paused = true)]
async fn a_later_acquisition_whose_own_objects_are_lost_is_applied_with_the_read_pages() {
    for lose_descriptor in [true, false] {
        let mem = Memory::default();
        let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
        let wall = wall_at(20261110, 1230);
        store_at(
            &store,
            "uv-idx-v5",
            publication(20261031, 1200),
            kst(20261031, 1210),
            &uv("2026103112", 0, 1),
        )
        .await;
        let p = publication(20261110, 600);
        store_at(
            &store,
            "uv-idx-v5",
            p,
            kst(20261110, 610),
            &uv("2026111006", 0, 2),
        )
        .await;
        let (later, records) = store_at(
            &store,
            "uv-idx-v5",
            p,
            kst(20261110, 905),
            &uv("2026111006", 0, 2),
        )
        .await;
        let reader = reader(&mem, &store);
        let intact = oracle(&reader, wall.now()).await.unwrap();
        if lose_descriptor {
            mem.remove(&descriptor_key(&later));
        } else {
            mem.remove(&raw_key(&records[1]));
        }
        let partition = p.partition();
        let (before, excluded) = reader
            .acquisitions_counted(DATA_GO_KR, "uv-idx-v5", &all_areas(), &partition, far())
            .await
            .unwrap();
        assert_eq!((before.len(), excluded), (1, 1), "before: left out");
        let (now, excluded) = reader
            .distinct(DATA_GO_KR, "uv-idx-v5", &all_areas(), &partition, far())
            .await
            .unwrap();
        assert_eq!((now.len(), excluded), (2, 0), "now: applied");
        assert_eq!(now[1].pages, now[0].pages, "with the pages read");
        assert_eq!(
            now[1].fetched_at_ms,
            kst(20261110, 905),
            "at its own completion"
        );
        let inputs = stored_only(&mem, &store, &wall);
        read_life(&inputs.shared, wall.now(), far()).await.unwrap();
        assert_fold(
            &inputs,
            &intact,
            &format!(
                "a later acquisition without its own {}",
                if lose_descriptor {
                    "descriptor"
                } else {
                    "page"
                }
            ),
        );
    }
}

// ---- D2: an identical acquisition ----

/// What the provider double answers one call: a body after a delay, or never.
#[derive(Clone)]
enum Answer {
    After(Duration, Vec<u8>),
    Never,
}
type Answers = Box<dyn Fn(&str, &str) -> Answer + Send + Sync>;
/// The life provider double: answers by operation and query `time`, and records each call
/// (operation, `time`, virtual instant).
struct Provider {
    answer: Answers,
    calls: Mutex<Vec<(String, String, Instant)>>,
}
impl Provider {
    fn new(answer: impl Fn(&str, &str) -> Answer + Send + Sync + 'static) -> Self {
        Self {
            answer: Box::new(answer),
            calls: Mutex::new(Vec::new()),
        }
    }
}
impl ProviderTransport for Provider {
    async fn send(&self, request: &Request) -> Result<ProviderResponse, ProviderTransportError> {
        let operation = request
            .endpoint
            .path()
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_owned();
        let time = request
            .endpoint
            .query_pairs()
            .find(|(k, _)| k == "time")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        let answer = (self.answer)(&operation, &time);
        self.calls
            .lock()
            .unwrap()
            .push((operation, time, Instant::now()));
        match answer {
            Answer::After(delay, body) => {
                tokio::time::sleep(delay).await;
                Ok(ProviderResponse {
                    status: 200,
                    content_type: "application/json".into(),
                    body,
                })
            }
            Answer::Never => std::future::pending().await,
        }
    }
}
type TestLive = LiveLife<Provider, HttpPublicTransport, Memory, Memory>;
/// The life acquirer of the KMA source over the provider double and the in-memory S3.
fn live(
    mem: &Memory,
    store: &Arc<CatalogStore<Memory>>,
    provider: Provider,
    wall: &Arc<Wall>,
) -> Arc<TestLive> {
    const ROOT: &str = "http://127.0.0.1:9/";
    let provider = Arc::new(provider);
    let daily = DailyAcquirer::new(
        provider.clone(),
        Arc::new(HttpPublicTransport::new(2 << 20).unwrap()),
        Arc::new(mem.clone()),
        vec!["S15B3B_LOCAL_KEY_A+aaaaaaaaaaaaaaaa/=".into()],
        crate::domestic::quota::DataGoKrApi::daily_units,
        crate::domestic::family::Endpoints::new(ROOT, ROOT, ROOT).unwrap(),
        wall.clone(),
        Arc::new(crate::domestic::metrics::DomesticMetrics::default()),
    )
    .unwrap();
    let mfds = mfds_acquirer::<Provider, Memory>(provider, wall.clone()).unwrap();
    Arc::new(LiveLife::new(
        LifeSettings::default(),
        Arc::new(daily),
        Arc::new(mfds),
        mem.clone(),
        store.clone(),
    ))
}
/// The acquirer of the life inputs in a test: UV and pollen through `live`; MFDS and KASI answer
/// nothing, so no other provider is reached.
struct IndexOnly(Arc<TestLive>);
impl LifeAcquire for IndexOnly {
    fn acquire(
        &self,
        request: LifeRequest,
        owner_deadline: Instant,
    ) -> BoxFuture<'static, Result<LifeOutcome, String>> {
        match request {
            LifeRequest::Index(_) => self.0.acquire(request, owner_deadline),
            _ => Box::pin(async { Ok(LifeOutcome::Nothing) }),
        }
    }
}
/// The provider answers today's 12:00 UV with `body` after `after`, and no data otherwise.
fn uv_provider(body: &[u8], after: Duration) -> Provider {
    let body = body.to_vec();
    Provider::new(move |operation, time| {
        if operation == "getUVIdxV5" && time == "2026111012" {
            Answer::After(after, body.clone())
        } else {
            Answer::After(Duration::ZERO, no_data())
        }
    })
}

/// T4 (D2): a UV acquisition whose content another host stored after this process read S3 is not
/// published: no PUT, no own publication, and the request that waited answers with its records.
/// The next request within the memo reads nothing, and the records stay over the fold until a read
/// of S3 applies the stored group.
#[tokio::test(start_paused = true)]
async fn an_identical_acquisition_is_not_published_and_answers_at_once() {
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let slot = publication(20261110, 1200);
    let body = uv_page("2026111012", 0, 1, 1);
    let live = live(
        &mem,
        &store,
        uv_provider(&body, Duration::from_secs(2)),
        &wall,
    );
    let inputs = LifeInputs::build(
        reader(&mem, &store),
        Some(Arc::new(IndexOnly(live))),
        (HOLD, HOLD),
        wall.clone(),
    );
    // The process read S3 before another host stored today's 12:00 UV.
    read_life(&inputs.shared, wall.now(), far()).await.unwrap();
    let twin_at = kst(20261110, 1210);
    store_at(
        &store,
        "uv-idx-v5",
        slot,
        twin_at,
        std::slice::from_ref(&body),
    )
    .await;
    let (puts, lists) = (mem.calls().puts, mem.life_lists());
    let first = inputs
        .load(wall.now(), Instant::now() + Duration::from_millis(2700))
        .await;
    assert_eq!(
        uv_issued(&first.life, TEST_AREAS[0]),
        ["2026111012"; 4],
        "answered at once"
    );
    assert_eq!(mem.calls().puts, puts, "nothing published");
    assert_eq!(
        inputs.shared.published.load(Ordering::Acquire),
        0,
        "no own publication"
    );
    {
        let state = inputs.shared.life.lock().unwrap();
        assert_eq!(state.own.len(), 1, "kept over the fold");
        assert!(
            matches!(&state.own[0].3, Held::Stored(twin) if *twin == (0, slot.partition(), twin_at)),
            "until a read applies the stored group"
        );
    }
    let second = inputs
        .load(wall.now(), Instant::now() + Duration::from_millis(2700))
        .await;
    assert_eq!(uv_issued(&second.life, TEST_AREAS[0]), ["2026111012"; 4]);
    assert_eq!(
        mem.life_lists(),
        lists,
        "no life read after the identical acquisition"
    );
    // A read of S3 that applies the stored group takes the records out of the overlay.
    read_life(&inputs.shared, wall.now(), far()).await.unwrap();
    let state = inputs.shared.life.lock().unwrap();
    assert!(state.seen.contains(&(0, slot.partition(), twin_at)));
    assert!(state.own.is_empty(), "the stored group holds it");
    assert_eq!(uv_issued(&state.folded, TEST_AREAS[0]), ["2026111012"; 4]);
}

/// T4 (D2, design review DL-stored-overlay): a refresh that began before another host stored the
/// twin and commits after the identical acquisition did not apply the twin, so the acquisition's
/// records stay over its fold; the next read that applies the twin takes them out.
#[tokio::test(start_paused = true)]
async fn a_refresh_without_the_stored_group_keeps_the_identical_acquisition() {
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let slot = publication(20261110, 1200);
    let body = uv_page("2026111012", 0, 1, 1);
    let live = live(
        &mem,
        &store,
        uv_provider(&body, Duration::from_secs(2)),
        &wall,
    );
    let acquire: Arc<dyn LifeAcquire> = Arc::new(IndexOnly(live));
    let inputs = LifeInputs::build(
        reader(&mem, &store),
        Some(acquire.clone()),
        (HOLD, HOLD),
        wall.clone(),
    );
    read_life(&inputs.shared, wall.now(), far()).await.unwrap();
    // A refresh lists the families before the twin is stored and waits at the oak listing.
    let gate = mem.hold("index/v2/data-go-kr/oak-pollen-v3/");
    let shared = inputs.shared.clone();
    let cut = wall.now() + 60_000.;
    let refresh = tokio::spawn(async move { read_life(&shared, cut, far()).await });
    for _ in 0..1000 {
        if mem.reached() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    assert!(mem.reached(), "the refresh listed the families");
    let twin_at = kst(20261110, 1210);
    store_at(
        &store,
        "uv-idx-v5",
        slot,
        twin_at,
        std::slice::from_ref(&body),
    )
    .await;
    let puts = mem.calls().puts;
    let request = DataGoKrRequest::new(DataGoKrFamily::UvIdxV5, Target::AllAreas, slot).unwrap();
    let answered = inputs
        .flight(
            acquire,
            format!("uv-{}", slot.compact()),
            vec![LifeRequest::Index(request)],
            Settle::Never,
            Instant::now() + Duration::from_secs(5),
        )
        .await;
    assert!(answered, "the request uses the acquisition");
    assert_eq!(mem.calls().puts, puts, "nothing published");
    gate.add_permits(1 << 20);
    refresh.await.unwrap().unwrap();
    {
        let state = inputs.shared.life.lock().unwrap();
        assert!(
            !state.seen.contains(&(0, slot.partition(), twin_at)),
            "the refresh missed the twin"
        );
        assert_eq!(state.own.len(), 1, "so the acquisition stays over its fold");
    }
    assert_eq!(
        uv_issued(&inputs.life_fold(cut), TEST_AREAS[0]),
        ["2026111012"; 4]
    );
    read_life(&inputs.shared, cut, far()).await.unwrap();
    let state = inputs.shared.life.lock().unwrap();
    assert!(state.seen.contains(&(0, slot.partition(), twin_at)));
    assert!(state.own.is_empty(), "applied with the twin");
}

/// The catalog of a UV publication.
fn uv_catalog(p: Publication) -> CatalogId {
    super::super::records::catalog(DATA_GO_KR, "uv-idx-v5", &all_areas(), &p.partition()).unwrap()
}
/// The owned UV acquisition of a slot.
fn uv_request(slot: Publication) -> LifeRequest {
    let request = DataGoKrRequest::new(DataGoKrFamily::UvIdxV5, Target::AllAreas, slot).unwrap();
    LifeRequest::Index(request)
}

/// T4 (D2, design review 2): the needed-first fold of a process's first read is not a committed
/// read. An identical acquisition's records stay over it, although it holds the stored group, until
/// the read commits its applied set.
#[tokio::test(start_paused = true)]
async fn the_needed_first_fold_does_not_take_an_identical_acquisition_out() {
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let slot = publication(20261110, 1200);
    let body = uv_page("2026111012", 0, 1, 1);
    // Today's slot stored by another host; of two earlier days, the latest is read with today's
    // and the older one after the needed-first fold.
    let twin_at = kst(20261110, 1210);
    store_at(
        &store,
        "uv-idx-v5",
        slot,
        twin_at,
        std::slice::from_ref(&body),
    )
    .await;
    for date in [20261104, 20261105] {
        let issued = format!("{date}12");
        store_at(
            &store,
            "uv-idx-v5",
            publication(date, 1200),
            kst(date, 1210),
            &uv(&issued, 0, 1),
        )
        .await;
    }
    let live = live(
        &mem,
        &store,
        uv_provider(&body, Duration::from_secs(2)),
        &wall,
    );
    let acquire: Arc<dyn LifeAcquire> = Arc::new(IndexOnly(live));
    let inputs = LifeInputs::build(
        reader(&mem, &store),
        Some(acquire.clone()),
        (HOLD, HOLD),
        wall.clone(),
    );
    // The acquisition before any read: S3 holds its content.
    let key = format!("uv-{}", slot.compact());
    let until = Instant::now() + Duration::from_secs(5);
    assert!(
        inputs
            .flight(acquire, key, vec![uv_request(slot)], Settle::Never, until)
            .await
    );
    assert_eq!(inputs.shared.life.lock().unwrap().own.len(), 1);
    // The first read; the older day's catalog stalls after the needed-first fold.
    mem.stall_next(
        &uv_catalog(publication(20261104, 1200)).key(),
        Duration::from_secs(30),
    );
    let shared = inputs.shared.clone();
    let cut = wall.now();
    let read = tokio::spawn(async move { read_life(&shared, cut, far()).await });
    for _ in 0..10_000 {
        if !inputs.shared.life.lock().unwrap().folded.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    {
        let state = inputs.shared.life.lock().unwrap();
        assert!(
            uv_issued(&state.folded, TEST_AREAS[0]).contains(&"2026111012".to_owned()),
            "the needed-first fold holds the stored group"
        );
        assert!(state.refreshed.is_none(), "before the read commits");
        assert_eq!(
            state.own.len(),
            1,
            "the identical acquisition stays over it"
        );
    }
    read.await.unwrap().unwrap();
    let state = inputs.shared.life.lock().unwrap();
    assert!(state.seen.contains(&(0, slot.partition(), twin_at)));
    assert!(state.own.is_empty(), "the committed read holds it");
}

/// T5 (D2, fail open; T4's identical case for contrast): a complete acquisition is published unless
/// a stored group of its catalog with its content restores completely: another content, no
/// catalog, or the matching group's descriptor or page lost all publish.
#[tokio::test(start_paused = true)]
async fn an_acquisition_without_a_restorable_twin_is_published() {
    for case in [
        "identical",
        "different",
        "no catalog",
        "no descriptor",
        "no page",
    ] {
        let mem = Memory::default();
        let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
        let wall = wall_at(20261110, 1230);
        let slot = publication(20261110, 1200);
        let body = uv_page("2026111012", 0, 1, 1);
        let twin_at = kst(20261110, 1210);
        match case {
            "no catalog" => {}
            "different" => {
                let other = uv_page("2026111012", 1, 1, 1);
                store_at(&store, "uv-idx-v5", slot, twin_at, &[other]).await;
            }
            _ => {
                let (declaration, records) = store_at(
                    &store,
                    "uv-idx-v5",
                    slot,
                    twin_at,
                    std::slice::from_ref(&body),
                )
                .await;
                match case {
                    "no descriptor" => mem.remove(&descriptor_key(&declaration)),
                    "no page" => mem.remove(&raw_key(&records[0])),
                    _ => {}
                }
            }
        }
        let live = live(
            &mem,
            &store,
            uv_provider(&body, Duration::from_secs(2)),
            &wall,
        );
        let request = uv_request(slot);
        let owner = Instant::now() + request.owned_for();
        let before = mem.calls();
        let outcome = live.acquire(request, owner).await.unwrap();
        let after = mem.calls();
        let listed = reader(&mem, &store)
            .listed_groups(&uv_catalog(slot), far())
            .await
            .unwrap()
            .len();
        match (case, outcome) {
            ("identical", LifeOutcome::Stored { records, twin }) => {
                assert_eq!(twin, (slot.partition(), twin_at), "the stored group");
                assert_eq!(&records[0].bytes[..], &body[..], "the records acquired");
                assert_eq!(after.puts, before.puts, "nothing published");
                assert_eq!(listed, 1);
            }
            ("identical", outcome) => panic!("identical: {outcome:?}"),
            (_, LifeOutcome::Published(records)) => {
                assert_eq!(&records[0].bytes[..], &body[..]);
                assert!(after.puts > before.puts, "{case}: published");
                assert_eq!(listed, if case == "no catalog" { 1 } else { 2 }, "{case}");
                if matches!(case, "different" | "no catalog") {
                    assert_eq!(
                        after.descriptors, before.descriptors,
                        "{case}: nothing restored"
                    );
                }
            }
            (case, outcome) => panic!("{case}: {outcome:?}"),
        }
    }
}

/// T5 (D2, design review DL-timeout-budget): the provider answers at the end of its time and the
/// check's catalog read stalls: the check gives up at CHECK_BUDGET and the acquisition is
/// published within the owned time, although S3 holds its content.
#[tokio::test(start_paused = true)]
async fn a_stalled_check_is_published_within_the_owned_time() {
    use super::super::life_live::CHECK_BUDGET;
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let slot = publication(20261110, 1200);
    let body = uv_page("2026111012", 0, 1, 1);
    store_at(
        &store,
        "uv-idx-v5",
        slot,
        kst(20261110, 1210),
        std::slice::from_ref(&body),
    )
    .await;
    let request = uv_request(slot);
    let answered = request.provider_time() - Duration::from_millis(1);
    let live = live(&mem, &store, uv_provider(&body, answered), &wall);
    mem.stall_next(&uv_catalog(slot).key(), Duration::from_secs(60));
    let started = Instant::now();
    let owner = started + request.owned_for();
    let outcome = tokio::time::timeout_at(owner, live.acquire(request, owner))
        .await
        .expect("within the owned time")
        .unwrap();
    assert!(matches!(outcome, LifeOutcome::Published(_)), "{outcome:?}");
    let took = started.elapsed();
    assert!(
        took >= answered + CHECK_BUDGET,
        "the check ran to its bound: {took:?}"
    );
    let listed = reader(&mem, &store)
        .listed_groups(&uv_catalog(slot), far())
        .await
        .unwrap();
    assert_eq!(listed.len(), 2, "published beside the stored group");
}

/// T5 (D2, design review 2 DL-timeout-budget): UV slot candidates of one flight, owned 600 s (the
/// cap of 5 x 493 s). The 12:00 and 09:00 slots answer no data after 290 s each; the 06:00 slot,
/// whose content S3 holds, completes at 590 s, 10 s before the owner deadline: it is published as
/// before, without a check. Completing at 585 s (15 s left) it is checked and not published.
#[tokio::test(start_paused = true)]
async fn a_candidate_completing_near_the_owned_cap_is_published_without_a_check() {
    for (answered, published) in [(590u64, true), (585, false)] {
        let mem = Memory::default();
        let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
        let wall = wall_at(20261110, 1230);
        let p06 = publication(20261110, 600);
        let body = uv_page("2026111006", 0, 1, 1);
        store_at(
            &store,
            "uv-idx-v5",
            p06,
            kst(20261110, 610),
            std::slice::from_ref(&body),
        )
        .await;
        let third = Duration::from_secs(answered - 580);
        let provider = Provider::new(move |operation, time| match (operation, time) {
            ("getUVIdxV5", "2026111012" | "2026111009") => {
                Answer::After(Duration::from_secs(290), no_data())
            }
            ("getUVIdxV5", "2026111006") => Answer::After(third, body.clone()),
            _ => Answer::After(Duration::ZERO, no_data()),
        });
        let live = live(&mem, &store, provider, &wall);
        let acquire: Arc<dyn LifeAcquire> = Arc::new(IndexOnly(live));
        let inputs = LifeInputs::build(
            reader(&mem, &store),
            Some(acquire.clone()),
            (HOLD, HOLD),
            wall.clone(),
        );
        let candidates: Vec<LifeRequest> =
            crate::domestic::publication::uv_slots(wall.now() as i64)
                .unwrap()
                .into_iter()
                .map(uv_request)
                .collect();
        let owned: Duration = candidates.iter().map(LifeRequest::owned_for).sum();
        assert_eq!(
            owned,
            Duration::from_secs(5 * 493),
            "capped at 600 s by the flight"
        );
        let started = Instant::now();
        let until = started + Duration::from_millis(2500);
        let key = "uv-202611101200".to_owned();
        let ready = inputs
            .flight(acquire, key, candidates, Settle::Never, until)
            .await;
        assert!(!ready, "the request does not wait for it");
        tokio::time::sleep_until(started + Duration::from_secs(620)).await;
        let listed = reader(&mem, &store)
            .listed_groups(&uv_catalog(p06), far())
            .await
            .unwrap()
            .len();
        assert_eq!(
            listed,
            if published { 2 } else { 1 },
            "answered at {answered} s"
        );
        assert_eq!(
            inputs.shared.published.load(Ordering::Acquire),
            u64::from(published),
            "answered at {answered} s"
        );
        assert_eq!(
            inputs.shared.life.lock().unwrap().own.len(),
            1,
            "kept over the fold either way"
        );
    }
}

/// T5 (D2, design review 2 DL-timeout-budget): an attempt's provider deadline is its provider time
/// from its start, as before KMA-LIFE-DISTINCT (an index: two 30 s attempts for each of 8 pages,
/// 480 s), whatever the owner deadline; an index's owned time adds CHECK_BUDGET.
#[tokio::test(start_paused = true)]
async fn an_attempt_keeps_the_provider_time_of_before() {
    let slot = publication(20261110, 1200);
    let weeds =
        DataGoKrRequest::new(DataGoKrFamily::WeedsPollenV3, Target::AllAreas, slot).unwrap();
    for request in [uv_request(slot), LifeRequest::Index(weeds)] {
        assert_eq!(request.provider_time(), Duration::from_secs(480));
        assert_eq!(request.owned_for(), Duration::from_secs(480 + 3 + 10));
    }
    let kasi = LifeRequest::RiseSet(RiseSetRequest::new("서울", 20261110).unwrap());
    let mfds = LifeRequest::Mfds(publication(20261110, 1220));
    for request in [kasi, mfds] {
        assert_eq!(request.provider_time(), Duration::from_secs(10));
        assert_eq!(request.owned_for(), Duration::from_secs(20), "unchanged");
    }
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(20261110, 1230);
    let live = live(&mem, &store, Provider::new(|_, _| Answer::Never), &wall);
    for owned in [uv_request(slot).owned_for(), Duration::from_secs(600)] {
        let started = Instant::now();
        let result = live.acquire(uv_request(slot), started + owned).await;
        assert!(result.is_err(), "{result:?}");
        assert_eq!(
            started.elapsed(),
            Duration::from_secs(480),
            "owned {owned:?}"
        );
    }
}
