//! S15b-2 restart read (AK 2026-11-07, "A로 진행"): a process that folds the station pages
//! stores one product per KST day holding the parsed pages, and a restarted process answers from
//! the products and the day catalogs instead of restoring and parsing every stored page. The
//! products are compared with the catalogs (S3 is truth): a page published later is restored, an
//! unusable product is replaced by the raw pages, and S16 completeness is kept. The S06 loopback
//! S3 test peer holds the pages; the acquirer never reaches a provider.
use super::observe::{
    Counted, STATION_RAW, aws_page, city_page, dotted, page_record, publish_record, repair_raw,
    store_pages_without,
};
use super::source_s3::{NOW, Peer, Unreachable, deadline};
use serde_json::Value;
use server2::domestic::kma::source::observe::{Folded, Observations};
use server2::domestic::kma::source::stations::date_of;
use server2::domestic::kma::source::{Doc, Val};
use server2::domestic::publication::Publication;
use server2::history::schedule;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, Pagination, ProviderKey,
    RawRecord, RecordId,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;

type Obs = Observations<Counted>;
const PRODUCTS: &str = "raw/v2/kma-web/station-pages";
const HOUR_MS: i64 = 3_600_000;

fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
/// The city page's own `pubDate` form.
fn city_date(h: Publication) -> String {
    let d = h.date();
    format!(
        "{}.{}.{}.{:02}:00",
        d / 10000,
        (d / 100) % 100,
        d % 100,
        h.hour()
    )
}
/// Every hour from 2026-09-16 00:00 to 10:00 of 2026-09-24 (the nine day partitions a process at
/// 10:50 reads), each with its AWS hourly and city page acquired 15 minutes into the hour, and the
/// minute pages of the last 40 minutes.
pub(super) fn station_records() -> Vec<RawRecord> {
    let mut out = Vec::new();
    let mut h = p(20260916, 0);
    while h <= p(20260924, 1000) {
        let at = schedule::to_ms(h) as u64 + 15 * 60_000;
        out.push(page_record(
            "aws-hourly",
            h,
            at,
            aws_page(&dotted(h), h.hour().is_multiple_of(5)),
        ));
        out.push(page_record("city-obs", h, at, city_page(&city_date(h))));
        h = h.add_hours(1).unwrap();
    }
    for minute in (11..=49).step_by(2) {
        let m = p(20260924, 1000 + minute);
        out.push(page_record(
            "aws-minute",
            m,
            schedule::to_ms(m) as u64 + 30_000,
            aws_page(&dotted(m), minute == 49),
        ));
    }
    out
}
async fn seeded_peer(missing: &[RecordId], extra: Vec<RawRecord>) -> Peer {
    let peer = Peer::new();
    let mut records = station_records();
    records.extend(extra);
    store_pages_without(&peer.transport_limited(4), records, missing).await;
    peer
}
fn process(peer: &Peer) -> (Arc<Obs>, Counted) {
    let counted = Counted::new(peer.transport_limited(4));
    let obs = Arc::new(Observations::new(
        counted.clone(),
        Arc::new(CatalogStore::new(counted.clone(), CatalogLimits::default()).unwrap()),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    ));
    (obs, counted)
}
async fn answer(obs: &Arc<Obs>) -> Arc<Folded> {
    obs.stations(NOW as i64, Instant::now() + Duration::from_millis(2500))
        .await
        .unwrap()
}
/// A later answer whose inputs were read completely (S16), or a panic.
async fn settle(obs: &Arc<Obs>) -> Arc<Folded> {
    for _ in 0..120 {
        let folded = answer(obs).await;
        if obs.settled(NOW as i64, &folded) {
            return folded;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("the station inputs never settled");
}
/// What an answer is made of (the registry's first-seen instant is per process).
fn fingerprint(f: &Folded) -> Vec<String> {
    let docs = |d: &[Doc]| {
        d.iter()
            .map(|d| String::from_utf8_lossy(&d.json().to_bytes()).into_owned())
            .collect::<Vec<_>>()
    };
    let mut out = vec!["registry".to_owned()];
    out.extend(docs(f.registry.docs()));
    out.push("hourly".into());
    out.extend(docs(f.hourly.docs()));
    out.push("minute".into());
    out.extend(docs(f.minute.docs()));
    out.push("national".into());
    let mut national: Vec<_> = f.national.iter().collect();
    national.sort_by(|a, b| a.0.cmp(b.0));
    for (id, rows) in national {
        for (at, row) in rows {
            out.push(format!(
                "{id} {at} {}",
                String::from_utf8_lossy(&row.json().to_bytes())
            ));
        }
    }
    out.push("pages".into());
    for page in f.pages.iter() {
        out.push(format!("{page:?}"));
    }
    out
}
/// The answers are made of the same (the first difference of each part otherwise).
#[track_caller]
fn same(a: &Folded, b: &Folded, what: &str) {
    let (a, b) = (fingerprint(a), fingerprint(b));
    if a == b {
        return;
    }
    let parts = |f: &[String]| {
        let mut out: Vec<(String, Vec<String>)> = Vec::new();
        for line in f {
            if ["registry", "hourly", "minute", "national", "pages"].contains(&line.as_str()) {
                out.push((line.clone(), Vec::new()));
            } else {
                out.last_mut().unwrap().1.push(line.clone());
            }
        }
        out
    };
    let mut report = String::new();
    for ((name, x), (_, y)) in parts(&a).iter().zip(parts(&b).iter()) {
        if let Some(i) = (0..x.len().max(y.len())).find(|i| x.get(*i) != y.get(*i)) {
            report += &format!(
                "\n{name} entry {i} of {} and {}:\n  {:?}\n  {:?}",
                x.len(),
                y.len(),
                x.get(i),
                y.get(i)
            );
        }
    }
    panic!("{what}:{report}");
}
/// Raw page GETs of `kind` outside 2026-09-16 (a process at 10:50 on 09-24 stores no product
/// of that day: some of its hours are already out of the window).
fn raw_gets(counted: &Counted, kind: &str) -> usize {
    counted.get(&format!("GET raw/v2/kma-web/{kind}"))
        - counted.get(&format!("GET raw/v2/kma-web/{kind}/2026/09/16"))
}
/// Hourly pages from hour `from` to `to` with a row of station 108. A page's rows are dated nine
/// hours after its KST hour (the page time read as UTC, as the parsed pages carry it).
fn hours_of_108(f: &Folded, from: Publication, to: Publication) -> usize {
    let shift = 9. * HOUR_MS as f64;
    let (from, to) = (
        schedule::to_ms(from) as f64 + shift,
        schedule::to_ms(to) as f64 + shift,
    );
    f.hourly
        .docs()
        .iter()
        .filter(|d| d.get("stnId") == Some(&Val::Num(108.)))
        .map(date_of)
        .filter(|t| (from..=to).contains(t))
        .count()
}
/// Call until `done` holds (folds and products follow requests).
async fn until(obs: &Arc<Obs>, mut done: impl FnMut() -> bool) {
    for _ in 0..120 {
        if done() {
            return;
        }
        let _ = answer(obs).await;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("never reached");
}
fn product_catalog(day: u32) -> CatalogId {
    let key = ProviderKey::Named {
        id: "aws-national".into(),
    };
    CatalogId {
        source: "kma-web".into(),
        kind: "station-pages".into(),
        key_sha256: server2::storage::sha256(&key.canonical_bytes().unwrap()),
        partition: format!("{day:08}"),
    }
}
/// The stored products of one day, oldest first, as JSON.
pub(super) async fn products(peer: &Peer, day: u32) -> Vec<Value> {
    product_texts(peer, day)
        .await
        .iter()
        .map(|text| serde_json::from_str(text).unwrap())
        .collect()
}
/// The stored products of one day, oldest first, as JSON text.
async fn product_texts(peer: &Peer, day: u32) -> Vec<String> {
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    match store.lookup(&product_catalog(day), deadline()).await {
        Ok(server2::storage::LookupOutcome::Ready(set)) => set
            .acquisitions()
            .iter()
            .map(|a| {
                let mut raw = Vec::new();
                std::io::Read::read_to_end(
                    &mut flate2::read::GzDecoder::new(&a.records()[0].bytes[..]),
                    &mut raw,
                )
                .unwrap();
                String::from_utf8(raw).unwrap()
            })
            .collect(),
        // No catalog yet.
        Ok(server2::storage::LookupOutcome::Incomplete)
        | Err(server2::storage::Error::NotFound) => Vec::new(),
        Err(e) => panic!("product catalog: {e:?}"),
    }
}
fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    std::io::Write::write_all(&mut gzip, bytes).unwrap();
    gzip.finish().unwrap()
}
/// Store `bytes` as a product of `day` made at `made`.
async fn publish_product(peer: &Peer, day: u32, made: u64, bytes: Vec<u8>) {
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        "kma-web",
        "station-pages",
        &ProviderKey::Named {
            id: "aws-national".into(),
        },
        p(day, 0).period(),
        made,
        200,
        "application/gzip",
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true,
        }),
        bytes.into(),
        &limits.raw,
    )
    .unwrap();
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![product_catalog(day)],
    };
    store
        .publish(
            GroupDeclaration::new(vec![member], &limits).unwrap(),
            vec![record],
            deadline(),
        )
        .await
        .unwrap();
}
fn wall_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
/// The days a process at 10:50 on 2026-09-24 stores products for: those whose every hour is
/// within the 8-day window.
const DAYS: [u32; 8] = [
    20260917, 20260918, 20260919, 20260920, 20260921, 20260922, 20260923, 20260924,
];
/// A process that read every page from the raw records and stored its products.
async fn producing(peer: &Peer) -> (Arc<Obs>, Counted, Arc<Folded>) {
    let (obs, counted) = process(peer);
    let folded = settle(&obs).await;
    (obs, counted, folded)
}

