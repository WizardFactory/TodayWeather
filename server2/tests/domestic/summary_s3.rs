//! S16 END TO END over the S06 loopback S3 test peer: the native v000903 KMA backend records the
//! town's complete grid days after a served response (the `00:00` hour counted for the previous
//! day), writes nothing again for the same inputs, writes a new revision after a late input,
//! records nothing while the ASOS history read is still running, and the last-year lookup
//! acquires a missing ASOS range once (published to S06) and derives a VC day from stored raw
//! records. The acquirers are scripted doubles; no provider or AWS is reached.
use super::source_s3::{NOW, Peer, S3_PEERS, Unreachable, deadline, seed};
use serde_json::json;
use server2::domestic::asos::{AsosKind, AsosRequest};
use server2::domestic::family::WebRequest;
use server2::domestic::kma::AssemblyConfig;
use server2::domestic::kma::backend::KmaBackend;
use server2::domestic::kma::source::S3Source;
use server2::domestic::kma::source::observe::Acquire;
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::{BackendHandler, BoxFuture, backend::Native};
use server2::history::Grid;
use server2::resolver::Acquisition;
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
    RawRecord,
};
use server2::summary::lookup::{AsosOnDemand, PublishingAsos, VcRecords};
use server2::summary::{Lookup, Recorder, Source, SummaryKey, SummarySink, Target};
use server2::world::{BoundedS3, CatalogWorldStore, Cell, Range, RawFetch, WorldStore};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

const PATH: &str = "/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99";

fn town() -> SummaryKey {
    SummaryKey::Grid {
        town: ["서울특별시".into(), "종로구".into(), "청운효자동".into()],
    }
}
fn p(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
fn kst_ms(date: u32, time: u16) -> f64 {
    server2::history::schedule::to_ms(p(date, time)) as f64
}
fn current_page(date: &str, time: &str, t1h: &str) -> Vec<u8> {
    let items: Vec<serde_json::Value> = [
        ("PTY", "0"),
        ("REH", "60"),
        ("RN1", "0"),
        ("T1H", t1h),
        ("UUU", "1.2"),
        ("VEC", "200"),
        ("VVV", "-0.5"),
        ("WSD", "2.1"),
    ]
    .iter()
    .map(|(c, v)| {
        json!({"baseDate": date, "baseTime": time, "category": c, "nx": 60, "ny": 127,
               "obsrValue": v})
    })
    .collect();
    serde_json::to_vec(&json!({"response": {
        "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
        "body": {"dataType": "JSON", "items": {"item": items}, "pageNo": 1, "numOfRows": 999,
                 "totalCount": 8}}}))
    .unwrap()
}
#[allow(clippy::too_many_arguments)] // One record identity, its body and content type.
fn acquisition(
    source: &str,
    kind: &str,
    key: &server2::storage::ProviderKey,
    period: server2::storage::Period,
    partition: &str,
    fetched_at: f64,
    body: Vec<u8>,
    content_type: &str,
) -> Acquisition {
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        source,
        kind,
        key,
        period,
        fetched_at as u64,
        200,
        content_type,
        None,
        body.into(),
        &limits.raw,
    )
    .unwrap();
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![CatalogId::for_record(&record.envelope.identity, partition).unwrap()],
    };
    Acquisition {
        declaration: GroupDeclaration::new(vec![member], &limits).unwrap(),
        records: vec![record],
    }
}
/// Publish one current (`ultra-srt-ncst`) acquisition of grid 60/127.
async fn current(
    store: &CatalogStore<BoundedS3<HttpS3Transport>>,
    date: u32,
    time: u16,
    t1h: f64,
    fetched_at: f64,
) {
    let publication = p(date, time);
    let a = acquisition(
        "data-go-kr",
        "ultra-srt-ncst",
        &Grid::new(60, 127).unwrap().provider_key(),
        publication.period(),
        &publication.partition(),
        fetched_at,
        current_page(
            &format!("{date:08}"),
            &format!("{time:04}"),
            &t1h.to_string(),
        ),
        "application/json",
    );
    store
        .publish(a.declaration, a.records, deadline())
        .await
        .unwrap();
}
/// Publish the hours `hours` (1..=24; 24 is the next day's 00:00) of `date`.
async fn day(
    store: &CatalogStore<BoundedS3<HttpS3Transport>>,
    date: u32,
    hours: impl IntoIterator<Item = u16>,
) {
    for h in hours {
        let at = p(date, 0).add_hours(i64::from(h)).unwrap();
        current(
            store,
            at.date(),
            at.time(),
            10. + f64::from(h % 10),
            kst_ms(at.date(), at.time()) + 40. * 60_000.,
        )
        .await;
    }
}

