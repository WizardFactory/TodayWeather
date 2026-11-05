//! S15b-3c: the AirKorea image hourly forecast.
//!
//! The `airkorea-forecast-image` acquisitions of the last [`DAYS`] KST days (one group per
//! announcement: the PM10 and PM2.5 GIFs and the manifest of their URLs) are replayed in
//! completion order as legacy master `do` runs: a stored `pubDate` is skipped, otherwise every
//! station of the current station list is decoded from both images (nothing is stored when either
//! fails the layout), then rows older than one day are removed.
//!
//! A refresh reads the day catalogs (small control objects) and downloads only the acquisitions
//! it does not know, one at a time, decoding each before the next is read; each is decoded once
//! per station list, and a new station list decodes everything again.
//!
//! The observed source makes the fold on a schedule (AK 2026-11-06, [`ImageForecasts::produce`],
//! the process timer every ten minutes): it acquires the expected announcement's images when
//! missing, and stores the fold as one `airkorea-forecast-hourly` product unless the last
//! product was made of the same acquisitions, station list and calibration. Its requests only
//! read the newest product ([`ImageForecasts::produced`]): no request acquires or decodes an
//! image.
//!
//! The legacy source folds per request ([`ImageForecasts::load`]): a fold is refreshed at most
//! every minute, at once when the station list changed or an image acquisition of this process
//! ended. S3 reads and decoding run as owned single-flight tasks that update the process fold; a
//! request waits for them only until its own deadline. A request that reads the forecast
//! (`airForecastSource` `airkorea`, or `kaq` mapped to it when no KAQ forecast exists, AK
//! 2026-10-15) and finds the announcement expected now missing (or, while that one has no dust
//! forecast documents naming an image yet, the previous announcement) starts one owned
//! acquisition of its images (S13d `OwnedFlights`, 10-minute retry) from the dust forecast
//! documents' `imageUrl[6]`/`[7]` and waits for it only until its deadline.
use super::air_forecast::{
    CODES, Calibration, HourlyForecasts, Processed, StationValues, decode_gif, frame_start,
};
use super::airkorea::{Forecasts, Stations, announcement_text, expected_announcement};
use super::doc::Val;
use super::live::{AirKoreaAcquire, Flights};
use super::records::{Reader, months};
use crate::budget::{Clock, SystemClock};
use crate::domestic::airkorea_image::{self as image, AirKoreaImageRequest};
use crate::domestic::publication::Publication;
use crate::gateway::BoxFuture;
use crate::history::IndexListing;
use crate::resolver::{OwnedConfig, OwnedFlights};
use crate::storage::{
    Catalog, CatalogId, CatalogLimits, CatalogStore, Envelope, GroupDeclaration, GroupMember,
    PageOutcome, Pagination, RawRecord,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::time::Duration;
use tokio::time::Instant;

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;
/// Image acquisitions read: an announcement of day D names an image whose first frame is at the
/// latest D+1 00:00 KST (enforced, `airkorea_image::start_allowed`) and whose last frame at most
/// `MAX_FRAMES - 1` hours later;
/// a row lives one more day. So every announcement of the last `ceil(MAX_FRAMES / 24) + 3` KST days
/// (eight) can still hold rows, and older ones cannot (review S15b3c-R7).
const DAYS: i64 = (super::gif::MAX_FRAMES as i64 + 23) / 24 + 3;
/// A fold is refreshed at most this often (the AirKorea folds' bound) unless the station list
/// changed or an image acquisition of this process ended.
const REFRESH: Duration = Duration::from_secs(60);
/// Owned S3 reads with decoding.
const READ_FOR: Duration = Duration::from_secs(300);
/// Kind of the produced hourly forecast (under the image source and key): the fold of every
/// image acquisition as one object, which the observed source's requests read.
pub const PRODUCT_KIND: &str = "airkorea-forecast-hourly";

/// The per-station values of one acquisition, per code with its first frame instant.
type Decoded = Vec<(&'static str, f64, StationValues)>;
/// One known acquisition: its `pubDate` and values (None: an image did not pass the layout, so
/// legacy `getDustImage` failed and nothing was stored).
#[derive(Clone)]
struct Known {
    pub_date: String,
    values: Option<Arc<Decoded>>,
}
/// An acquisition by completion instant, partition and fetch group (completion order; the group
/// separates acquisitions completed in the same millisecond, review S15b3c-R9).
type AcquisitionKey = (u64, String, String);
/// Known acquisitions in completion order.
type KnownSet = BTreeMap<AcquisitionKey, Known>;
#[derive(Default)]
struct State {
    folded: Arc<HourlyForecasts>,
    known: KnownSet,
    /// The station list `known` was decoded for.
    stations: String,
    refreshed: Option<std::time::Instant>,
    generation: u64,
    /// The fold's cut: acquisitions completed later are not in it.
    cut: f64,
}
struct Shared<T> {
    reader: Reader<T>,
    calibration: Calibration,
    refresh_every: Duration,
    reads: OwnedFlights<String, bool>,
    state: std::sync::Mutex<State>,
    refresh: tokio::sync::Mutex<()>,
    cpu: Arc<tokio::sync::Semaphore>,
    /// Wall-clock ms when an image acquisition of this process last published or failed (a
    /// failed S3 write may still have committed): the next request reads the catalogs again.
    published_at: AtomicI64,
    /// The wall clock (S15b-3d).
    clock: Arc<dyn Clock>,
    /// The product the requests read, as this process read or made it last.
    product: std::sync::Mutex<Option<ProductRead>>,
    /// One request cuts the old rows of the product at a time.
    cutting: tokio::sync::Mutex<()>,
    /// Product reads and cuts, apart from the decoding admission.
    answer_cpu: Arc<tokio::sync::Semaphore>,
    /// The last product of this process's productions (None: not read yet); one production at
    /// a time.
    made: tokio::sync::Mutex<Option<Made>>,
}
/// What a product was made of: the station list, the calibration and the image acquisitions in
/// completion order.
#[derive(Debug, Clone, PartialEq)]
struct MadeOf {
    stations: String,
    calibration: String,
    acquisitions: Vec<AcquisitionKey>,
}
impl MadeOf {
    fn json(&self) -> serde_json::Value {
        let acquisitions: Vec<serde_json::Value> = self
            .acquisitions
            .iter()
            .map(|(at, day, group)| serde_json::json!([at, day, group]))
            .collect();
        serde_json::json!({
            "stations": self.stations,
            "calibration": self.calibration,
            "acquisitions": acquisitions,
        })
    }
    fn from_json(v: &serde_json::Value) -> Option<Self> {
        let text = |k: &str| v.get(k)?.as_str().map(str::to_owned);
        let acquisitions = v
            .get("acquisitions")?
            .as_array()?
            .iter()
            .map(|a| {
                let [at, day, group] = a.as_array()?.as_slice() else {
                    return None;
                };
                Some((
                    at.as_u64()?,
                    day.as_str()?.to_owned(),
                    group.as_str()?.to_owned(),
                ))
            })
            .collect::<Option<_>>()?;
        Some(Self {
            stations: text("stations")?,
            calibration: text("calibration")?,
            acquisitions,
        })
    }
}
/// A stored product.
struct Product {
    fold: HourlyForecasts,
    made: f64,
    made_of: Option<MadeOf>,
}
fn parse_product(bytes: &[u8]) -> Option<Product> {
    let body: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let (fold, made) = HourlyForecasts::from_product(&body)?;
    Some(Product {
        fold,
        made,
        made_of: body.get("madeOf").and_then(MadeOf::from_json),
    })
}
/// The last product of the productions: what it was made of (None: none was stored) and its
/// fold.
struct Made {
    of: Option<MadeOf>,
    fold: Arc<HourlyForecasts>,
}
/// The product as the requests read it.
struct ProductRead {
    /// As stored, and when it was made (0: none was found).
    stored: Arc<HourlyForecasts>,
    made: f64,
    /// `stored` without the rows old at `cut`, unchanged up to `whole_until`.
    current: Arc<HourlyForecasts>,
    cut: f64,
    whole_until: f64,
    read: std::time::Instant,
}
/// The image forecast inputs shared by every request of the process.
pub struct ImageForecasts<T> {
    shared: Arc<Shared<T>>,
}
/// The wall clock in ms.///
/// S15b-3d: read from the inputs' clock (the system clock unless `with_clock` injects another;
/// tests fix it).
fn wall_ms(clock: &dyn Clock) -> f64 {
    clock.now_ms().map_or(0., |n| n as f64)
}
fn kst_date(ms: f64) -> u32 {
    crate::world::js::parts(ms + 9. * HOUR_MS)
        .map_or(0, |p| (p.year * 10000 + p.month * 100 + p.day) as u32)
}
/// `convertYYYY_MM_DD_HHStr2YYYY_MM_DD_HHoZZ`: `'YYYY-MM-DD HH시 발표'` → `'YYYY-MM-DD HH:00'`.
pub fn pub_date(announcement_text: &str) -> String {
    // `str.substr(0, 13)`: the announcement text is ASCII up to the hour.
    let head: String = announcement_text.chars().take(13).collect();
    format!("{head}:00")
}
/// The announcement of a dust-forecast `dataTime` (`YYYY-MM-DD HH시 발표`).
fn announcement(text: &str) -> Option<Publication> {
    let date: u32 = text.get(..10)?.replace('-', "").parse().ok()?;
    let hour: u16 = text.get(11..13)?.parse().ok()?;
    Publication::new(date, hour * 100)
}
/// The image URLs legacy `_getImgPaths` takes: the first PM10 document's `imageUrl[6]` and the
/// first PM2.5 document's `imageUrl[7]` of the announcement (None: no such document or URL, and
/// `getDustImage` skips that pollutant).
pub fn image_paths(forecasts: &Forecasts, data_time: &str) -> (Option<String>, Option<String>) {
    let (mut pm10, mut pm25) = (None, None);
    let (mut found10, mut found25) = (false, false);
    for f in forecasts
        .docs()
        .iter()
        .filter(|f| f.data_time.as_deref() == Some(data_time))
    {
        if !found10 && f.inform_code.as_deref() == Some("PM10") {
            found10 = true;
            pm10 = f.image_urls.get(6).cloned().flatten();
        } else if !found25 && f.inform_code.as_deref() == Some("PM25") {
            found25 = true;
            pm25 = f.image_urls.get(7).cloned().flatten();
        }
    }
    (pm10, pm25)
}
/// The station list legacy `_getMsrStn` gives `_updateHourlyForecast`: name and `geo` (`[lon, lat]`).
fn station_points(stations: &Stations) -> Vec<(String, f64, f64)> {
    stations
        .docs()
        .iter()
        .filter_map(|d| {
            let name = d.get("stationName").and_then(Val::as_str)?.to_owned();
            let Some(Val::Arr(g)) = d.get("geo") else {
                return None;
            };
            let num = |v: Option<&Val>| v.and_then(Val::as_num).unwrap_or(f64::NAN);
            Some((name, num(g.get(1)), num(g.first())))
        })
        .collect()
}
/// A digest of the station list (a product records it).
fn stations_key(points: &[(String, f64, f64)]) -> String {
    let mut bytes = Vec::new();
    for (n, lat, lon) in points {
        bytes.extend_from_slice(n.as_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&lat.to_bits().to_le_bytes());
        bytes.extend_from_slice(&lon.to_bits().to_le_bytes());
    }
    crate::storage::sha256(&bytes)
}
/// The `pubDate` of a stored acquisition (its announcement period).
fn stored_pub_date(records: &[RawRecord]) -> String {
    let period = &records[0].envelope.identity.period;
    let date = format!("{:08}", period.local_date);
    format!(
        "{}-{}-{} {}:00",
        &date[..4],
        &date[4..6],
        &date[6..],
        period.slot.get(..2).unwrap_or("00")
    )
}
fn image_catalog(day: &str) -> Result<CatalogId, String> {
    let key = AirKoreaImageRequest::provider_key()
        .canonical_bytes()
        .map_err(|e| e.to_string())?;
    Ok(CatalogId {
        source: image::SOURCE.into(),
        kind: image::KIND.into(),
        key_sha256: crate::storage::sha256(&key),
        partition: day.into(),
    })
}
/// The acquisitions one day catalog lists: (completion instant, fetch group, a member envelope),
/// from the catalog control object alone (no record body is read).
async fn listed_acquisitions<T: IndexListing>(
    transport: &T,
    id: &CatalogId,
    deadline: Instant,
) -> Result<Vec<(u64, String, Envelope)>, String> {
    let limits = CatalogLimits::default();
    let object = match tokio::time::timeout_at(
        deadline,
        transport.get_control(&id.key(), limits.control_bytes),
    )
    .await
    {
        Err(_) => return Err("image catalog deadline".into()),
        Ok(Err(crate::storage::Error::NotFound)) => return Ok(Vec::new()),
        Ok(Err(e)) => return Err(format!("image catalog: {e}")),
        Ok(Ok(object)) => object,
    };
    let catalog = Catalog::from_bytes(&object.body, id, &limits)
        .map_err(|e| format!("image catalog: {e}"))?;
    // One acquisition per fetch group; its completion is its members' latest fetch instant.
    let mut groups: BTreeMap<String, (u64, Envelope)> = BTreeMap::new();
    for e in catalog.entries {
        let group = match &e.fetch_group {
            Some(g) => g.descriptor_key().map_err(|e| e.to_string())?,
            None => e.identity.raw_sha256.clone(),
        };
        let fetched = e.identity.fetched_at_ms;
        groups
            .entry(group)
            .and_modify(|(f, _)| *f = (*f).max(fetched))
            .or_insert((fetched, e));
    }
    Ok(groups
        .into_iter()
        .map(|(group, (fetched, e))| (fetched, group, e))
        .collect())
}

impl<T: IndexListing + Clone + 'static> ImageForecasts<T> {
    pub fn new(transport: T, store: Arc<CatalogStore<T>>, calibration: Calibration) -> Self {
        Self {
            shared: Arc::new(Shared {
                reader: Reader { transport, store },
                calibration,
                refresh_every: REFRESH,
                reads: OwnedFlights::new(OwnedConfig {
                    running: 2,
                    entries: 16,
                    retain: Duration::ZERO,
                })
                .expect("valid read bounds"),
                state: Default::default(),
                refresh: Default::default(),
                cpu: Arc::new(tokio::sync::Semaphore::new(1)),
                published_at: AtomicI64::new(0),
                clock: Arc::new(SystemClock),
                product: Default::default(),
                cutting: Default::default(),
                answer_cpu: Arc::new(tokio::sync::Semaphore::new(1)),
                made: Default::default(),
            }),
        }
    }
    /// S15b-3d: the wall clock (the system clock by default; tests fix it).
    pub fn with_clock(self, clock: Arc<dyn Clock>) -> Self {
        let mut shared = Arc::into_inner(self.shared).expect("not shared yet");
        shared.clock = clock;
        Self {
            shared: Arc::new(shared),
        }
    }
    /// A shorter refresh interval (tests; as `AirInputs::with_capture_interval`).
    pub fn with_refresh_interval(self, every: Duration) -> Self {
        let mut shared = Arc::into_inner(self.shared).expect("not shared yet");
        shared.refresh_every = every;
        Self {
            shared: Arc::new(shared),
        }
    }
    pub fn calibration(&self) -> &Calibration {
        &self.shared.calibration
    }
    /// The forecast fold for a request at `now` (the legacy source); `generation` is the AirKorea
    /// publication count (a publication invalidates the memo). Starts the missing announcement's
    /// image acquisition and waits for it until `until`.
    #[allow(clippy::too_many_arguments)] // The request, its inputs and the shared acquirer.
    pub async fn load(
        &self,
        now: f64,
        stations: Arc<Stations>,
        forecasts: Option<&Forecasts>,
        acquire: Option<Arc<dyn AirKoreaAcquire>>,
        flights: &Flights,
        generation: &Arc<AtomicU64>,
        until: Instant,
    ) -> Arc<HourlyForecasts> {
        self.read(now, stations.clone(), generation, until).await;
        if let (Some((text, at, request)), Some(acquire)) = (self.target(now, forecasts), acquire)
            && !self.fold().has(&pub_date(&text))
            && self
                .acquire_images(at, request, acquire, flights, generation, until)
                .await
        {
            // The acquisition completed after the request instant: read up to now.
            self.read(
                wall_ms(&*self.shared.clock).max(now),
                stations,
                generation,
                until,
            )
            .await;
        }
        self.fold()
    }
    /// The announcement whose images a fold at `now` holds: the expected one, or while its
    /// documents name no characterized pair yet the previous one. Legacy ran `do` for every
    /// announcement when it was expected (each `getMinuDustFrcstDspth` run, `kecoRequester`
    /// L694), so its rows exist there. A pair `getDustImage` rejects (a path missing or not the
    /// characterized cycle) is never fetched.
    fn target(
        &self,
        now: f64,
        forecasts: Option<&Forecasts>,
    ) -> Option<(String, Publication, AirKoreaImageRequest)> {
        let f = forecasts?;
        let expected = expected_announcement(now)?;
        let previous = announcement(&expected)?
            .add_hours(-6)
            .and_then(announcement_text);
        [Some(expected), previous]
            .into_iter()
            .flatten()
            .find_map(|text| {
                let (Some(pm10), Some(pm25)) = image_paths(f, &text) else {
                    return None;
                };
                let at = announcement(&text)?;
                let request =
                    AirKoreaImageRequest::new(at, &pm10, &pm25, self.shared.calibration.clone())
                        .ok()?;
                Some((text, at, request))
            })
    }
    /// Start (or join) the owned acquisition of one announcement's images and wait for it until
    /// `ready_by`: true when it published by then.
    async fn acquire_images(
        &self,
        at: Publication,
        request: AirKoreaImageRequest,
        acquire: Arc<dyn AirKoreaAcquire>,
        flights: &Flights,
        generation: &Arc<AtomicU64>,
        ready_by: Instant,
    ) -> bool {
        let counter = generation.clone();
        let shared = self.shared.clone();
        flights
            .join_for(
                &format!("images-{}", at.compact()),
                ready_by,
                super::live::IMAGE_CALL_BUDGET + Duration::from_secs(10),
                move || -> BoxFuture<'static, bool> {
                    Box::pin(async move {
                        let outcome = acquire.acquire_images(request).await;
                        // A failure may still have published (an ambiguous S3 write): the next
                        // read lists the catalogs again either way.
                        if !matches!(outcome, Ok(None)) {
                            shared
                                .published_at
                                .fetch_max(wall_ms(&*shared.clock) as i64, Ordering::AcqRel);
                        }
                        let ok = matches!(outcome, Ok(Some(_)));
                        if ok {
                            counter.fetch_add(1, Ordering::AcqRel);
                        }
                        ok
                    })
                },
            )
            .await
    }
    /// One scheduled production at `now` (the process timer, never a request) within
    /// `deadline`. The fold of the stored image acquisitions is the last product when that was
    /// made of the same acquisitions, station list and calibration, and otherwise a read that
    /// decodes only what this process has not decoded. The expected announcement's images are
    /// acquired, and waited for, unless that fold holds them. The fold is then stored as the
    /// product the requests read unless the last product was made of the same. Ok(true): a
    /// product was stored.
    #[allow(clippy::too_many_arguments)] // The production instant, its inputs and the acquirer.
    pub async fn produce(
        &self,
        now: f64,
        stations: Arc<Stations>,
        forecasts: Option<&Forecasts>,
        acquire: Option<Arc<dyn AirKoreaAcquire>>,
        flights: &Flights,
        generation: &Arc<AtomicU64>,
        deadline: Instant,
    ) -> Result<bool, String> {
        let mut last = tokio::time::timeout_at(deadline, self.shared.made.lock())
            .await
            .map_err(|_| "production deadline".to_owned())?;
        if last.is_none() {
            // The first production of this process starts from the stored product.
            let product = read_product(&self.shared, now, deadline).await?;
            *last = Some(product.map_or_else(
                || Made {
                    of: None,
                    fold: Arc::default(),
                },
                |p| Made {
                    of: p.made_of,
                    fold: Arc::new(p.fold),
                },
            ));
        }
        let made = last.as_ref();
        let now = wall_ms(&*self.shared.clock).max(now);
        let (mut fold, mut of, mut changed) = self
            .stored_fold(now, &stations, generation, made, deadline)
            .await?;
        if let (Some((text, at, request)), Some(acquire)) = (self.target(now, forecasts), acquire)
            && !fold.has(&pub_date(&text))
            && self
                .acquire_images(at, request, acquire, flights, generation, deadline)
                .await
        {
            let now = wall_ms(&*self.shared.clock).max(now);
            (fold, of, changed) = self
                .stored_fold(now, &stations, generation, made, deadline)
                .await?;
        }
        if !changed {
            return Ok(false);
        }
        let cut = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .cut;
        store_product(&self.shared, fold.clone(), cut, &of, deadline).await?;
        install(&self.shared, fold.clone(), cut, fold.clone(), cut);
        *last = Some(Made { of: Some(of), fold });
        Ok(true)
    }
    /// The fold of the image acquisitions stored by `now`, what it is made of, and whether that
    /// differs from `made`: `made`'s fold when it was made of the same, else this process's fold
    /// read up to `now`. The acquisitions of days before the [`window`] leave `made` unchanged:
    /// none of their rows is left by then.
    async fn stored_fold(
        &self,
        now: f64,
        stations: &Arc<Stations>,
        generation: &Arc<AtomicU64>,
        made: Option<&Made>,
        deadline: Instant,
    ) -> Result<(Arc<HourlyForecasts>, MadeOf, bool), String> {
        let made_of = |acquisitions| MadeOf {
            stations: stations_key(&station_points(stations)),
            calibration: self.shared.calibration.digest(),
            acquisitions,
        };
        let cut = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .cut
            .max(now);
        let listed = made_of(
            listed(&self.shared, cut, deadline)
                .await?
                .into_iter()
                .map(|(key, _, _)| key)
                .collect(),
        );
        let days = window(cut);
        let last = made.and_then(|m| m.of.as_ref()).map(|of| MadeOf {
            acquisitions: of
                .acquisitions
                .iter()
                .filter(|(_, day, _)| days.contains(day))
                .cloned()
                .collect(),
            ..of.clone()
        });
        if let Some(made) = made.filter(|_| last.as_ref() == Some(&listed)) {
            return Ok((made.fold.clone(), listed, false));
        }
        read(
            &self.shared,
            now,
            stations.clone(),
            generation.load(Ordering::Acquire),
            deadline,
        )
        .await?;
        let state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
        let of = made_of(state.known.keys().cloned().collect());
        let changed = last.as_ref() != Some(&of);
        Ok((state.folded.clone(), of, changed))
    }
    /// The produced hourly forecast a request at `now` answers with: the newest stored product,
    /// read again at most every refresh interval (the owned read continues past `until`),
    /// without the rows old at `now`. Until a product is read the fold is empty (the legacy
    /// answer for missing data).
    pub async fn produced(&self, now: f64, until: Instant) -> Arc<HourlyForecasts> {
        let fresh = self
            .shared
            .product
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_some_and(|p| p.read.elapsed() < self.shared.refresh_every);
        if !fresh {
            let shared = self.shared.clone();
            let _ =
                self.shared
                    .reads
                    .join(
                        "product".to_owned(),
                        until,
                        READ_FOR,
                        move |deadline| async move {
                            refresh_product(&shared, now, deadline).await.is_ok()
                        },
                    )
                    .await;
        }
        self.current(now, until).await
    }
    /// The product read last without the rows old at `now`: a row that became old since makes
    /// one request cut a copy (others wait for it until their deadline, or answer with the
    /// last cut).
    async fn current(&self, now: f64, until: Instant) -> Arc<HourlyForecasts> {
        let held = || {
            self.shared
                .product
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .map(|p| (p.stored.clone(), p.current.clone(), p.cut, p.whole_until))
        };
        let Some((_, current, _, whole_until)) = held() else {
            return Arc::default();
        };
        if now <= whole_until {
            return current;
        }
        let Ok(_cutting) = tokio::time::timeout_at(until, self.shared.cutting.lock()).await else {
            return current;
        };
        let Some((stored, current, cut, whole_until)) = held() else {
            return Arc::default();
        };
        if now <= whole_until {
            return current;
        }
        let cut = cut.max(now);
        let work = {
            let stored = stored.clone();
            move || {
                let fold = stored.without_old(cut).map_or(stored, Arc::new);
                let whole_until = fold.whole_until();
                (fold, whole_until)
            }
        };
        let Ok(Ok((fold, whole_until))) = tokio::time::timeout_at(
            until,
            super::air_input::cpu_task(&self.shared.answer_cpu, work),
        )
        .await
        else {
            return current;
        };
        let mut product = self
            .shared
            .product
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(p) = product.as_mut().filter(|p| Arc::ptr_eq(&p.stored, &stored)) {
            p.current = fold.clone();
            p.cut = cut;
            p.whole_until = whole_until;
        }
        fold
    }
    fn fold(&self) -> Arc<HourlyForecasts> {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .folded
            .clone()
    }
    async fn read(
        &self,
        now: f64,
        stations: Arc<Stations>,
        generation: &Arc<AtomicU64>,
        until: Instant,
    ) {
        let current = generation.load(Ordering::Acquire);
        let published_at = self.shared.published_at.load(Ordering::Acquire) as f64;
        let skey = stations_key(&station_points(&stations));
        {
            let state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.generation == current
                && state.stations == skey
                && state.cut >= published_at
                && state
                    .refreshed
                    .is_some_and(|r| r.elapsed() < self.shared.refresh_every)
            {
                return;
            }
        }
        let shared = self.shared.clone();
        let _ = self
            .shared
            .reads
            .join(
                format!("images-{current}-{skey}-{}", now >= published_at),
                until,
                READ_FOR,
                move |deadline| async move {
                    read(&shared, now, stations, current, deadline)
                        .await
                        .is_ok()
                },
            )
            .await;
    }
}
/// The KST days whose image acquisitions a fold at `cut` reads, oldest first.
fn window(cut: f64) -> Vec<String> {
    (0..DAYS)
        .rev()
        .map(|d| format!("{:08}", kst_date(cut - d as f64 * DAY_MS)))
        .collect()
}
/// The image acquisitions a fold at `cut` reads, from the day catalogs alone: those of the
/// [`window`] completed by then, in completion order, with their catalog and a member envelope.
async fn listed<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    cut: f64,
    deadline: Instant,
) -> Result<Vec<(AcquisitionKey, CatalogId, Envelope)>, String> {
    let listed = shared
        .reader
        .partitions(
            image::SOURCE,
            image::KIND,
            &AirKoreaImageRequest::provider_key(),
            &months(cut - (DAYS - 1) as f64 * DAY_MS, cut),
            deadline,
        )
        .await
        .map_err(|e| format!("image listing: {e}"))?;
    let mut out = Vec::new();
    for day in window(cut).into_iter().filter(|d| listed.contains(d)) {
        let id = image_catalog(&day)?;
        for (fetched, group, member) in
            listed_acquisitions(&shared.reader.transport, &id, deadline).await?
        {
            if fetched as f64 <= cut {
                out.push(((fetched, day.clone(), group), id.clone(), member));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}
/// Bring the fold up to `now`: list the image acquisitions of the [`window`] from their
/// catalogs, download and decode those completed by then that are not known yet (all of them for
/// a new station list), and refold.
async fn read<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
    stations: Arc<Stations>,
    generation: u64,
    deadline: Instant,
) -> Result<(), String> {
    let _refresh = tokio::time::timeout_at(deadline, shared.refresh.lock())
        .await
        .map_err(|_| "image refresh deadline".to_owned())?;
    let points = station_points(&stations);
    let skey = stations_key(&points);
    let (cut, known) = {
        let state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
        // A fold never goes back in time; a new station list decodes everything again.
        let known = if state.stations == skey {
            state.known.clone()
        } else {
            KnownSet::new()
        };
        (state.cut.max(now), known)
    };
    let days = window(cut);
    let listed = listed(shared, cut, deadline).await?;
    let calibration = shared.calibration.clone();
    let cpu = shared.cpu.clone();
    let coords: Arc<Vec<(f64, f64)>> =
        Arc::new(points.iter().map(|(_, lat, lon)| (*lat, *lon)).collect());
    let mut known = known;
    known.retain(|(_, p, _), _| days.contains(p));
    for (key, id, member) in listed {
        if known.contains_key(&key) {
            continue;
        }
        // One acquisition per lookup (two images of about 5-6 MB), decoded before the next is
        // read: the raw bodies are released at once (review S15b3c-R8).
        let page = shared
            .reader
            .store
            .lookup_acquisition(&id, &member.identity, deadline)
            .await
            .map_err(|e| format!("image read: {e}"))?;
        // Not complete yet: asked again at the next refresh.
        let PageOutcome::Ready(page) = page else {
            continue;
        };
        let Some(acquisition) = page.acquisitions().first() else {
            continue;
        };
        let mut records = acquisition.records().to_vec();
        drop(page);
        records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
        // The two images and their manifest.
        if records.len() != CODES.len() + 1 {
            continue;
        }
        let pub_date = stored_pub_date(&records);
        let date = records[0].envelope.identity.period.local_date;
        let (calibration, coords) = (calibration.clone(), coords.clone());
        let decode = move || {
            // `getDustImage`: both paths dated by `frameStart`, both images through the
            // layout.
            let urls = image::manifest_urls(&records[CODES.len()].bytes);
            let mut values: Decoded = Vec::new();
            let mut failed = urls.is_none();
            for (((code, kind, _), record), url) in
                CODES.iter().zip(&records).zip(urls.iter().flatten())
            {
                // An image starting after the announcement's next day is not folded (the read
                // window would not keep it; see `airkorea_image::start_allowed`).
                match frame_start(url, kind)
                    .and_then(|start| {
                        image::start_allowed(start, date)
                            .then_some(start)
                            .ok_or_else(|| "image after its announcement".to_owned())
                    })
                    .and_then(|start| {
                        Ok((
                            start,
                            decode_gif(&record.bytes, &calibration, kind, &coords)?,
                        ))
                    }) {
                    Ok((start, v)) => values.push((code, start, v)),
                    Err(_) => failed = true,
                }
            }
            (!failed).then(|| Arc::new(values))
        };
        let values = tokio::time::timeout_at(deadline, super::air_input::cpu_task(&cpu, decode))
            .await
            .map_err(|_| "image decode deadline".to_owned())??;
        known.insert(key, Known { pub_date, values });
    }
    let work = move || {
        let mut fold = HourlyForecasts::default();
        for ((fetched, _, _), k) in &known {
            match &k.values {
                // `_checkHourlyForecast` skips a stored announcement, and a failed
                // `getDustImage` stores nothing: only old rows go.
                Some(values) if !fold.has(&k.pub_date) => fold.apply(&Processed {
                    pub_date: k.pub_date.clone(),
                    now: *fetched as f64,
                    stations: &points,
                    values: (**values).clone(),
                }),
                _ => fold.remove_old(*fetched as f64),
            }
        }
        // The hourly `do` runs removed rows up to the last hour (here: the cut).
        fold.remove_old(cut);
        (fold, known)
    };
    let (fold, known) = tokio::time::timeout_at(deadline, super::air_input::cpu_task(&cpu, work))
        .await
        .map_err(|_| "image fold deadline".to_owned())??;
    let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
    state.folded = Arc::new(fold);
    state.known = known;
    state.stations = skey;
    state.generation = generation;
    state.cut = cut;
    state.refreshed = Some(std::time::Instant::now());
    Ok(())
}
/// The newest stored product within the days whose rows can still be current (None: none).
async fn read_product<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
    deadline: Instant,
) -> Result<Option<Product>, String> {
    let key = AirKoreaImageRequest::provider_key();
    let first = now - (DAYS - 1) as f64 * DAY_MS;
    let oldest = format!("{:08}", kst_date(first));
    let days = shared
        .reader
        .partitions(
            image::SOURCE,
            PRODUCT_KIND,
            &key,
            &months(first, now),
            deadline,
        )
        .await
        .map_err(|e| format!("product listing: {e}"))?;
    for day in days.iter().rev().filter(|d| **d >= oldest) {
        let found = shared
            .reader
            .latest_raw(
                image::SOURCE,
                PRODUCT_KIND,
                &key,
                day,
                1,
                |_| true,
                deadline,
            )
            .await
            .map_err(|e| format!("product read: {e}"))?;
        let Some(record) = found.first().and_then(|a| a.first()) else {
            continue;
        };
        let bytes = record.bytes.clone();
        let product = tokio::time::timeout_at(
            deadline,
            super::air_input::cpu_task(&shared.answer_cpu, move || parse_product(&bytes)),
        )
        .await
        .map_err(|_| "product parse deadline".to_owned())??;
        if product.is_some() {
            return Ok(product);
        }
    }
    Ok(None)
}
/// Read the newest stored product for the requests (an empty fold when none is stored).
async fn refresh_product<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    now: f64,
    deadline: Instant,
) -> Result<(), String> {
    let product = read_product(shared, now, deadline).await?;
    let (fold, made) =
        product.map_or_else(|| (HourlyForecasts::default(), 0.), |p| (p.fold, p.made));
    let cut = move || {
        let stored = Arc::new(fold);
        let current = stored
            .without_old(now)
            .map_or_else(|| stored.clone(), Arc::new);
        (stored, current)
    };
    let (stored, current) = tokio::time::timeout_at(
        deadline,
        super::air_input::cpu_task(&shared.answer_cpu, cut),
    )
    .await
    .map_err(|_| "product cut deadline".to_owned())??;
    install(shared, stored, made, current, now);
    Ok(())
}
/// Keep a product, made at `made` and cut at `cut`, as what the requests read, unless a newer
/// one is held (whose read is then current again).
fn install<T>(
    shared: &Shared<T>,
    stored: Arc<HourlyForecasts>,
    made: f64,
    current: Arc<HourlyForecasts>,
    cut: f64,
) {
    let whole_until = current.whole_until();
    let mut product = shared.product.lock().unwrap_or_else(|e| e.into_inner());
    match product.as_mut() {
        Some(held) if held.made > made => held.read = std::time::Instant::now(),
        _ => {
            *product = Some(ProductRead {
                stored,
                made,
                current,
                cut,
                whole_until,
                read: std::time::Instant::now(),
            });
        }
    }
}
/// Store `fold`, made at `made` of `made_of`, as the product of the KST day of `made`.
async fn store_product<T: IndexListing + Clone + 'static>(
    shared: &Arc<Shared<T>>,
    fold: Arc<HourlyForecasts>,
    made: f64,
    made_of: &MadeOf,
    deadline: Instant,
) -> Result<(), String> {
    let made_of = made_of.json();
    let bytes = tokio::time::timeout_at(
        deadline,
        super::air_input::cpu_task(&shared.cpu, move || {
            let mut body = fold.product(made);
            body["madeOf"] = made_of;
            serde_json::to_vec(&body)
        }),
    )
    .await
    .map_err(|_| "product deadline".to_owned())??
    .map_err(|e| format!("product: {e}"))?;
    let date = kst_date(made);
    let period = Publication::new(date, 0).ok_or("product day")?.period();
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        image::SOURCE,
        PRODUCT_KIND,
        &AirKoreaImageRequest::provider_key(),
        period,
        made as u64,
        200,
        "application/json",
        Some(Pagination {
            page: 1,
            pages: 1,
            complete: true,
        }),
        bytes.into(),
        &limits.raw,
    )
    .map_err(|e| format!("product record: {e}"))?;
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![
            CatalogId::for_record(&record.envelope.identity, &format!("{date:08}"))
                .map_err(|e| format!("product catalog: {e}"))?,
        ],
    };
    let declaration =
        GroupDeclaration::new(vec![member], &limits).map_err(|e| format!("product group: {e}"))?;
    shared
        .reader
        .store
        .publish(declaration, vec![record], deadline)
        .await
        .map_err(|e| format!("product publication: {e}"))?;
    Ok(())
}