/// A process that folds stores one product per day whose hours are all in the window, and stores
/// none again while nothing changed; a restarted process with no provider answers 168 past hours
/// and the minute rows from its first request, reads no raw page the products cover and stores
/// nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_restart_answers_from_the_day_products() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let (a, a_counted, a_folded) = producing(&peer).await;
    for day in DAYS {
        assert_eq!(products(&peer, day).await.len(), 1, "one product of {day}");
    }
    assert!(products(&peer, 20260916).await.is_empty(), "a partial day");
    let written = a_counted.get(&format!("PUT {PRODUCTS}"));
    for _ in 0..4 {
        let again = answer(&a).await;
        assert!(a.settled(NOW as i64, &again));
    }
    assert_eq!(a_counted.get(&format!("PUT {PRODUCTS}")), written);
    // The restart.
    let (b, b_counted) = process(&peer);
    let started = std::time::Instant::now();
    let first = answer(&b).await;
    assert!(started.elapsed() < Duration::from_millis(2600));
    assert_eq!(
        hours_of_108(&first, p(20260917, 0), p(20260923, 2300)),
        168,
        "168 past hours on the first answer"
    );
    assert!(!first.minute.docs().is_empty(), "minute rows");
    let b_folded = settle(&b).await;
    same(&b_folded, &a_folded, "restart");
    for kind in ["aws-hourly", "city-obs"] {
        assert_eq!(
            raw_gets(&b_counted, kind),
            0,
            "{kind} raw pages are in the products"
        );
    }
    assert_eq!(b_counted.get(&format!("PUT {PRODUCTS}")), 0, "nothing new");
}

