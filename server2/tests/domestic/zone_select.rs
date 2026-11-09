//! KMA-ZONE-NEWEST: the forecast-zone selector (design section 11, AK 2026-11-10) answers from the
//! newest complete stored list. Candidates come from catalog control objects alone, ordered by the
//! fold's key (completion instant, partition, digest of the pages); only the chosen group is
//! restored. An isolated in-memory S3 that counts its LISTs and GETs stands for the bucket, and
//! the S3 source reads it as it reads S3. TEST ONLY: no provider, peer or AWS is reached.
use super::source_s3::{Unreachable, deadline};
use serde_json::json;
use server2::domestic::kma::source::{S3Source, Val, Zones};
use server2::domestic::publication::Publication;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, CatalogTransport, ControlObject, Error,
    GroupDeclaration, GroupMember, ListPage, Object, ObjectTransport, Pagination, Period,
    PreparedRecord, ProviderKey, RawRecord, WriteCondition, sha256,
};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// What the selector read, by kind of object.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Reads {
    /// LIST requests of the catalog index.
    pub lists: usize,
    /// GETs of catalog control objects (`index/v2/<source>/...`).
    pub catalogs: usize,
    /// GETs of fetch-group descriptors (`index/v2/groups/...`).
    pub descriptors: usize,
    /// GETs of raw records (`raw/v2/...`).
    pub raws: usize,
}
/// An isolated in-memory S3: raw objects, conditional control objects and the catalog index, with
/// the reads counted. No I/O and no timer, so a paused clock advances only when told.
#[derive(Clone, Default)]
pub(super) struct Bucket(Arc<Mutex<Objects>>);
#[derive(Default)]
struct Objects {
    raw: BTreeMap<String, Object>,
    control: BTreeMap<String, ControlObject>,
    revision: u64,
    reads: Reads,
}
impl Bucket {
    pub(super) fn reads(&self) -> Reads {
        self.0.lock().unwrap().reads
    }
    pub(super) fn reset_reads(&self) {
        self.0.lock().unwrap().reads = Reads::default();
    }
    /// Drop a raw member, as when its upload never finished: its group is not complete (S06).
    pub(super) fn remove_raw(&self, key: &str) {
        assert!(self.0.lock().unwrap().raw.remove(key).is_some(), "{key}");
    }
    /// Replace a raw member's stored bytes with others: a corrupt member.
    pub(super) fn corrupt_raw(&self, key: &str) {
        let mut objects = self.0.lock().unwrap();
        let object = objects.raw.get_mut(key).expect("stored member");
        object.body = b"not the stored gzip".to_vec();
        object.length = object.body.len();
    }
}
impl ObjectTransport for Bucket {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        let mut objects = self.0.lock().unwrap();
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
        objects.reads.raws += 1;
        objects.raw.get(key).cloned().ok_or(Error::NotFound)
    }
}
impl CatalogTransport for Bucket {
    async fn get_control(&self, key: &str, _: usize) -> Result<ControlObject, Error> {
        let mut objects = self.0.lock().unwrap();
        if key.starts_with("index/v2/groups/") {
            objects.reads.descriptors += 1;
        } else {
            objects.reads.catalogs += 1;
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
        panic!("the source lists the catalog index")
    }
}
impl server2::history::IndexListing for Bucket {
    async fn list_index(&self, prefix: &str, _: Option<&str>) -> Result<ListPage, Error> {
        let mut objects = self.0.lock().unwrap();
        objects.reads.lists += 1;
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

/// The KST instant of `date` at `hhmmss`, in epoch milliseconds.
pub(super) fn kst(date: u32, hhmmss: u32) -> f64 {
    let minute = Publication::new(date, (hhmmss / 100) as u16).unwrap();
    server2::history::schedule::to_ms(minute) as f64 + f64::from(hhmmss % 100) * 1000.
}
/// One forecast-zone list as S13b stores it: the KST fetch day is its period and partition, and
/// every page is one record of one group, fetched at its instant.
pub(super) async fn publish(
    store: &CatalogStore<Bucket>,
    day: u32,
    pages: &[(f64, Vec<u8>)],
) -> Vec<String> {
    let listed: Vec<(u32, f64, Vec<u8>)> = pages
        .iter()
        .map(|(fetched_at, page)| (day, *fetched_at, page.clone()))
        .collect();
    publish_listed(store, day, &listed).await
}
/// [`publish`] with each page listed in the catalog of its own day.
async fn publish_listed(
    store: &CatalogStore<Bucket>,
    day: u32,
    pages: &[(u32, f64, Vec<u8>)],
) -> Vec<String> {
    let limits = CatalogLimits::default();
    let key = ProviderKey::Named {
        id: "forecast-zones".into(),
    };
    let n = pages.len() as u32;
    let mut records = Vec::new();
    let mut members = Vec::new();
    for (i, (listed, fetched_at, page)) in pages.iter().enumerate() {
        let record = RawRecord::new(
            "data-go-kr",
            "forecast-zone",
            &key,
            Period {
                local_date: day,
                slot: "0000".into(),
            },
            *fetched_at as u64,
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
                CatalogId::for_record(&record.envelope.identity, &format!("{listed}")).unwrap(),
            ],
        });
        records.push(record);
    }
    let keys = records
        .iter()
        .map(|r| r.envelope.identity.object_key().unwrap())
        .collect();
    let declaration = GroupDeclaration::new(members, &limits).unwrap();
    store
        .publish(declaration, records, deadline())
        .await
        .unwrap();
    keys
}
/// A one-page list of zones (`regId`, `regName`), all city zones (`regSp` C).
pub(super) fn zone_page(zones: &[(&str, &str)]) -> Vec<u8> {
    page_of(
        zones
            .iter()
            .map(|(id, name)| (id.to_string(), name.to_string()))
            .collect(),
        1,
    )
}
fn page_of(zones: Vec<(String, String)>, page: u32) -> Vec<u8> {
    let items: Vec<serde_json::Value> = zones
        .iter()
        .map(|(id, name)| json!({"regId": id, "regName": name, "regSp": "C"}))
        .collect();
    let n = items.len();
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": page, "numOfRows": 1000,
                 "totalCount": n}}}))
    .unwrap()
}
/// A two-page list: a full first page of 1,000 synthetic zones, then `last` alone.
fn two_pages(prefix: &str, last: (&str, &str)) -> [Vec<u8>; 2] {
    let full = (0..1000)
        .map(|i| (format!("{prefix}{i:05}"), format!("구역{i}")))
        .collect();
    [
        page_of(full, 1),
        page_of(vec![(last.0.into(), last.1.into())], 2),
    ]
}
pub(super) fn source(bucket: &Bucket, now: f64) -> S3Source<Bucket> {
    S3Source::new(
        bucket.clone(),
        Arc::new(move || now),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
}
pub(super) fn store(bucket: &Bucket) -> CatalogStore<Bucket> {
    CatalogStore::new(bucket.clone(), CatalogLimits::default()).unwrap()
}
/// The `regId`s of the zones, in collection order.
fn ids(zones: &Zones) -> Vec<String> {
    zones
        .docs()
        .iter()
        .map(|d| d.get("regId").and_then(Val::as_str).unwrap().to_owned())
        .collect()
}
/// The digest of one list's pages, as the order key takes it: the hash of their hashes in page
/// order.
fn digest(pages: &[&[u8]]) -> String {
    let hashes: String = pages.iter().map(|p| sha256(p)).collect();
    sha256(hashes.as_bytes())
}
const NOW_DAY: u32 = 20261110;

/// ORDER: a list's completion is its last page's arrival. A's pages arrived at 100 and 400 s, B's
/// at 200 and 300 s: A completed last, although its first page came first.
#[tokio::test(start_paused = true)]
async fn interleaved_page_times_order_lists_by_their_last_page() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    let t0 = kst(NOW_DAY, 90000);
    let at = |s: f64| t0 + s * 1000.;
    let [a1, a2] = two_pages("11A", ("11B10101", "서울"));
    let [b1, b2] = two_pages("11B", ("11B20201", "인천"));
    publish(&store, NOW_DAY, &[(at(100.), a1), (at(400.), a2)]).await;
    publish(&store, NOW_DAY, &[(at(200.), b1), (at(300.), b2)]).await;
    let now = kst(NOW_DAY, 120000);
    let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
    assert_eq!(
        zones.find_by_name("서울특별시", "종로구").len(),
        1,
        "A answers"
    );
    assert!(
        zones.find_by_name("인천광역시", "남동구").is_empty(),
        "B is not newer"
    );
    assert_eq!(zones.docs().len(), 1001, "A alone");
}

