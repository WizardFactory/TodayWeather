//! #2614 review RP-lagging-current-publication: the row the client shows as current
//! (`currentIndex`) follows the observation's time, so a lagging observation marks a row the clock
//! counts as past. From an empty store, through the observed source and the assembly, that row
//! gets the forecast of the publication covering it, and nothing more is requested when the
//! observation does not lag. Scripted providers only; no provider is reached.
use super::observe::{asos_body, aws_page, city_page};
use super::source_s3::{
    Peer, S3_PEERS, Unreachable, current_page, envelope, forecast_items, land_item, mid_page,
    rss_xml, slots, temp_item, zone_page,
};
use serde_json::{Value, json};
use server2::domestic::asos::{AsosKind, AsosRequest};
use server2::domestic::family::{DataGoKrFamily as F, WebFamily, WebRequest};
use server2::domestic::kma::backend::{KmaSource, SourceAnswer, parse_path};
use server2::domestic::kma::source::S3Source;
use server2::domestic::kma::source::fetch::{ForecastAcquire, ForecastRequest, Published};
use server2::domestic::kma::source::observe::Acquire;
use server2::domestic::kma::{AssemblyConfig, Outcome, assemble};
use server2::domestic::publication::Publication;
use server2::domestic::{Acquired, DomesticError};
use server2::gateway::BoxFuture;
use server2::resolver::Acquisition;
use server2::storage::response_first::{Batch, Config, Writer};
use server2::storage::{
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, ProviderKey, RawRecord,
};
use server2::warnings::store::{StoreConfig, WarningStore};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

fn publication(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
/// UTC milliseconds of a KST wall-clock time.
fn kst(date: u32, time: u16) -> f64 {
    server2::history::schedule::to_ms(publication(date, time)) as f64
}
/// One complete acquisition fetched at `fetched_at`, before the request instant.
#[allow(clippy::too_many_arguments)]
fn acquisition(
    source: &str,
    kind: &str,
    key: &ProviderKey,
    period: Publication,
    partition: &str,
    body: Vec<u8>,
    content_type: &str,
    fetched_at: f64,
) -> Acquisition {
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        source,
        kind,
        key,
        period.period(),
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
/// A complete `getVilageFcst` page of `p` for the Seoul cell: hourly rows to the third (fourth
/// from 17:00) midnight, then three-hourly rows for a day. Its probability is `p`'s hour, so a
/// row shows which publication it came from.
fn short_page(p: Publication) -> Vec<u8> {
    let days = if p.hour() >= 17 { 4 } else { 3 };
    let extension = days * 24 - i64::from(p.hour());
    let mut offsets: Vec<i64> = (1..extension).collect();
    offsets.extend((0..8).map(|i| extension + i * 3));
    let mut items = Vec::new();
    for offset in offsets {
        let at = p.add_hours(offset).unwrap();
        let (date, time) = (at.base_date(), at.base_time());
        let mut values = vec![
            ("TMP", "17".to_owned()),
            ("UUU", "1.1".into()),
            ("VVV", "-0.4".into()),
            ("VEC", "180".into()),
            ("WSD", "2.5".into()),
            ("SKY", "1".into()),
            ("PTY", "0".into()),
            ("POP", p.hour().to_string()),
            ("PCP", "강수없음".into()),
            ("REH", "70".into()),
            ("SNO", "적설없음".into()),
            ("WAV", "0.5".into()),
        ];
        if time == "0600" {
            values.push(("TMN", "12".into()));
        }
        if time == "1500" {
            values.push(("TMX", "24".into()));
        }
        for (category, value) in values {
            items.push(json!({"baseDate": p.base_date(), "baseTime": p.base_time(),
                "category": category, "fcstDate": date, "fcstTime": time, "fcstValue": value,
                "nx": 60, "ny": 127}));
        }
    }
    envelope(items)
}

/// The station pages and ASOS ranges, with the live minute page from `minute`.
struct Stations {
    now: f64,
    minute: Publication,
}
impl Acquire for Stations {
    fn web(
        &self,
        request: WebRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            let dotted = |p: Publication, padded: bool| {
                let d = p.base_date();
                let (month, day) = (&d[4..6], &d[6..]);
                let (month, day) = if padded {
                    (month.to_owned(), day.to_owned())
                } else {
                    (
                        month.trim_start_matches('0').to_owned(),
                        day.trim_start_matches('0').to_owned(),
                    )
                };
                format!(
                    "{}.{month}.{day}.{:02}:{:02}",
                    &d[..4],
                    p.hour(),
                    p.minute()
                )
            };
            let (kind, p, body, ct) = match request.family() {
                WebFamily::AwsMinute => (
                    "aws-minute",
                    self.minute,
                    aws_page(&dotted(self.minute, true), false),
                    "text/html",
                ),
                WebFamily::AwsHourly => {
                    let p = request.publication().unwrap();
                    (
                        "aws-hourly",
                        p,
                        aws_page(&dotted(p, true), false),
                        "text/html",
                    )
                }
                WebFamily::CityObservation => {
                    let p = request.publication().unwrap();
                    (
                        "city-obs",
                        p,
                        city_page(&dotted(p, false)),
                        "text/html;charset=UTF-8",
                    )
                }
                _ => return Err(DomesticError::Transport),
            };
            Ok(Acquired::Complete(acquisition(
                "kma-web",
                kind,
                &request.provider_key(),
                p,
                &p.base_date(),
                body,
                ct,
                self.now - 1000.,
            )))
        })
    }
    fn asos(
        &self,
        request: AsosRequest,
        _: Instant,
    ) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        Box::pin(async move {
            let mut rows = Vec::new();
            for day in 17..=23 {
                match request.asos_kind() {
                    AsosKind::Hourly => {
                        for hour in 0..24 {
                            rows.push(json!({"tm": format!("2026-09-{day} {hour:02}:00"),
                                "stnId": "108", "ta": "17", "hm": "60", "rn": "", "rnQcflg": "",
                                "dc10Tca": "10", "dmstMtphNo": "", "ws": "2", "wd": "180"}));
                        }
                    }
                    AsosKind::Daily => rows.push(json!({"tm": format!("2026-09-{day}"),
                        "stnId": "108", "minTa": "7", "maxTa": "27", "avgTa": "17",
                        "avgRhm": "60", "sumRn": "", "sumRnDur": "", "iscs": "", "avgWs": "2"})),
                }
            }
            let start = request.start();
            Ok(Acquired::Complete(acquisition(
                "data-go-kr",
                request.asos_kind().kind(),
                &AsosRequest::record_key(request.station()),
                publication(start[..8].parse().unwrap(), 0),
                &request.range_partition(),
                asos_body(rows),
                "application/json",
                self.now - 1000.,
            )))
        })
    }
}