/// A page published after the product (another process) is restored by itself, the answers equal
/// a cold read of the raw pages, and the day's product is stored again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_page_published_after_the_product_is_restored() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let _ = producing(&peer).await;
    // A newer acquisition of 09-24 08:00 with rain at 410, by another process.
    let hour = p(20260924, 800);
    let later = page_record(
        "aws-hourly",
        hour,
        schedule::to_ms(hour) as u64 + 50 * 60_000,
        aws_page(&dotted(hour), true),
    );
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    let declaration = GroupDeclaration::new(
        vec![GroupMember {
            envelope: later.envelope.clone(),
            catalogs: vec![CatalogId::for_record(&later.envelope.identity, "20260924").unwrap()],
        }],
        &CatalogLimits::default(),
    )
    .unwrap();
    store
        .publish(declaration, vec![later.clone()], deadline())
        .await
        .unwrap();
    let (c, c_counted) = process(&peer);
    let c_folded = settle(&c).await;
    assert_eq!(raw_gets(&c_counted, "aws-hourly"), 1);
    assert_eq!(raw_gets(&c_counted, "city-obs"), 0);
    until(&c, || c_counted.get(&format!("PUT {PRODUCTS}")) == 1).await;
    // The same raw pages without any product.
    let cold_peer = seeded_peer(&[], vec![later]).await;
    let (d, _) = process(&cold_peer);
    let d_folded = settle(&d).await;
    same(&c_folded, &d_folded, "cold read");
}

/// A product that cannot be used as it is (unreadable, an older schema or parse revision, a page
/// the catalog does not list, a city set that grew) gives the answers of the raw pages, and the
/// day's product is stored again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unusable_products_are_replaced_by_the_raw_pages() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let (_, _, reference) = producing(&peer).await;
    let day = 20260922;
    // Edited as text: the key order of the stored rows is kept.
    let stored = product_texts(&peer, day).await.pop().unwrap();
    let edit = |from: &str, to: &str| {
        assert!(stored.contains(from), "{from}");
        gzip(stored.replacen(from, to, 1).as_bytes())
    };
    let hour3 = {
        let v: Value = serde_json::from_str(&stored).unwrap();
        let page = v["pages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["kind"] == "aws-hourly" && p["hour"] == 300)
            .unwrap()
            .clone();
        page["rawId"].as_str().unwrap().to_owned()
    };
    let unlisted = hour3.replace(".raw.gz", "0.raw.gz");
    let variants: Vec<(&str, Vec<u8>, bool)> = vec![
        ("unreadable", b"not a product".to_vec(), true),
        ("older schema", edit("\"schema\":2,", "\"schema\":1,"), true),
        (
            "older parse revision",
            edit("\"parseRevision\":1,", "\"parseRevision\":0,"),
            true,
        ),
        (
            "a page the catalog does not list",
            edit(&format!("\"{hour3}\""), &format!("\"{unlisted}\"")),
            false,
        ),
        ("a grown city set", edit("\"108\",", ""), true),
    ];
    for (i, (name, bytes, raw)) in variants.into_iter().enumerate() {
        publish_product(
            &peer,
            day,
            wall_ms() + (i as u64 + 1) * HOUR_MS as u64,
            bytes,
        )
        .await;
        let (e, e_counted) = process(&peer);
        let folded = settle(&e).await;
        same(&folded, &reference, name);
        let pages = raw_gets(&e_counted, "aws-hourly") + raw_gets(&e_counted, "city-obs");
        if raw {
            assert!(pages >= 48, "{name}: the day's raw pages ({pages})");
        } else {
            assert_eq!(pages, 1, "{name}: the unlisted page's hour");
        }
        until(&e, || e_counted.get(&format!("PUT {PRODUCTS}")) == 1).await;
    }
}

/// Two processes store their products; a third reads the newest of each day, stores none and
/// answers as they do.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_newest_of_two_processes_products_is_read() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let ((_, _, one), (_, _, two)) = tokio::join!(producing(&peer), producing(&peer));
    same(&one, &two, "two processes");
    for day in DAYS {
        assert_eq!(products(&peer, day).await.len(), 2, "{day}");
    }
    let (f, f_counted) = process(&peer);
    let folded = settle(&f).await;
    same(&folded, &one, "the third");
    assert_eq!(f_counted.get(&format!("GET {PRODUCTS}")), DAYS.len());
    assert_eq!(raw_gets(&f_counted, "aws-hourly"), 0);
    assert_eq!(f_counted.get(&format!("PUT {PRODUCTS}")), 0);
}

/// The answer after the first is not complete (S16) while the remaining stored pages are still
/// being restored, and is once they are.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_rest_of_the_restart_read_keeps_answers_unsettled() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let _ = producing(&peer).await;
    let (b, b_counted) = process(&peer);
    // The four newest minute pages come at once, the other sixteen slowly.
    b_counted.delay_gets("raw/v2/kma-web/aws-minute", 4, Duration::from_millis(400));
    let _ = answer(&b).await;
    let minutes = || b_counted.get("GET raw/v2/kma-web/aws-minute");
    let mut checked = false;
    for _ in 0..80 {
        let folded = answer(&b).await;
        let read = minutes();
        if (8..18).contains(&read) {
            assert!(
                !b.settled(NOW as i64, &folded),
                "unsettled with {read} of 20 minute pages"
            );
            checked = true;
        }
        if read >= 20 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(checked, "the rest of the read was observed");
    let _ = settle(&b).await;
}