/// A national AWS hourly table (`nph-aws_txt_min`, EUC-KR) with the Seoul city station.
fn aws_page(publication: &str) -> Vec<u8> {
    let cells = [
        "108",
        "서울",
        "12m",
        "<font color=red>○</font>",
        "0",
        "0.5",
        "0",
        "0",
        "0",
        "0",
        "18.4",
        "270.1",
        "W",
        "1.2",
        "265.0",
        "WSW",
        "1.4",
        "61",
        "1013.2",
        "서울특별시 종로구 송월동",
    ];
    let mut html = String::from(
        r#"<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>"#,
    );
    html.push('\n');
    html += &format!(r"<span class=ehead>[ 매분관측자료 ] {publication}</span>");
    html.push('\n');
    for part in [
        r"<table border=0 cellspacing=0 cellpadding=0>",
        r"<tr><td bgcolor=#999999>",
        r"<table border=0 cellspacing=1 cellpadding=1>",
    ] {
        html += part;
        html.push('\n');
    }
    html += r#"<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>"#;
    html.push('\n');
    html += r"<tr align=center class=text>";
    for c in cells {
        html += &format!(r"<td>{c}</td>");
    }
    for part in [
        r"</tr>",
        r"</table>",
        r"</td></tr></table>",
        r"</BODY></HTML>",
    ] {
        html += part;
        html.push('\n');
    }
    encoding_rs::EUC_KR.encode(&html).0.into_owned()
}