/// ORDER: a list requested before midnight that completed after it keeps its request day as its
/// partition. A (requested 11-08 23:59:59, completed 11-09 00:00:05) completed after B (11-09
/// 00:00:00 to 00:00:01), so A answers although B's day is later.
#[tokio::test(start_paused = true)]
async fn a_list_completed_after_midnight_answers_when_it_completed_last() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    publish(
        &store,
        20261108,
        &[(kst(20261109, 5), zone_page(&[("11B10101", "서울")]))],
    )
    .await;
    publish(
        &store,
        20261109,
        &[(kst(20261109, 1), zone_page(&[("11B20201", "인천")]))],
    )
    .await;
    let now = kst(20261109, 120000);
    let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
    assert_eq!(ids(&zones), ["11B10101"], "A answers");
}

/// ORDER: of two lists of one day that completed at the same instant, the one with the higher
/// digest of its pages answers (the fold applied it last).
#[tokio::test(start_paused = true)]
async fn equal_completions_order_by_the_digest_of_the_pages() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    let at = kst(NOW_DAY, 90000);
    let seoul = zone_page(&[("11B10101", "서울")]);
    let incheon = zone_page(&[("11B20201", "인천")]);
    publish(&store, NOW_DAY, &[(at, seoul.clone())]).await;
    publish(&store, NOW_DAY, &[(at, incheon.clone())]).await;
    let expected = if digest(&[&seoul]) > digest(&[&incheon]) {
        "11B10101"
    } else {
        "11B20201"
    };
    let now = kst(NOW_DAY, 120000);
    let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
    assert_eq!(ids(&zones), [expected]);
}