/// A day read with a group S06 excluded stays partial through its product: a restart from the
/// product is never complete, as a read of the raw pages is not.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_excluded_group_keeps_its_day_partial_through_the_product() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    // An earlier acquisition of 09-21 05:00 whose raw body is missing.
    let hour = p(20260921, 500);
    let lost = page_record(
        "aws-hourly",
        hour,
        schedule::to_ms(hour) as u64 + 5 * 60_000,
        aws_page(&dotted(hour), false),
    );
    let peer = seeded_peer(
        std::slice::from_ref(&lost.envelope.identity),
        vec![lost.clone()],
    )
    .await;
    let (a, a_counted) = process(&peer);
    until(&a, || {
        a_counted.get(&format!("PUT {PRODUCTS}")) >= DAYS.len()
    })
    .await;
    let stored = products(&peer, 20260921).await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0]["excluded"], Value::from(1));
    let (b, b_counted) = process(&peer);
    for _ in 0..40 {
        let folded = answer(&b).await;
        assert!(!b.settled(NOW as i64, &folded), "the 09-21 read is partial");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // Only the excluded group is checked again (its missing raw body), no raw read of the day.
    assert_eq!(raw_gets(&b_counted, "aws-hourly"), 1);
    let last = answer(&b).await;
    assert_eq!(hours_of_108(&last, p(20260917, 0), p(20260923, 2300)), 168);
}

/// A city page of `h` naming `stations` (`(id, name)`), as `city_page` does for 108 alone.
fn city_page_of(h: Publication, stations: &[(&str, &str)]) -> Vec<u8> {
    let rows: String = stations
        .iter()
        .map(|(id, name)| {
            format!(
                r#"<tr><td><a href="city-obs.do?stn={id}">{name}</a></td><td>맑음</td><td>3</td><td>18.0</td><td>60</td><td>남서</td><td>2.0</td></tr>"#
            )
        })
        .collect();
    format!(
        r#"<html><head><meta charset="utf-8"></head><body><div class="cmp-table-topinfo"><strong>기상실황표</strong>{}</div><table id="weather_table"><thead><tr id="table_header2"><th>이름</th><th>현재일기</th><th>운량<br/>1/10</th><th>현재<br/>기온</th><th>습도<br/>%</th><th>풍향</th><th>풍속</th></tr></thead><tbody>{rows}</tbody></table></body></html>"#,
        city_date(h)
    )
    .into_bytes()
}

/// RO-city-growth: a city page published after the products names a station the products
/// reduced to its registry facts (강남, 400). Its AWS rows of every stored page are read in full
/// again, and the answers equal a cold read of the raw pages.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_station_joining_the_city_set_after_the_products_is_read_in_full() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let _ = producing(&peer).await;
    let hour = p(20260924, 800);
    let later = page_record(
        "city-obs",
        hour,
        schedule::to_ms(hour) as u64 + 50 * 60_000,
        city_page_of(hour, &[("108", "서울"), ("400", "강남")]),
    );
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    publish_record(&store, later.clone()).await;
    let (c, _) = process(&peer);
    let c_folded = settle(&c).await;
    let cold_peer = seeded_peer(&[], vec![later]).await;
    let (d, _) = process(&cold_peer);
    let d_folded = settle(&d).await;
    assert!(
        d_folded
            .hourly
            .docs()
            .iter()
            .any(|r| r.get("stnId") == Some(&Val::Num(400.))),
        "a cold read holds the new city station's rows"
    );
    same(&c_folded, &d_folded, "cold read");
}

/// RO-minute-fallback: when the newest acquisition of a minute is not complete (S06 excludes it),
/// an older complete acquisition of that minute is used, as a latest-first read of every
/// acquisition does.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_incomplete_newest_minute_acquisition_falls_back_to_an_older_one() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let minute = p(20260924, 1049);
    let lost = page_record(
        "aws-minute",
        minute,
        schedule::to_ms(minute) as u64 + 40_000,
        aws_page(&dotted(minute), false),
    );
    let missing = lost.envelope.identity.clone();
    let peer = seeded_peer(std::slice::from_ref(&missing), vec![lost]).await;
    let (b, _) = process(&peer);
    let b_folded = settle(&b).await;
    let cold_peer = seeded_peer(&[], Vec::new()).await;
    let (d, _) = process(&cold_peer);
    let d_folded = settle(&d).await;
    same(&b_folded, &d_folded, "the 10:49 minute page");
}

/// RO-sticky-excluded: a product made while a group's raw body was missing records it; once the
/// group is repaired, a restart reads the day as complete (as a raw read does) and stores the
/// day's product again without the exclusion.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_repaired_group_completes_its_day_after_the_product() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let hour = p(20260921, 500);
    let lost = page_record(
        "aws-hourly",
        hour,
        schedule::to_ms(hour) as u64 + 5 * 60_000,
        aws_page(&dotted(hour), false),
    );
    let peer = seeded_peer(
        std::slice::from_ref(&lost.envelope.identity),
        vec![lost.clone()],
    )
    .await;
    let (a, a_counted) = process(&peer);
    until(&a, || {
        a_counted.get(&format!("PUT {PRODUCTS}")) >= DAYS.len()
    })
    .await;
    assert_eq!(
        products(&peer, 20260921).await[0]["excluded"],
        Value::from(1)
    );
    repair_raw(&peer.transport_limited(4), &lost).await;
    let (b, b_counted) = process(&peer);
    let b_folded = settle(&b).await;
    let cold_peer = seeded_peer(&[], vec![lost]).await;
    let (d, _) = process(&cold_peer);
    let d_folded = settle(&d).await;
    same(&b_folded, &d_folded, "cold read");
    until(&b, || b_counted.get(&format!("PUT {PRODUCTS}")) >= 1).await;
    let stored = products(&peer, 20260921).await;
    assert_eq!(stored.len(), 2);
    assert!(
        stored.iter().any(|v| v["excluded"] == 0),
        "the day's product is stored again without the exclusion"
    );
}

