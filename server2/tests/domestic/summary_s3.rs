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
    let source = S3Source::new(
        peer.transport_limited(4),
        Arc::new(|| NOW),
        acquire,
        Arc::new(Unreachable),
    )
    .unwrap();
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