/// FALLBACK (design review 3): the newest day holds only an incomplete list C (a member never
/// stored). The anchor is the first day with an eligible list, 11-09 (B: 00:00:00 to 00:00:01);
/// its previous day holds A (requested 11-08 23:59:59, completed 11-09 00:00:05), which completed
/// after B and answers.
#[tokio::test(start_paused = true)]
async fn an_incomplete_newest_day_falls_back_to_the_list_that_completed_last() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    publish(
        &store,
        20261108,
        &[(kst(20261109, 5), zone_page(&[("11B10101", "서울")]))],
    )
    .await;
    publish(
        &store,
        20261109,
        &[(kst(20261109, 1), zone_page(&[("11B20201", "인천")]))],
    )
    .await;
    let c = publish(
        &store,
        NOW_DAY,
        &[(kst(NOW_DAY, 90000), zone_page(&[("11B20101", "강화")]))],
    )
    .await;
    bucket.remove_raw(&c[0]);
    let now = kst(NOW_DAY, 120000);
    let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
    assert_eq!(ids(&zones), ["11B10101"], "A answers");
}

/// FALLBACK: a stored list legacy would not have written (a repeated `regId`) is skipped like an
/// incomplete one: the next newest list answers.
#[tokio::test(start_paused = true)]
async fn a_newest_list_legacy_would_not_write_is_skipped() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    publish(
        &store,
        20261109,
        &[(kst(20261109, 90000), zone_page(&[("11B10101", "서울")]))],
    )
    .await;
    publish(
        &store,
        NOW_DAY,
        &[(
            kst(NOW_DAY, 90000),
            zone_page(&[("11B20201", "인천"), ("11B20201", "인천")]),
        )],
    )
    .await;
    let now = kst(NOW_DAY, 120000);
    let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
    assert_eq!(ids(&zones), ["11B10101"]);
}

/// FALLBACK: a list that completed after the request's instant does not answer yet.
#[tokio::test(start_paused = true)]
async fn a_list_completed_after_now_is_not_selected() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    publish(
        &store,
        20261109,
        &[(kst(20261109, 90000), zone_page(&[("11B10101", "서울")]))],
    )
    .await;
    publish(
        &store,
        NOW_DAY,
        &[(kst(NOW_DAY, 130000), zone_page(&[("11B20201", "인천")]))],
    )
    .await;
    let now = kst(NOW_DAY, 120000);
    let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
    assert_eq!(ids(&zones), ["11B10101"]);
}