/// Products, then a later city page naming 강남 (400), whose AWS rows the products keep reduced:
/// the peer and the cold peer holding the same raw pages without products.
async fn grown_city_set() -> (Peer, Peer) {
    let peer = seeded_peer(&[], Vec::new()).await;
    let _ = producing(&peer).await;
    let hour = p(20260924, 800);
    let later = page_record(
        "city-obs",
        hour,
        schedule::to_ms(hour) as u64 + 50 * 60_000,
        city_page_of(hour, &[("108", "서울"), ("400", "강남")]),
    );
    let store = CatalogStore::new(peer.transport_limited(4), CatalogLimits::default()).unwrap();
    publish_record(&store, later.clone()).await;
    (peer, seeded_peer(&[], vec![later]).await)
}

/// RO-city-growth: while pages reduced for a smaller city set cannot be read in full again (here
/// the 09-17 pages fail), answers stay unsettled; the next attempt follows a later request without
/// any new hourly page, and the answers then equal a cold read.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_failed_full_read_keeps_answers_unsettled_until_it_is_tried_again() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let (peer, cold_peer) = grown_city_set().await;
    let (c, c_counted) = process(&peer);
    const FAILING: &str = "raw/v2/kma-web/aws-hourly/2026/09/17";
    c_counted.fail_gets(Some(FAILING));
    let attempts = || c_counted.get(&format!("GET {FAILING}"));
    until(&c, || attempts() > 0).await;
    for _ in 0..20 {
        let folded = answer(&c).await;
        assert!(
            !c.settled(NOW as i64, &folded),
            "the 09-17 pages are still reduced"
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    c_counted.fail_gets(None);
    let tried = attempts();
    let mut folded = answer(&c).await;
    for _ in 0..240 {
        if c.settled(NOW as i64, &folded) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        folded = answer(&c).await;
    }
    assert!(attempts() > tried, "read again without a new hourly page");
    assert!(c.settled(NOW as i64, &folded), "settled after the retry");
    let (d, _) = process(&cold_peer);
    let d_folded = settle(&d).await;
    same(&folded, &d_folded, "cold read");
}

/// RO-expand-progress: reading the reduced pages in full again takes longer than one read's
/// limit (each AWS page GET of 09-20..24 takes 400 ms); what was read is kept and the rest follows,
/// so the answers settle and equal a cold read.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_full_read_progresses_over_several_runs() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let (peer, cold_peer) = grown_city_set().await;
    let (c, c_counted) = process(&peer);
    c_counted.delay_gets(
        "raw/v2/kma-web/aws-hourly/2026/09/2",
        0,
        Duration::from_millis(400),
    );
    let mut folded = answer(&c).await;
    for _ in 0..300 {
        if c.settled(NOW as i64, &folded) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        folded = answer(&c).await;
    }
    assert!(c.settled(NOW as i64, &folded), "the full read completed");
    let (d, _) = process(&cold_peer);
    let d_folded = settle(&d).await;
    same(&folded, &d_folded, "cold read");
}

// ---- KMA-RESTART-RACE: the stored restore's head start (AK 2026-11-07, plan A) ----

use super::observe::{acquisition, asos_daily, asos_hourly, town};
use server2::domestic::asos::{AsosKind, AsosRequest};
use server2::domestic::family::{WebFamily, WebRequest};
use server2::domestic::kma::backend::{KmaSource, SourceAnswer};
use server2::domestic::kma::source::S3Source;
use server2::domestic::kma::source::observe::Acquire;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::{BoxFuture, OrderedJson};
use server2::warnings::store::{StoreConfig, WarningStore};

type Answer = Box<dyn server2::domestic::kma::KmaStore + Send>;