/// An ASOS acquirer that answers after `delay` with a failure (the history stays empty).
struct SlowAsos(Duration);
impl Acquire for SlowAsos {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        let delay = self.0;
        Box::pin(async move {
            tokio::time::sleep(delay).await;
            Err(DomesticError::Transport)
        })
    }
}
fn backend(
    peer: &Peer,
    acquire: Arc<dyn Acquire>,
) -> (KmaBackend, Recorder<BoundedS3<HttpS3Transport>>) {
    backend_with(peer, acquire, None)
}
/// [`backend`] with the S15b-4a request-time forecast acquirer.
fn backend_with(
    peer: &Peer,
    acquire: Arc<dyn Acquire>,
    forecast: Option<Arc<dyn server2::domestic::kma::source::fetch::ForecastAcquire>>,
) -> (KmaBackend, Recorder<BoundedS3<HttpS3Transport>>) {
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        acquire,
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_forecast(forecast);
    let recorder = Recorder::new(peer.transport_limited(2));
    let sink: Arc<dyn SummarySink> = Arc::new(recorder.clone());
    let backend = KmaBackend::new(
        Arc::new(source),
        Arc::new(|| NOW),
        AssemblyConfig::default(),
    )
    .with_summaries(Some(sink));
    (backend, recorder)
}
async fn serve(backend: &KmaBackend) {
    let served = backend
        .fetch_or_forward(PATH.into(), "ko".into(), deadline())
        .await
        .unwrap();
    assert!(matches!(served, Native::Served(_)), "served natively");
}
async fn names(recorder: &Recorder<BoundedS3<HttpS3Transport>>, date: u32) -> usize {
    recorder
        .store()
        .names(&town(), date, deadline())
        .await
        .unwrap()
        .len()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn served_requests_record_complete_grid_days_and_late_revisions() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let catalogs = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&catalogs, &[]).await;
    // 09-23: all 24 hours, its 2400 hour published as 09-24 00:00. 09-22: 17 hours.
    // 09-21: 23 hours (its 2400 hour missing).
    day(&catalogs, 20260923, 1..=24).await;
    day(&catalogs, 20260922, 1..=17).await;
    day(&catalogs, 20260921, 1..=23).await;
    // One AWS hourly table of 09-23 12:00 in S3: an input of 09-23 only.
    let hour = p(20260923, 1200);
    let page_at = kst_ms(20260923, 1220);
    let page = acquisition(
        "kma-web",
        "aws-hourly",
        &server2::storage::ProviderKey::Named {
            id: "aws-national".into(),
        },
        hour.period(),
        &hour.base_date(),
        page_at,
        aws_page("2026.09.23.12:00"),
        "text/html",
    );
    catalogs
        .publish(page.declaration, page.records, deadline())
        .await
        .unwrap();
    let (backend, recorder) = backend(&peer, Arc::new(Unreachable));
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    let store = recorder.store();
    let d23 = store
        .newest(&town(), 20260923, deadline())
        .await
        .unwrap()
        .expect("09-23 stored");
    assert_eq!(d23.summary.value("observationHours"), Some(24.));
    assert_eq!(d23.summary.grid, Some((60, 127)));
    // The station page read from S3 is an input of 09-23 only (with its fetch time and hash).
    assert_eq!(d23.summary.inputs.families.get("aws-hourly"), Some(&1));
    // The station registry (seed, window pages, geocodes) is an input of every date.
    assert_eq!(
        d23.summary.inputs.families.get("station-registry"),
        Some(&1)
    );
    let d21 = store
        .newest(&town(), 20260921, deadline())
        .await
        .unwrap()
        .expect("09-21 stored");
    assert_eq!(d21.summary.value("observationHours"), Some(23.));
    assert_eq!(d21.summary.value("taMax"), Some(19.));
    assert_eq!(d21.summary.inputs.families.get("aws-hourly"), None);
    assert!(
        store
            .newest(&town(), 20260922, deadline())
            .await
            .unwrap()
            .is_none(),
        "17 hours are not a day"
    );
    // Today (09-24) is never stored.
    assert_eq!(names(&recorder, 20260924).await, 0);

    // The same inputs again: no new revision.
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    assert_eq!(names(&recorder, 20260923).await, 1);
    assert_eq!(names(&recorder, 20260921).await, 1);

    // Late inputs: 09-22 reaches 18 hours; 09-21's 2400 hour (09-22 00:00) arrives warmer.
    day(&catalogs, 20260922, [18]).await;
    current(&catalogs, 20260922, 0, 30., NOW - 60_000.).await;
    let (backend, recorder) = backend_again(&peer);
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    let store = recorder.store();
    let d22 = store
        .newest(&town(), 20260922, deadline())
        .await
        .unwrap()
        .expect("09-22 stored after its late hour");
    assert_eq!(d22.summary.value("observationHours"), Some(18.));
    let d21b = store
        .newest(&town(), 20260921, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(d21b.summary.value("observationHours"), Some(24.));
    assert_eq!(d21b.summary.value("taMax"), Some(30.));
    assert!(d21b.name > d21.name, "the late revision sorts newer");
    assert_eq!(names(&recorder, 20260921).await, 2, "both revisions kept");
    assert_eq!(names(&recorder, 20260923).await, 1);
}
/// A fresh process (empty memory) over the same S3.
fn backend_again(peer: &Peer) -> (KmaBackend, Recorder<BoundedS3<HttpS3Transport>>) {
    backend(peer, Arc::new(Unreachable))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nothing_is_recorded_while_the_asos_history_read_runs() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let catalogs = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&catalogs, &[]).await;
    day(&catalogs, 20260923, 1..=24).await;
    let (backend, recorder) = backend(&peer, Arc::new(SlowAsos(Duration::from_secs(4))));
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    assert_eq!(
        names(&recorder, 20260923).await,
        0,
        "ASOS recovery in flight"
    );
    // After the recovery run ended, the next request records the day.
    tokio::time::sleep(Duration::from_secs(3)).await;
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    assert_eq!(names(&recorder, 20260923).await, 1);
}