/// FALLBACK: a corrupt newest list is a read error, as before; an older list does not stand in.
#[tokio::test(start_paused = true)]
async fn a_corrupt_newest_list_keeps_the_read_error() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    publish(
        &store,
        20261109,
        &[(kst(20261109, 90000), zone_page(&[("11B10101", "서울")]))],
    )
    .await;
    let newest = publish(
        &store,
        NOW_DAY,
        &[(kst(NOW_DAY, 90000), zone_page(&[("11B20201", "인천")]))],
    )
    .await;
    bucket.corrupt_raw(&newest[0]);
    let now = kst(NOW_DAY, 120000);
    let error = source(&bucket, now)
        .zones(now, deadline())
        .await
        .expect_err("a corrupt member is a read error");
    assert!(error.starts_with("forecast-zone read: "), "{error}");
}

/// SELECT: the restored group must be the one its catalog entries describe. A group whose second
/// page is listed in another day restores with both pages, so its identity differs from the one
/// the newest day's catalog gives it: a read error, not a list.
#[tokio::test(start_paused = true)]
async fn a_restored_list_must_equal_its_catalog_entries() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    publish(
        &store,
        20261109,
        &[(kst(20261109, 90000), zone_page(&[("11B10101", "서울")]))],
    )
    .await;
    let full: Vec<(String, String)> = (0..1000)
        .map(|i| (format!("11C{i:05}"), format!("구역{i}")))
        .collect();
    publish_listed(
        &store,
        NOW_DAY,
        &[
            (NOW_DAY, kst(NOW_DAY, 90000), page_of(full, 1)),
            (
                20261109,
                kst(NOW_DAY, 90001),
                page_of(vec![("11B20201".into(), "인천".into())], 2),
            ),
        ],
    )
    .await;
    let now = kst(NOW_DAY, 120000);
    let error = source(&bucket, now)
        .zones(now, deadline())
        .await
        .expect_err("a group that differs from its entries is a read error");
    assert!(
        error.starts_with("forecast-zone read: ") && error.contains("differs"),
        "{error}"
    );
}

/// COST: a cold read lists the key once, reads the newest day's catalog and its previous day's,
/// then restores one group (its catalog again, its descriptor, its one page). Identical lists of
/// older days are not read, however many there are (before: every catalog, descriptor and page
/// since 2026-01).
#[tokio::test(start_paused = true)]
async fn reads_do_not_grow_with_identical_lists_in_older_days() {
    let bucket = Bucket::default();
    let store = store(&bucket);
    let page = zone_page(&[("11B10101", "서울"), ("11B20201", "인천")]);
    // Five identical lists a day, one per restart.
    let mut days: Vec<u32> = Vec::new();
    let mut day = Publication::new(20261109, 0).unwrap();
    for _ in 0..20 {
        days.push(day.date());
        day = day.add_hours(-24).unwrap();
    }
    let fill = async |days: &[u32]| {
        for d in days {
            for restart in 0..5 {
                publish(
                    &store,
                    *d,
                    &[(kst(*d, 80000 + restart * 100), page.clone())],
                )
                .await;
            }
        }
    };
    fill(&days[..10]).await;
    for restart in 0..3 {
        publish(
            &store,
            NOW_DAY,
            &[(kst(NOW_DAY, 80000 + restart * 100), page.clone())],
        )
        .await;
    }
    let now = kst(NOW_DAY, 120000);
    let cold = async || {
        bucket.reset_reads();
        let zones = source(&bucket, now).zones(now, deadline()).await.unwrap();
        assert_eq!(zones.docs().len(), 2);
        bucket.reads()
    };
    let expected = Reads {
        lists: 1,
        catalogs: 3,
        descriptors: 1,
        raws: 1,
    };
    assert_eq!(cold().await, expected, "10 older days, 50 identical lists");
    fill(&days[10..]).await;
    assert_eq!(cold().await, expected, "20 older days, 100 identical lists");
}