/// The city page of 10:00 a provider answers now: 21.0 degrees, where the stored one says 18.0.
fn warm_city_page(h: Publication) -> Vec<u8> {
    String::from_utf8(city_page(&city_date(h)))
        .unwrap()
        .replace("<td>18.0</td>", "<td>21.0</td>")
        .into_bytes()
}
/// What a provider answers now (fetched at 10:49): every hour's AWS and city page with the stored
/// bodies (except the warmer city page of 10:00), the minute page of 10:49 and station 108's
/// ranges. Every call is logged.
#[derive(Default)]
pub(super) struct Pages {
    calls: std::sync::Mutex<Vec<String>>,
}
impl Pages {
    pub(super) fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
    fn count(&self, what: &str) -> usize {
        self.calls().iter().filter(|c| c.as_str() == what).count()
    }
    /// The calls starting with `prefix`.
    fn of(&self, prefix: &str) -> Vec<String> {
        self.calls()
            .into_iter()
            .filter(|c| c.starts_with(prefix))
            .collect()
    }
}
impl Acquire for Pages {
    fn web(
        &self,
        request: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            let key = request.provider_key();
            let (label, kind, hour, body, ct) = match request.family() {
                WebFamily::AwsMinute => {
                    let m = p(20260924, 1049);
                    let body = aws_page(&dotted(m), true);
                    ("aws-minute".to_owned(), "aws-minute", m, body, "text/html")
                }
                WebFamily::AwsHourly => {
                    let h = request.publication().unwrap();
                    let body = aws_page(&dotted(h), h.hour().is_multiple_of(5));
                    let label = format!("aws-hourly {}", h.compact());
                    (label, "aws-hourly", h, body, "text/html")
                }
                WebFamily::CityObservation => {
                    let h = request.publication().unwrap();
                    let body = if h == p(20260924, 1000) {
                        warm_city_page(h)
                    } else {
                        city_page(&city_date(h))
                    };
                    let label = format!("city {}", h.compact());
                    (label, "city-obs", h, body, "text/html;charset=UTF-8")
                }
                WebFamily::TownRss => return Err(DomesticError::Transport),
            };
            self.calls.lock().unwrap().push(label);
            Ok(Acquired::Complete(acquisition(
                "kma-web",
                kind,
                &key,
                hour,
                &hour.base_date(),
                body,
                ct,
            )))
        })
    }
    fn asos(
        &self,
        request: AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(format!(
                "{} {}-{}",
                request.asos_kind().kind(),
                request.start(),
                request.end()
            ));
            let body = match request.asos_kind() {
                AsosKind::Hourly => asos_hourly(),
                AsosKind::Daily => asos_daily(),
            };
            let start = request.start();
            let hour = if start.len() == 12 {
                start[8..10].parse::<u16>().unwrap() * 100
            } else {
                0
            };
            Ok(Acquired::Complete(acquisition(
                "data-go-kr",
                request.asos_kind().kind(),
                &AsosRequest::record_key(request.station()),
                p(start[..8].parse().unwrap(), hour),
                &request.range_partition(),
                body,
                "application/json",
            )))
        })
    }
}
/// The observed source of a process on `counted` with the clock at `now`.
fn observed(counted: &Counted, acquire: Arc<dyn Acquire>, now: f64) -> S3Source<Counted> {
    let warnings = Arc::new(
        WarningStore::new(
            counted.clone(),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    S3Source::new_observed_with_warning_store(
        counted.clone(),
        Arc::new(move || now),
        acquire,
        Arc::new(Unreachable),
        warnings,
    )
    .unwrap()
}
/// One request of the observed source with the production budget (8 s: the head start ends
/// 0.7 s and the wait 2.5 s after its start), and how long it took.
async fn first(s3: &S3Source<Counted>) -> (Answer, Duration) {
    first_by(s3, Duration::from_secs(8)).await
}
/// One request with `budget`: a longer budget moves the head start later by as much (4.7 s
/// with 12 s), which keeps a prompt restore ahead of it on a slow test runner.
async fn first_by(s3: &S3Source<Counted>, budget: Duration) -> (Answer, Duration) {
    let started = std::time::Instant::now();
    match s3
        .snapshot(&super::source_s3::request(), Instant::now() + budget)
        .await
    {
        SourceAnswer::Snapshot(s) => (s, started.elapsed()),
        SourceAnswer::Forward(r) | SourceAnswer::Failed(r) => panic!("no snapshot: {r}"),
    }
}
fn json(answer: &OrderedJson) -> Value {
    serde_json::from_slice(&answer.to_bytes()).unwrap()
}
/// The station rows and the history an answer gives for `town` (errors as their text).
fn said(answer: &Answer, town: &Value) -> [String; 3] {
    let text = |r: Result<OrderedJson, server2::domestic::kma::StoreError>| match r {
        Ok(j) => String::from_utf8(j.to_bytes()).unwrap(),
        Err(e) => e.0,
    };
    [
        text(answer.stn_hourly_and_min_rns(town, "202609241049", &serde_json::json!({}))),
        text(answer.city_hourly(town)),
        text(answer.history(town)),
    ]
}
/// The hourly rows of the history in an answer.
fn history_hours(answer: &Answer, town: &Value) -> usize {
    answer.history(town).map_or(0, |h| {
        json(&h)["hourly"].as_array().map_or(0, std::vec::Vec::len)
    })
}
/// The temperature of station 108's row of `hour` in an answer.
fn t1h_at(answer: &Answer, town: &Value, hour: Publication) -> Option<f64> {
    let at = (schedule::to_ms(hour) + 9 * HOUR_MS) as f64;
    json(&answer.city_hourly(town).ok()?)
        .as_array()?
        .iter()
        .find(|r| r["date"]["$date"].as_f64() == Some(at))
        .and_then(|r| r["t1h"].as_f64())
}
/// What `s3` answers once two answers in a row agree and the history is whole.
async fn steady(s3: &S3Source<Counted>) -> [String; 3] {
    let mut last = None;
    for _ in 0..160 {
        let (answer, _) = first(s3).await;
        let town = town(answer.as_ref());
        let now = said(&answer, &town);
        if history_hours(&answer, &town) == 168 && last.as_ref() == Some(&now) {
            return now;
        }
        last = Some(now);
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("the answers never settled");
}

/// RACE and FILL (stations): a restarted process whose stored pages and products answer only
/// after the request bound acquires the current pages from the head start on and answers them on
/// its first request, each asked once. Every hour of today and yesterday is stored, so nothing
/// else is acquired. The restored page of 10:00, older than the acquired one, never replaces it,
/// and the answers then equal those of a process that read S3.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_product_read_starts_the_current_pages_at_the_head_start() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let _ = producing(&peer).await;
    let counted = Counted::new(peer.transport_limited(4));
    let pages = Arc::new(Pages::default());
    let b = observed(&counted, pages.clone(), NOW);
    // The stored pages and products answer after the first request.
    let gate = counted.hold(&STATION_RAW);
    let (answer, took) = first(&b).await;
    gate.open();
    assert!(gate.was_reached(), "the restore reads during the request");
    assert!(took < Duration::from_millis(3500), "{took:?}");
    let town = town(answer.as_ref());
    let stn = answer
        .stn_hourly_and_min_rns(&town, "202609241049", &serde_json::json!({}))
        .expect("the minute and current hourly rows");
    assert_eq!(json(&stn)["stnDateTime"], "2026.09.24.10:49");
    assert_eq!(
        t1h_at(&answer, &town, p(20260924, 1000)),
        Some(21.),
        "the acquired city page of 10:00"
    );
    for once in [
        "aws-minute",
        "aws-hourly 202609241000",
        "aws-hourly 202609240900",
        "city 202609241000",
    ] {
        assert_eq!(pages.count(once), 1, "{once}: {:?}", pages.calls());
    }
    assert_eq!(
        pages.of("aws-hourly").len() + pages.of("city").len(),
        3,
        "{:?}",
        pages.calls()
    );
    let restarted = steady(&b).await;
    let (later, _) = first(&b).await;
    assert_eq!(
        t1h_at(&later, &town, p(20260924, 1000)),
        Some(21.),
        "the older restored page never replaces the acquired one"
    );
    let c = observed(
        &Counted::new(peer.transport_limited(4)),
        Arc::new(Unreachable),
        NOW,
    );
    assert_eq!(restarted, steady(&c).await, "a process that read S3");
}

/// FAST (stations and ASOS): a restore done before the head start asks no provider, and the first
/// answer equals the producing process's. The pages start on 09-17, so every day of the window
/// has a product (a day without one is read after the first answer, #2872).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fast_restore_asks_no_station_page() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = Peer::new();
    let records: Vec<RawRecord> = station_records()
        .into_iter()
        .filter(|r| r.envelope.identity.period.local_date >= 20260917)
        .collect();
    store_pages_without(&peer.transport_limited(4), records, &[]).await;
    // The producing process stores the day products and station 108's ASOS ranges.
    let a_counted = Counted::new(peer.transport_limited(4));
    let a_pages = Arc::new(Pages::default());
    let a = observed(&a_counted, a_pages.clone(), NOW);
    let produced = steady(&a).await;
    assert_eq!(a_pages.of("asos").len(), 2, "{:?}", a_pages.calls());
    for _ in 0..120 {
        if a_counted.get(&format!("PUT {PRODUCTS}")) >= DAYS.len() {
            break;
        }
        let _ = first(&a).await;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    assert!(a_counted.get(&format!("PUT {PRODUCTS}")) >= DAYS.len());
    let b_counted = Counted::new(peer.transport_limited(4));
    let pages = Arc::new(Pages::default());
    let b = observed(&b_counted, pages.clone(), NOW);
    let (answer, _) = first_by(&b, Duration::from_secs(12)).await;
    assert_eq!(pages.calls(), Vec::<String>::new(), "no provider call");
    let town = town(answer.as_ref());
    assert_eq!(said(&answer, &town), produced, "the first answer");
}

/// ASOS: before any station fold the history takes its station from the default station list
/// (Seoul 108 for the Seoul cell), so it answers on the first request while the station restore
/// runs, and a prompt ASOS restore asks no ASOS provider.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn history_uses_the_default_station_list_while_the_station_restore_runs() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let a = observed(
        &Counted::new(peer.transport_limited(4)),
        Arc::new(Pages::default()),
        NOW,
    );
    let produced = steady(&a).await;
    let counted = Counted::new(peer.transport_limited(4));
    let pages = Arc::new(Pages::default());
    let b = observed(&counted, pages.clone(), NOW);
    let gate = counted.hold(&STATION_RAW);
    let (answer, took) = first(&b).await;
    gate.open();
    assert!(
        gate.was_reached(),
        "the station restore reads during the request"
    );
    assert!(took < Duration::from_millis(3500), "{took:?}");
    let town = town(answer.as_ref());
    let history = json(&answer.history(&town).unwrap());
    assert_eq!(history["mapping"]["stationId"], "108", "{history}");
    assert_eq!(history_hours(&answer, &town), 168);
    assert_eq!(history["daily"].as_array().unwrap().len(), 7);
    assert_eq!(
        pages.of("asos"),
        Vec::<String>::new(),
        "no ASOS provider call"
    );
    // The ongoing-hour rows of the stored AWS pages join once the station restore ends.
    assert_eq!(steady(&b).await[2], produced[2], "the stored history");
}