/// The live station-108 daily body for any requested range (scripted S15b-2 acquirer).
struct LiveAsos(Mutex<Vec<String>>);
impl Acquire for LiveAsos {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(
        &self,
        request: AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            self.0.lock().unwrap().push(format!(
                "{} {}-{}",
                request.station(),
                request.start(),
                request.end()
            ));
            assert_eq!(request.asos_kind(), AsosKind::Daily);
            let body = std::fs::read(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/summary/fixtures/asos-daily-108-20251012-20251018.json"),
            )
            .unwrap();
            let start = request.start();
            Ok(Acquired::Complete(acquisition(
                "data-go-kr",
                request.asos_kind().kind(),
                &AsosRequest::record_key(request.station()),
                p(start.parse().unwrap(), 0).period(),
                &request.range_partition(),
                NOW - 1_000.,
                body,
                "application/json",
            )))
        })
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lookup_acquires_asos_once_and_derives_vc_from_stored_records() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let transport = peer.transport_limited(4);
    let catalogs =
        Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let live = Arc::new(LiveAsos(Mutex::new(Vec::new())));
    let asos: Arc<dyn AsosOnDemand> = Arc::new(PublishingAsos {
        acquire: live.clone(),
        catalogs: catalogs.clone(),
    });
    let world =
        Arc::new(CatalogWorldStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let lookup = Lookup::new(
        transport.clone(),
        Some(asos),
        Some(world.clone() as Arc<dyn VcRecords>),
    );
    let target = Target {
        town: Some(["서울특별시".into(), "종로구".into(), "청운효자동".into()]),
        station: Some("108".into()),
        cell: None,
    };
    let found = lookup
        .last_year(&target, 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((found.source, found.date), (Source::Asos, 20251015));
    assert_eq!(found.summary.value("taMin"), Some(16.1));
    assert_eq!(
        *live.0.lock().unwrap(),
        vec!["108 20251012-20251018".to_owned()]
    );
    // The raw range is published (S06) and every complete day stored: a new lookup finds the
    // neighbouring date without a provider call.
    let again = Lookup::new(transport.clone(), None, None);
    let found = again
        .last_year(&target, 20261013, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((found.source, found.date), (Source::Asos, 20251013));
    let raw = catalogs
        .lookup(
            &CatalogId {
                source: "data-go-kr".into(),
                kind: "asos-daily".into(),
                key_sha256: server2::storage::sha256(
                    &AsosRequest::record_key("108").canonical_bytes().unwrap(),
                ),
                partition: "20251012-20251018".into(),
            },
            deadline(),
        )
        .await
        .unwrap();
    assert!(matches!(raw, server2::storage::LookupOutcome::Ready(_)));

    // VC: a stored Seoul cell body fetched after 2025-10-14 ended.
    let cell = Cell {
        lat: 37.57,
        lon: 126.97,
    };
    let start = 1_760_367_600_i64; // 2025-10-14 00:00 KST
    let hours: Vec<serde_json::Value> = (0..24)
        .map(|i| json!({"datetimeEpoch": start + i * 3600, "temp": 59.0 + i as f64}))
        .collect();
    let body = serde_json::to_vec(&json!({"timezone": "Asia/Seoul", "tzoffset": 9.0,
        "days": [{"datetime": "2025-10-14", "precip": 0.02, "hours": hours}]}))
    .unwrap();
    world
        .publish(
            cell,
            RawFetch {
                fetched_at_ms: (start as u64 + 86_400 + 3_600) * 1000,
                range: Range::Recent,
                first_date: 20251014,
                sha256: server2::storage::sha256(&body),
                body: Arc::from(body),
            },
            deadline(),
        )
        .await
        .unwrap();
    let vc_only = Target {
        town: None,
        station: None,
        cell: Some((3757, 12697)),
    };
    let found = lookup
        .last_year(&vc_only, 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (found.source, found.date, found.offset),
        (Source::Vc, 20251014, -1)
    );
    assert_eq!(found.summary.value("taMin"), Some(15.));
    assert_eq!(found.summary.value("localHours"), Some(24.));
    assert_eq!(found.summary.value("rn1"), Some(0.5));
    let stored = Lookup::new(transport.clone(), None, None)
        .last_year(&vc_only, 20261015, deadline())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.summary, found.summary, "the VC day is stored");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_the_current_fold_of_a_complete_read_is_settled() {
    use server2::domestic::kma::source::observe::{Folded, Observations};
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let transport = peer.transport_limited(4);
    let catalogs =
        Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let observations = Arc::new(Observations::new(
        transport,
        catalogs,
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    ));
    let now = NOW as i64;
    let folded = observations.stations(now, deadline()).await.unwrap();
    assert!(
        observations.settled(now, &folded),
        "every window day read, fold current"
    );
    // A fold the snapshot did not take (an older or newer one) is not settled.
    assert!(!observations.settled(now, &Arc::new(Folded::default())));
}

/// Publish registry seed imports (fetch instants `ats`) on a fresh peer, apply `fault` to the
/// catalog (`corrupt`) or to the newest import's raw body (`forget`), and report whether the
/// station state is settled.
async fn seed_settled(ats: &[f64], fault: &str) -> bool {
    use server2::domestic::kma::source::observe::Observations;
    let peer = Peer::new();
    let transport = peer.transport_limited(4);
    let catalogs =
        Arc::new(CatalogStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let at = p(20260924, 0);
    let mut target = String::new();
    for fetched_at in ats {
        let seed = acquisition(
            "legacy-mongo",
            "kma-stn-info",
            &server2::domestic::kma::source::seed::key(),
            at.period(),
            "20260924",
            *fetched_at,
            b"{}".to_vec(),
            "application/json",
        );
        target = if fault == "corrupt" {
            CatalogId::for_record(&seed.records[0].envelope.identity, "20260924")
                .unwrap()
                .key()
        } else {
            seed.records[0].envelope.identity.object_key().unwrap()
        };
        catalogs
            .publish(seed.declaration, seed.records, deadline())
            .await
            .unwrap();
    }
    if !fault.is_empty() {
        reqwest::Client::new()
            .post(format!(
                "{}__catalog?mode={fault}&key={target}",
                peer.endpoint()
            ))
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap();
    }
    let observations = Arc::new(Observations::new(
        transport,
        catalogs,
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    ));
    let now = NOW as i64;
    let folded = observations.stations(now, deadline()).await.unwrap();
    observations.settled(now, &folded)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_or_partial_registry_seed_read_is_not_settled() {
    let _peers = S3_PEERS.lock().await;
    // Readable imports (not parseable, so the carried seed stays): settled.
    assert!(seed_settled(&[NOW - 7_200_000., NOW - 3_600_000.], "").await);
    // The seed catalog reads corrupt.
    assert!(!seed_settled(&[NOW - 3_600_000.], "corrupt").await);
    // The newest import's raw body is missing: S06 excludes it, the older import still reads.
    assert!(!seed_settled(&[NOW - 7_200_000., NOW - 3_600_000.], "forget").await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_partial_grid_read_records_nothing() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let catalogs = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&catalogs, &[]).await;
    day(&catalogs, 20260923, 1..=24).await;
    // A second acquisition of 09-23 12:00 whose raw body is then missing: S06 excludes the
    // group, so the read is partial.
    let publication = p(20260923, 1200);
    let late = acquisition(
        "data-go-kr",
        "ultra-srt-ncst",
        &Grid::new(60, 127).unwrap().provider_key(),
        publication.period(),
        &publication.partition(),
        NOW - 120_000.,
        current_page("20260923", "1200", "25"),
        "application/json",
    );
    let raw_key = late.records[0].envelope.identity.object_key().unwrap();
    catalogs
        .publish(late.declaration, late.records, deadline())
        .await
        .unwrap();
    reqwest::Client::new()
        .post(format!(
            "{}__catalog?mode=forget&key={raw_key}",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    let (backend, recorder) = backend(&peer, Arc::new(Unreachable));
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    assert_eq!(
        names(&recorder, 20260923).await,
        0,
        "partial read: nothing stored"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_partial_vc_read_stores_no_vc_day() {
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let transport = peer.transport_limited(4);
    let world =
        Arc::new(CatalogWorldStore::new(transport.clone(), CatalogLimits::default()).unwrap());
    let cell = Cell {
        lat: 37.57,
        lon: 126.97,
    };
    let start = 1_760_367_600_i64; // 2025-10-14 00:00 KST
    let body = |temp: f64| {
        let hours: Vec<serde_json::Value> = (0..24)
            .map(|i| json!({"datetimeEpoch": start + i * 3600, "temp": temp}))
            .collect();
        serde_json::to_vec(&json!({"timezone": "Asia/Seoul", "tzoffset": 9.0,
            "days": [{"datetime": "2025-10-14", "hours": hours}]}))
        .unwrap()
    };
    let mut newest = String::new();
    for (i, temp) in [59., 68.].into_iter().enumerate() {
        let bytes = body(temp);
        let fetched_at = (start as u64 + 86_400 + 3_600 * (i as u64 + 1)) * 1000;
        let record = RawRecord::new(
            "vc",
            "timeline",
            &server2::storage::ProviderKey::WorldCell {
                lat_hundredths: 3757,
                lon_hundredths: 12697,
            },
            server2::storage::Period {
                local_date: 20251014,
                slot: "recent".into(),
            },
            fetched_at,
            200,
            "application/json",
            None,
            bytes.clone().into(),
            &CatalogLimits::default().raw,
        )
        .unwrap();
        newest = record.envelope.identity.object_key().unwrap();
        world
            .publish(
                cell,
                RawFetch {
                    fetched_at_ms: fetched_at,
                    range: Range::Recent,
                    first_date: 20251014,
                    sha256: server2::storage::sha256(&bytes),
                    body: Arc::from(bytes),
                },
                deadline(),
            )
            .await
            .unwrap();
    }
    // The newest body is missing: S06 excludes its group and the read is partial.
    reqwest::Client::new()
        .post(format!(
            "{}__catalog?mode=forget&key={newest}",
            peer.endpoint()
        ))
        .header("X-Server2-Test-Key", "server2-local")
        .send()
        .await
        .unwrap();
    let lookup = Lookup::new(
        transport.clone(),
        None,
        Some(world.clone() as Arc<dyn VcRecords>),
    );
    let vc_only = Target {
        town: None,
        station: None,
        cell: Some((3757, 12697)),
    };
    assert!(
        lookup
            .last_year(&vc_only, 20261015, deadline())
            .await
            .is_err(),
        "a partial VC read is an error, not the older body's day"
    );
    let stored = SummaryKey::Vc {
        lat: 3757,
        lon: 12697,
    };
    assert!(
        lookup
            .store()
            .names(&stored, 20251014, deadline())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_request_time_backfill_is_a_late_input_of_a_stored_day() {
    use server2::domestic::family::DataGoKrFamily;
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    let _peers = S3_PEERS.lock().await;
    /// S15b-4a acquirer double: publishes the 09-24 00:00 current observation (09-23's 2400
    /// hour, a backfill publication the request does not wait for); nothing else is new.
    struct Provider(Arc<CatalogStore<BoundedS3<HttpS3Transport>>>);
    impl ForecastAcquire for Provider {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> BoxFuture<'static, Result<Published, String>> {
            let store = self.0.clone();
            Box::pin(async move {
                let ForecastRequest::DataGoKr(r) = request else {
                    return Ok(None);
                };
                if r.family() != DataGoKrFamily::UltraSrtNcst || r.publication() != p(20260924, 0) {
                    return Ok(None);
                }
                let a = acquisition(
                    "data-go-kr",
                    "ultra-srt-ncst",
                    &Grid::new(60, 127).unwrap().provider_key(),
                    r.publication().period(),
                    &r.publication().partition(),
                    NOW - 1_000.,
                    current_page("20260924", "0000", "30"),
                    "application/json",
                );
                let records = a.records.clone();
                store
                    .publish(a.declaration, a.records, deadline())
                    .await
                    .map_err(|e| format!("{e:?}"))?;
                Ok(Some(records))
            })
        }
    }
    let peer = Peer::new();
    let catalogs = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    seed(&catalogs, &[]).await;
    day(&catalogs, 20260923, 1..=23).await;
    let (backend, recorder) = backend_with(
        &peer,
        Arc::new(Unreachable),
        Some(Arc::new(Provider(catalogs.clone()))),
    );
    // The native answer is served and 09-23 is recorded with the 23 hours the request read.
    serve(&backend).await;
    assert!(recorder.idle(deadline()).await);
    let store = recorder.store();
    let first = store
        .newest(&town(), 20260923, deadline())
        .await
        .unwrap()
        .expect("09-23 stored");
    assert_eq!(first.summary.value("observationHours"), Some(23.));
    // The owned backfill publishes the 2400 hour; a later request records a newer revision.
    let mut revised = None;
    // Up to 20 s for the owned backfill pass (CI runners are slower than the 250 ms steps).
    for _ in 0..80 {
        serve(&backend).await;
        assert!(recorder.idle(deadline()).await);
        let newest = store
            .newest(&town(), 20260923, deadline())
            .await
            .unwrap()
            .unwrap();
        if newest.summary.value("observationHours") == Some(24.) {
            revised = Some(newest);
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let revised = revised.expect("the backfilled 2400 hour is recorded");
    assert_eq!(revised.summary.value("taMax"), Some(30.));
    assert!(revised.name > first.name);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_requests_own_acquisition_keeps_its_stored_identity() {
    use server2::domestic::family::DataGoKrFamily;
    use server2::domestic::kma::backend::{KmaSource, SourceAnswer};
    use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
    let _peers = S3_PEERS.lock().await;
    /// Publishes the latest (10:00) current observation, fetched after the request instant.
    struct Provider(Arc<CatalogStore<BoundedS3<HttpS3Transport>>>);
    const FETCHED: f64 = NOW + 5_000.;
    impl ForecastAcquire for Provider {
        fn acquire(
            &self,
            request: ForecastRequest,
        ) -> BoxFuture<'static, Result<Published, String>> {
            let store = self.0.clone();
            Box::pin(async move {
                let ForecastRequest::DataGoKr(r) = request else {
                    return Ok(None);
                };
                if r.family() != DataGoKrFamily::UltraSrtNcst
                    || r.publication() != p(20260924, 1000)
                {
                    return Ok(None);
                }
                let a = acquisition(
                    "data-go-kr",
                    "ultra-srt-ncst",
                    &Grid::new(60, 127).unwrap().provider_key(),
                    r.publication().period(),
                    &r.publication().partition(),
                    FETCHED,
                    current_page("20260924", "1000", "21.5"),
                    "application/json",
                );
                let records = a.records.clone();
                store
                    .publish(a.declaration, a.records, deadline())
                    .await
                    .map_err(|e| format!("{e:?}"))?;
                Ok(Some(records))
            })
        }
    }
    let peer = Peer::new();
    let catalogs = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    seed(&catalogs, &["current"]).await;
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap()
    .with_forecast(Some(Arc::new(Provider(catalogs.clone()))));
    let identity = |snapshot: &dyn server2::domestic::kma::KmaStore| {
        snapshot
            .summary_inputs()
            .expect("complete reads")
            .ids
            .into_iter()
            .filter(|id| {
                id.family == "ultra-srt-ncst" && id.start_ms == kst_ms(20260924, 1000) as i64
            })
            .collect::<Vec<_>>()
    };
    // First request: the publication is acquired by the request itself.
    let SourceAnswer::Snapshot(first) = source
        .snapshot(&super::source_s3::request(), deadline())
        .await
    else {
        panic!("forwarded");
    };
    let own = identity(first.as_ref());
    assert_eq!(own.len(), 1);
    assert_eq!(
        own[0].fetched_at_ms, FETCHED as u64,
        "stored fetch time, not the request instant"
    );
    // A later request (another process, after the fetch) reads the stored record: the same
    // identity, so the same input digest and no extra revision.
    let later = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| NOW + 10_000.),
        Arc::new(Unreachable),
        Arc::new(Unreachable),
    )
    .unwrap();
    let SourceAnswer::Snapshot(third) = later
        .snapshot(&super::source_s3::request(), deadline())
        .await
    else {
        panic!("forwarded");
    };
    assert_eq!(identity(third.as_ref()), own);
}

/// Verify sink calls through the shared older-version backend. v000705 repairs current rows
/// differently, so those rows must not become revisions of the v000903 summary baseline.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn older_native_routes_record_only_compatible_daily_rows() {
    use server2::domestic::kma::backend::{parse_path, parse_town_path};
    use server2::gateway::OrderedJson;
    use server2::summary::GridInputs;
    #[derive(Default)]
    struct Sink(Mutex<Vec<Vec<OrderedJson>>>);
    impl SummarySink for Sink {
        fn record(&self, _: GridInputs, rows: Vec<OrderedJson>, _: f64) {
            self.0.lock().unwrap().push(rows);
        }
    }
    let _peers = S3_PEERS.lock().await;
    let peer = Peer::new();
    let catalogs = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    seed(&catalogs, &[]).await;
    day(&catalogs, 20260923, 1..=24).await;
    let (backend, _) = backend(&peer, Arc::new(Unreachable));
    let sink = Arc::new(Sink::default());
    let backend = backend.with_summaries(Some(sink.clone()));
    let suffix = PATH.strip_prefix("/v000903/kma/addr").unwrap();
    for (mount, records) in [
        ("/v000903/kma/addr", true),
        ("/v000902/kma/addr", true),
        ("/v000901/kma/addr", true),
        ("/v000803/town", true),
        ("/v000705/town", false),
    ] {
        let path = format!("{mount}{suffix}");
        let request = parse_path(&path, "ko")
            .or_else(|_| parse_town_path(&path, "ko"))
            .unwrap();
        let before = sink.0.lock().unwrap().len();
        let outcome = backend.outcome(request, deadline()).await.unwrap();
        if records {
            assert!(
                matches!(outcome, server2::domestic::kma::Outcome::Json(_)),
                "{mount}"
            );
        } else {
            assert!(
                matches!(outcome, server2::domestic::kma::Outcome::Undefined),
                "{mount}"
            );
        }
        let rows = sink.0.lock().unwrap();
        assert_eq!(rows.len(), before + usize::from(records), "{mount}");
        if records {
            assert!(!rows.last().unwrap().is_empty(), "{mount}");
        }
    }
}
