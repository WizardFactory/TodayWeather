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
    CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
    ProviderKey, RawRecord,
};
use server2::warnings::store::{StoreConfig, WarningStore};
use server2::world::BoundedS3;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;

pub(super) fn publication(date: u32, time: u16) -> Publication {
    Publication::new(date, time).unwrap()
}
/// UTC milliseconds of a KST wall-clock time.
pub(super) fn kst(date: u32, time: u16) -> f64 {
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

/// The station pages and ASOS ranges, with the live minute page from `minute` (None: the minute
/// page fails, so the station answers no reading). The `untyped` ASOS hours carry an uncoded
/// amount too cold for the wet-bulb rule, so their precipitation type stays unknown.
struct Stations {
    now: f64,
    minute: Option<Publication>,
    untyped: Vec<Publication>,
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
                WebFamily::AwsMinute => {
                    let Some(minute) = self.minute else {
                        return Err(DomesticError::Transport);
                    };
                    (
                        "aws-minute",
                        minute,
                        aws_page(&dotted(minute, true), false),
                        "text/html",
                    )
                }
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
                            let untyped = self
                                .untyped
                                .contains(&publication(20260900 + day, hour * 100));
                            let (ta, rn) = if untyped { ("2", "0.5") } else { ("17", "") };
                            rows.push(json!({"tm": format!("2026-09-{day} {hour:02}:00"),
                                "stnId": "108", "ta": ta, "hm": "60", "rn": rn, "rnQcflg": "",
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

/// Every forecast family, published through the raw writer; short forecast and current
/// observation requests are logged when made, and the current observations answered in
/// `nowcasts`. With `held` (an earlier current observation, a short publication), that
/// observation answers only once that short publication has answered. The `raining` current
/// observations report rain; the `late` one answers only once `late_released`.
struct Forecasts {
    now: f64,
    writer: Arc<Writer>,
    short: Arc<Mutex<Vec<Publication>>>,
    current: Arc<Mutex<Vec<Publication>>>,
    nowcasts: Arc<tokio::sync::watch::Sender<Vec<Publication>>>,
    held: Option<(Publication, Publication)>,
    released: Arc<tokio::sync::watch::Sender<bool>>,
    raining: Vec<Publication>,
    late: Option<Publication>,
    late_released: Arc<tokio::sync::watch::Sender<bool>>,
}
impl ForecastAcquire for Forecasts {
    fn acquire(&self, request: ForecastRequest) -> BoxFuture<'static, Result<Published, String>> {
        let (writer, short, fetched_at) =
            (self.writer.clone(), self.short.clone(), self.now - 1000.);
        let is = |family: F, p: Option<Publication>| {
            matches!(&request, ForecastRequest::DataGoKr(r)
                if r.family() == family && Some(r.publication()) == p)
        };
        let hold = is(F::UltraSrtNcst, self.held.map(|h| h.0)).then(|| self.released.subscribe());
        let release = is(F::VilageFcst, self.held.map(|h| h.1)).then(|| self.released.clone());
        let late = is(F::UltraSrtNcst, self.late).then(|| self.late_released.subscribe());
        let nowcast = match &request {
            ForecastRequest::DataGoKr(r) if r.family() == F::UltraSrtNcst => {
                self.current.lock().unwrap().push(r.publication());
                Some((r.publication(), self.nowcasts.clone()))
            }
            _ => None,
        };
        let raining = self.raining.clone();
        Box::pin(async move {
            if request == ForecastRequest::Warnings {
                return Ok(None);
            }
            if let Some(mut released) = hold {
                let _ = released.wait_for(|released| *released).await;
            }
            if let Some(mut released) = late {
                let _ = released.wait_for(|released| *released).await;
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
            let answer = writer
                .acquire(
                    key,
                    reserve,
                    Instant::now() + Duration::from_secs(10),
                    async move {
                        let (source, kind, key, p, partition, body, ct) = match request {
                            ForecastRequest::DataGoKr(r) => {
                                let base = r.publication();
                                let (p, body) = match r.family() {
                                    F::UltraSrtNcst => {
                                        let (date, time) = (base.base_date(), base.base_time());
                                        let page = if raining.contains(&base) {
                                            raining_page(&date, &time)
                                        } else {
                                            current_page(&date, &time, "8.5")
                                        };
                                        (base, page)
                                    }
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
                .map_err(|e| format!("{e}"));
            if let Some(release) = release {
                release.send_replace(true);
            }
            if let Some((p, nowcasts)) = nowcast {
                nowcasts.send_modify(|answered| answered.push(p));
            }
            answer
        })
    }
    fn cached(&self, request: &ForecastRequest) -> Published {
        self.writer
            .cached(&format!("test-forecast/{request:?}"))
            .map(|r| r.records.clone())
    }
}

/// A current observation page reporting rain (PTY 1, 0.5 mm).
fn raining_page(date: &str, time: &str) -> Vec<u8> {
    let values = [
        ("PTY", "1"),
        ("REH", "90"),
        ("RN1", "0.5"),
        ("T1H", "8.5"),
        ("UUU", "1.2"),
        ("VEC", "200"),
        ("VVV", "-0.5"),
        ("WSD", "2.1"),
    ];
    envelope(
        values
            .iter()
            .map(|(c, v)| {
                json!({"baseDate": date, "baseTime": time, "category": c, "nx": 60, "ny": 127,
                       "obsrValue": v})
            })
            .collect(),
    )
}

/// What the scripted providers answer.
#[derive(Clone, Default)]
pub(super) struct Scene {
    /// The live station reading's minute (None: the minute page fails).
    pub minute: Option<Publication>,
    /// An earlier current observation answered only once a short publication has answered.
    pub held: Option<(Publication, Publication)>,
    /// ASOS hours whose precipitation type the ASOS rules leave unknown.
    pub untyped: Vec<Publication>,
    /// Current observations reporting rain.
    pub raining: Vec<Publication>,
    /// A current observation answered only once [`Session::release`] is called.
    pub late: Option<Publication>,
}
/// One answer: the body and the short and current publications requested so far.
pub(super) struct Answer {
    pub body: Value,
    pub short: Vec<Publication>,
    pub current: Vec<Publication>,
}
/// 서울특별시 종로구 청운효자동 (the Seoul cell 60,127) answered from an empty store at `now` by
/// one observed source on an S3 peer.
pub(super) struct Session {
    _peer: Peer,
    now: f64,
    source: S3Source<BoundedS3<HttpS3Transport>>,
    short: Arc<Mutex<Vec<Publication>>>,
    current: Arc<Mutex<Vec<Publication>>>,
    nowcasts: Arc<tokio::sync::watch::Sender<Vec<Publication>>>,
    late: Option<Publication>,
    late_released: Arc<tokio::sync::watch::Sender<bool>>,
}
/// Answers a session may take until its station and ASOS state is ready.
const SETTLE_ANSWERS: usize = 20;
/// How long a test waits for scripted current observations to answer.
const NOWCAST_WAIT: Duration = Duration::from_secs(60);
impl Session {
    pub fn new(now: f64, scene: &Scene) -> Self {
        let peer = Peer::persistent();
        let store = Arc::new(
            CatalogStore::new(peer.transport_limited(3), CatalogLimits::default()).unwrap(),
        );
        let writer = Writer::new(store, Config::default()).unwrap();
        let (short, current) = (
            Arc::new(Mutex::new(Vec::new())),
            Arc::new(Mutex::new(Vec::new())),
        );
        let late_released = Arc::new(tokio::sync::watch::channel(false).0);
        let nowcasts = Arc::new(tokio::sync::watch::channel(Vec::new()).0);
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
            Arc::new(Stations {
                now,
                minute: scene.minute,
                untyped: scene.untyped.clone(),
            }),
            Arc::new(Unreachable),
            warnings,
        )
        .unwrap()
        .with_forecast(Some(Arc::new(Forecasts {
            now,
            writer: writer.clone(),
            short: short.clone(),
            current: current.clone(),
            nowcasts: nowcasts.clone(),
            held: scene.held,
            released: Arc::new(tokio::sync::watch::channel(false).0),
            raining: scene.raining.clone(),
            late: scene.late,
            late_released: late_released.clone(),
        })))
        .with_raw_writer(writer);
        Self {
            _peer: peer,
            now,
            source,
            short,
            current,
            nowcasts,
            late: scene.late,
            late_released,
        }
    }
    /// Lets the late current observation answer, and waits until it has.
    pub async fn release(&self) {
        self.late_released.send_replace(true);
        self.nowcasts_answered(&self.late.into_iter().collect::<Vec<_>>())
            .await;
    }
    /// Waits until the scripted provider has answered the current observations `wanted`.
    pub async fn nowcasts_answered(&self, wanted: &[Publication]) {
        let mut answered = self.nowcasts.subscribe();
        tokio::time::timeout(
            NOWCAST_WAIT,
            answered.wait_for(|answered| wanted.iter().all(|p| answered.contains(p))),
        )
        .await
        .expect("the current observations answered")
        .unwrap();
    }
    /// Answers until `ready` holds for an answer, which it returns: a cold station and ASOS
    /// load can outlast one answer's 2.5 s wait (it then serves a later answer), so a test that
    /// waits for work these start does not depend on how long the first answer takes.
    pub async fn settle(&self, ready: impl Fn(&Answer) -> bool) -> Answer {
        for _ in 0..SETTLE_ANSWERS {
            let answer = self.answer().await;
            if ready(&answer) {
                return answer;
            }
        }
        panic!("not ready after {SETTLE_ANSWERS} answers")
    }
    pub async fn answer(&self) -> Answer {
        let encoded =
            |name: &str| -> String { name.bytes().map(|b| format!("%{b:02X}")).collect() };
        let path = format!(
            "/v000903/kma/addr/{}/{}/{}",
            encoded("서울특별시"),
            encoded("종로구"),
            encoded("청운효자동")
        );
        // The observed request's budget (8 s): its waits end 2.5 s after it starts.
        let deadline = Instant::now() + Duration::from_secs(8);
        let request = self
            .source
            .prepare(parse_path(&path, "").unwrap(), deadline)
            .await
            .unwrap_or_else(|_| panic!("prepared"));
        let SourceAnswer::Snapshot(snapshot) = self.source.snapshot(&request, deadline).await
        else {
            panic!("a snapshot")
        };
        let out = assemble(
            &request,
            snapshot.as_ref(),
            self.now,
            AssemblyConfig::default(),
        );
        let Outcome::Json(body) = out else {
            panic!("assembly failed: {out:?}")
        };
        let sorted = |log: &Mutex<Vec<Publication>>| {
            let mut log = log.lock().unwrap().clone();
            log.sort();
            log
        };
        Answer {
            body: serde_json::from_slice(&body.to_bytes()).unwrap(),
            short: sorted(&self.short),
            current: sorted(&self.current),
        }
    }
}
/// The body at `now` with the live station reading of `minute` and the forecasts' `held`
/// observation, and the short publications requested.
async fn answered(
    now: f64,
    minute: Option<Publication>,
    held: Option<(Publication, Publication)>,
) -> (Value, Vec<Publication>) {
    let scene = Scene {
        minute,
        held,
        ..Scene::default()
    };
    let answer = Session::new(now, &scene).answer().await;
    (answer.body, answer.short)
}
pub(super) fn row(body: &Value, date: &str, time: u32) -> Value {
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
    let (body, requested) =
        answered(kst(20260924, 910), Some(publication(20260924, 851)), None).await;
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
    let (body, requested) =
        answered(kst(20260924, 910), Some(publication(20260924, 908)), None).await;
    assert_eq!(marked(&body), vec![("20260924".to_owned(), 9)]);
    assert_eq!(row(&body, "20260924", 9)["pop"], 8);
    assert_eq!(requested, vec![publication(20260924, 800)]);
}

/// The shown rows are decided from the station reading (or the newest current observation), not
/// after today's whole current history (review RP-lagging-current-publication). At 09:10 the
/// 03:00 observation answers only once the 05:00 short publication has answered, so waiting for
/// the whole history would start that publication after the wait: the 06:00 row shown as current
/// still gets its forecast, with one acquisition per short publication.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slow_earlier_observation_does_not_hold_back_the_shown_publication() {
    let _peers = S3_PEERS.lock().await;
    let held = (publication(20260924, 300), publication(20260924, 500));
    let (body, requested) = answered(
        kst(20260924, 910),
        Some(publication(20260924, 851)),
        Some(held),
    )
    .await;
    assert_eq!(marked(&body), vec![("20260924".to_owned(), 6)]);
    let shown = row(&body, "20260924", 6);
    assert_eq!(shown["pop"], 5, "the 05:00 publication's row: {shown}");
    assert_eq!(shown["wav"], 0.5, "{shown}");
    assert_eq!(
        requested,
        vec![publication(20260924, 500), publication(20260924, 800)],
        "one acquisition each"
    );
}

/// Without a station reading the newest current observation decides the shown rows, as soon as the
/// current answer has its latest publication: the 08:00 observation marks the 06:00 row, and the
/// slow 03:00 one still does not hold back the 05:00 publication.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn without_a_station_reading_the_newest_observation_decides_the_shown_row() {
    let _peers = S3_PEERS.lock().await;
    let held = (publication(20260924, 300), publication(20260924, 500));
    let (body, requested) = answered(kst(20260924, 910), None, Some(held)).await;
    assert_eq!(
        body["current"]["dateObj"], "2026.09.24 08:00",
        "the newest observation: {}",
        body["current"]
    );
    assert_eq!(marked(&body), vec![("20260924".to_owned(), 6)]);
    let shown = row(&body, "20260924", 6);
    assert_eq!(shown["pop"], 5, "the 05:00 publication's row: {shown}");
    assert_eq!(
        requested,
        vec![publication(20260924, 500), publication(20260924, 800)],
        "one acquisition each"
    );
}