/// RACE (ASOS): a station's ASOS restore that is not done at the head start is raced by a run
/// over the whole window (one hourly and one daily range), whose ranges answer the first request;
/// once the restore ends the history equals the stored one.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_asos_restore_answers_from_the_raced_ranges() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let a = observed(
        &Counted::new(peer.transport_limited(4)),
        Arc::new(Pages::default()),
        NOW,
    );
    let produced = steady(&a).await;
    let counted = Counted::new(peer.transport_limited(4));
    let pages = Arc::new(Pages::default());
    let b = observed(&counted, pages.clone(), NOW);
    let gate = counted.hold(&["raw/v2/data-go-kr/asos-"]);
    let (answer, took) = first(&b).await;
    gate.open();
    assert!(
        gate.was_reached(),
        "the ASOS restore reads during the request"
    );
    assert!(took < Duration::from_millis(3500), "{took:?}");
    let town = town(answer.as_ref());
    assert_eq!(history_hours(&answer, &town), 168, "the raced ranges");
    assert_eq!(
        pages.of("asos"),
        [
            "asos-hourly 202609170000-202609232300",
            "asos-daily 20260917-20260923"
        ],
        "one range of each kind"
    );
    assert_eq!(steady(&b).await[2], produced[2], "the stored history");
}

/// FILL: a raced restart acquires the hours of today and yesterday the day catalogs do not list,
/// each once, and no stored hour and no older day. At 10:10 the hour before the latest (08:00) is
/// past its ongoing reach: fetched now its page would replace the stored ongoing one, so it is not
/// asked again either.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_fill_asks_only_absent_hours_of_today_and_yesterday() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let at = schedule::to_ms(p(20260924, 1010)) as f64;
    let absent = |h: Publication| {
        (h.date() == 20260924 && [500, 600].contains(&h.time()))
            || (h.date() == 20260923 && h.hour() >= 12)
    };
    let records: Vec<RawRecord> = station_records()
        .into_iter()
        .filter(|r| {
            let period = &r.envelope.identity.period;
            let h = p(period.local_date, period.slot.parse().unwrap());
            r.envelope.identity.kind == "aws-minute" || (h <= p(20260924, 900) && !absent(h))
        })
        .collect();
    let peer = Peer::new();
    store_pages_without(&peer.transport_limited(4), records, &[]).await;
    let counted = Counted::new(peer.transport_limited(4));
    let pages = Arc::new(Pages::default());
    let b = observed(&counted, pages.clone(), at);
    let gate = counted.hold(&STATION_RAW);
    let _ = first(&b).await;
    gate.open();
    assert!(gate.was_reached(), "the restore reads during the request");
    let mut expected: Vec<String> = ["202609240600", "202609240500"]
        .into_iter()
        .map(str::to_owned)
        .chain((12..24).rev().map(|h| format!("20260923{h:02}00")))
        .map(|h| format!("aws-hourly {h}"))
        .collect();
    for _ in 0..80 {
        if expected.iter().all(|e| pages.count(e) > 0) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    expected.push("aws-hourly 202609240900".to_owned());
    expected.sort();
    let mut asked = pages.of("aws-hourly");
    asked.sort();
    assert_eq!(asked, expected, "the absent hours once each and the latest");
    let _ = steady(&b).await;
    let mut again = pages.of("aws-hourly");
    again.sort();
    assert_eq!(again, expected, "nothing is asked again");
}