/// Every forecast family, published through the raw writer; short forecast requests are logged.
struct Forecasts {
    now: f64,
    writer: Arc<Writer>,
    short: Arc<Mutex<Vec<Publication>>>,
}
impl ForecastAcquire for Forecasts {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let (writer, short, fetched_at) =
            (self.writer.clone(), self.short.clone(), self.now - 1000.);
        Box::pin(async move {
            if request == ForecastRequest::Warnings {
                return Ok(None);
            }
            let key = format!("test-forecast/{request:?}");
            // The writer's admission per group, as the full-response doubles size it.
            let reserve = match &request {
                ForecastRequest::DataGoKr(r) => {
                    r.family().max_pages() as usize * 8 * 1024 * 1024 + 8 * 1024 * 1024
                }
                ForecastRequest::Zones => 88 * 1024 * 1024,
                _ => 16 * 1024 * 1024,
            };
            writer
                .acquire(
                    key,
                    reserve,
                    Instant::now() + Duration::from_secs(10),
                    async move {
                        let (source, kind, key, p, partition, body, ct) = match request {
                            ForecastRequest::DataGoKr(r) => {
                                let base = r.publication();
                                let (p, body) = match r.family() {
                                    F::UltraSrtNcst => (
                                        base,
                                        current_page(&base.base_date(), &base.base_time(), "8.5"),
                                    ),
                                    F::UltraSrtFcst => {
                                        let p = publication(base.date(), base.time() / 100 * 100);
                                        let at = slots(p.date(), p.time(), &[1, 2, 3, 4, 5, 6]);
                                        let items = forecast_items(
                                            (&base.base_date(), &base.base_time()),
                                            &at,
                                            &|_, _| {
                                                vec![
                                                    ("POP", "20".into()),
                                                    ("LGT", "0".into()),
                                                    ("PTY", "0".into()),
                                                    ("RN1", "강수없음".into()),
                                                    ("SKY", "1".into()),
                                                    ("T1H", "9".into()),
                                                    ("REH", "60".into()),
                                                    ("UUU", "0.4".into()),
                                                    ("VVV", "-1.1".into()),
                                                    ("WSD", "2".into()),
                                                    ("VEC", "180".into()),
                                                ]
                                            },
                                        );
                                        (p, envelope(items))
                                    }
                                    F::VilageFcst => {
                                        short.lock().unwrap().push(base);
                                        (base, short_page(base))
                                    }
                                    F::MidFcst => {
                                        (base, mid_page(vec![json!({"wfSv":"맑겠습니다."})]))
                                    }
                                    F::MidLandFcst => (base, mid_page(vec![land_item()])),
                                    F::MidTa => (base, mid_page(vec![temp_item()])),
                                    other => panic!("unexpected family {other:?}"),
                                };
                                (
                                    "data-go-kr",
                                    r.family().kind(),
                                    r.provider_key(),
                                    p,
                                    p.partition(),
                                    body,
                                    "application/json",
                                )
                            }
                            ForecastRequest::Rss(r) => {
                                let p = publication(20260924, 800);
                                (
                                    "kma-web",
                                    "town-rss",
                                    r.provider_key(),
                                    p,
                                    p.partition(),
                                    rss_xml(),
                                    "application/xml",
                                )
                            }
                            ForecastRequest::Zones => {
                                let p = publication(20260924, 0);
                                (
                                    "data-go-kr",
                                    "forecast-zone",
                                    ProviderKey::Named {
                                        id: "forecast-zones".into(),
                                    },
                                    p,
                                    p.base_date(),
                                    zone_page(),
                                    "application/json",
                                )
                            }
                            ForecastRequest::Warnings => unreachable!(),
                        };
                        let a =
                            acquisition(source, kind, &key, p, &partition, body, ct, fetched_at);
                        Ok(Some(Batch {
                            declaration: a.declaration,
                            records: a.records,
                        }))
                    },
                )
                .await
                .map(|r| r.map(|r| r.records.clone()))
                .map_err(|e| format!("{e}"))
        })
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.writer
            .cached(&format!("test-forecast/{request:?}"))
            .map(|r| r.records.clone())
    }
}

/// 서울특별시 종로구 청운효자동 (the Seoul cell 60,127) answered at `now` from an empty store, with
/// the live station reading of `minute`: the body and the short publications requested.
async fn answered(now: f64, minute: Publication) -> (Value, Vec<Publication>) {
    let peer = Peer::persistent();
    let store =
        Arc::new(CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap());
    let writer = Writer::new(store, Config::default()).unwrap();
    let short = Arc::new(Mutex::new(Vec::new()));
    let warnings = Arc::new(
        WarningStore::new(
            peer.transport_limited(2),
            CatalogLimits::default(),
            StoreConfig::default(),
        )
        .unwrap(),
    );
    let source = S3Source::new_observed_with_warning_store(
        peer.transport_limited(4),
        Arc::new(move || now),
        Arc::new(Stations { now, minute }),
        Arc::new(Unreachable),
        warnings,
    )
    .unwrap()
    .with_forecast(Some(Arc::new(Forecasts {
        now,
        writer: writer.clone(),
        short: short.clone(),
    })))
    .with_raw_writer(writer);
    let encoded = |name: &str| -> String { name.bytes().map(|b| format!("%{b:02X}")).collect() };
    let path = format!(
        "/v000903/kma/addr/{}/{}/{}",
        encoded("서울특별시"),
        encoded("종로구"),
        encoded("청운효자동")
    );
    // The observed request's budget (8 s): its waits end 2.5 s after it starts.
    let deadline = Instant::now() + Duration::from_secs(8);
    let request = source
        .prepare(parse_path(&path, "").unwrap(), deadline)
        .await
        .unwrap_or_else(|_| panic!("prepared"));
    let SourceAnswer::Snapshot(snapshot) = source.snapshot(&request, deadline).await else {
        panic!("a snapshot")
    };
    let out = assemble(&request, snapshot.as_ref(), now, AssemblyConfig::default());
    let Outcome::Json(body) = out else {
        panic!("assembly failed: {out:?}")
    };
    let mut requested = short.lock().unwrap().clone();
    requested.sort();
    (serde_json::from_slice(&body.to_bytes()).unwrap(), requested)
}
fn row(body: &Value, date: &str, time: u32) -> Value {
    body["short"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["date"] == date && r["time"] == time)
        .unwrap_or_else(|| panic!("{date} {time} row"))
        .clone()
}
fn marked(body: &Value) -> Vec<(String, u64)> {
    body["short"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["currentIndex"] == true)
        .map(|r| {
            (
                r["date"].as_str().unwrap().to_owned(),
                r["time"].as_u64().unwrap(),
            )
        })
        .collect()
}

/// 09:10 KST with the latest live reading from 08:51: `currentIndex` marks the 06:00 row. The
/// latest publication (08:00) starts at 09:00, so the 05:00 publication covers the marked row
/// and must be acquired like the one covering the clock-current row.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_row_shown_as_current_gets_the_publication_covering_it() {
    let _peers = S3_PEERS.lock().await;
    let (body, requested) = answered(kst(20260924, 910), publication(20260924, 851)).await;
    assert_eq!(
        body["current"]["dateObj"], "2026.09.24 08:51",
        "the observation the client is shown: {}",
        body["current"]
    );
    assert_eq!(marked(&body), vec![("20260924".to_owned(), 6)]);
    let shown = row(&body, "20260924", 6);
    assert_eq!(shown["pop"], 5, "the 05:00 publication's row: {shown}");
    assert_eq!(shown["wav"], 0.5, "{shown}");
    assert_eq!(
        row(&body, "20260924", 9)["pop"],
        8,
        "the 08:00 publication's row"
    );
    assert_eq!(
        requested,
        vec![publication(20260924, 500), publication(20260924, 800)],
        "one acquisition each"
    );
}

/// A fresh reading marks the clock-current row, which the latest publication covers: no older
/// publication is requested (the call bound).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fresh_observation_needs_no_older_publication() {
    let _peers = S3_PEERS.lock().await;
    let (body, requested) = answered(kst(20260924, 910), publication(20260924, 908)).await;
    assert_eq!(marked(&body), vec![("20260924".to_owned(), 9)]);
    assert_eq!(row(&body, "20260924", 9)["pop"], 8);
    assert_eq!(requested, vec![publication(20260924, 800)]);
}