/// LANES: the rest of the restart read (the days before yesterday and the minute pages after the
/// newest four), the full reads of reduced pages and the day products use the bulk lane; the first
/// answer's restore (today, yesterday, the products, the newest minutes) the request lane.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn restore_rest_and_background_reads_use_the_bulk_lane() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    // A cold read of the raw pages: today and yesterday first, the rest after the answer.
    let peer = seeded_peer(&[], Vec::new()).await;
    let (b, counted) = process(&peer);
    let _ = settle(&b).await;
    until(&b, || counted.get(&format!("PUT {PRODUCTS}")) >= DAYS.len()).await;
    let raw = |lane: &str, day: u32| {
        let at = format!("{:04}/{:02}/{:02}", day / 10000, day / 100 % 100, day % 100);
        counted.get(&format!("{lane}GET raw/v2/kma-web/aws-hourly/{at}"))
    };
    for day in [20260923, 20260924] {
        assert!(raw("", day) > 0, "{day}");
        assert_eq!(raw("bulk ", day), 0, "{day} before the answer");
    }
    for day in 20260916..=20260922 {
        assert!(raw("", day) > 0, "{day}");
        assert_eq!(raw("bulk ", day), raw("", day), "{day} after the answer");
    }
    let minutes = counted.get("GET raw/v2/kma-web/aws-minute");
    let bulk_minutes = counted.get("bulk GET raw/v2/kma-web/aws-minute");
    assert!(
        minutes - bulk_minutes <= 4 && bulk_minutes >= 12,
        "{bulk_minutes} of {minutes}"
    );
    let products = counted.get(&format!("PUT {PRODUCTS}"));
    assert_eq!(counted.get(&format!("bulk PUT {PRODUCTS}")), products);
    // A station joining the city set after the products: its full reads use the bulk lane.
    let (peer, _) = grown_city_set().await;
    let (c, counted) = process(&peer);
    let _ = settle(&c).await;
    let full = counted.get("GET raw/v2/kma-web/aws-hourly");
    assert!(full > 0);
    assert_eq!(counted.get("bulk GET raw/v2/kma-web/aws-hourly"), full);
    // The products are read on the request lane (the bulk ones read back stored products).
    assert_eq!(
        counted.get(&format!("GET {PRODUCTS}")) - counted.get(&format!("bulk GET {PRODUCTS}")),
        DAYS.len()
    );
}

/// LANES: with the bulk lane full (every bulk request held), the first answer of a restart still
/// has the 168 past hours and the minute rows; the rest of the read waits for the lane, and the
/// answers settle once it frees.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_full_bulk_lane_does_not_hold_the_first_answer_restore() {
    let _peers = super::source_s3::S3_PEERS.lock().await;
    let peer = seeded_peer(&[], Vec::new()).await;
    let (_, _, a_folded) = producing(&peer).await;
    let (b, counted) = process(&peer);
    counted.close_bulk();
    let first = answer(&b).await;
    assert_eq!(hours_of_108(&first, p(20260917, 0), p(20260923, 2300)), 168);
    assert!(!first.minute.docs().is_empty());
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(!b.settled(NOW as i64, &answer(&b).await), "the rest waits");
    counted.open_bulk();
    same(&*settle(&b).await, &a_folded, "settled");
}
