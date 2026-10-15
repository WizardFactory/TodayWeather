//! S15b-3c: the AirKorea image hourly forecast of one request.
//!
//! The `airkorea-forecast-image` acquisitions of the last four KST days (one group per
//! announcement: the PM10 and PM2.5 GIFs and the manifest of their URLs) are replayed in
//! completion order as legacy master `do` runs: a stored `pubDate` is skipped, otherwise every
//! station of the current station list is decoded from both images (nothing is stored when either
//! fails the layout), then rows older than one day are removed.
//!
//! A refresh reads the four day catalogs (small control objects) and downloads only the
//! acquisitions it does not know, one at a time, decoding each before the next is read; each is
//! decoded once per station list, and a new station list decodes everything again. A fold is refreshed at most every minute, at once when
//! the station list changed or an image acquisition of this process ended. S3 reads and decoding
//! run as owned single-flight tasks that update the process fold; a request waits for them only
//! until its own deadline.
//!
//! A request that reads the forecast (`airForecastSource` `airkorea`, or `kaq` mapped to it when
//! no KAQ forecast exists, AK 2026-10-15) and finds the announcement expected now missing (or,
//! while that one has no dust forecast documents naming an image yet, the previous announcement)
//! starts one owned acquisition of its images (S13d `OwnedFlights`, 10-minute retry) from the
//! dust forecast documents' `imageUrl[6]`/`[7]` and waits for it only until its deadline.
use super::air_forecast::{
    CODES, Calibration, HourlyForecasts, Processed, StationValues, decode_gif, frame_start,
};
use super::airkorea::{Forecasts, Stations, announcement_text, expected_announcement};
use super::doc::Val;
use super::live::{AirKoreaAcquire, Flights};
use super::records::{Reader, months};
use crate::domestic::airkorea_image::{self as image, AirKoreaImageRequest};
use crate::domestic::publication::Publication;
use crate::gateway::BoxFuture;
use crate::history::IndexListing;
use crate::resolver::{OwnedConfig, OwnedFlights};
use crate::storage::{
    Catalog, CatalogId, CatalogLimits, CatalogStore, Envelope, PageOutcome, RawRecord,
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

/// The per-station values of one acquisition, per code with its first frame instant.
type Decoded = Vec<(&'static str, f64, StationValues)>;
/// One known acquisition: its `pubDate` and values (None: an image did not pass the layout, so
/// legacy `getDustImage` failed and nothing was stored).
#[derive(Clone)]
struct Known {
    pub_date: String,
    values: Option<Arc<Decoded>>,
}
/// Known acquisitions by completion instant, partition and fetch group (completion order; the
/// group separates acquisitions completed in the same millisecond, review S15b3c-R9).
type KnownSet = BTreeMap<(u64, String, String), Known>;
#[derive(Default)]
struct State {
    folded: Arc<HourlyForecasts>,
    known: KnownSet,
    /// The station list `known` was decoded for.
    stations: u64,
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
}
/// The image forecast inputs shared by every request of the process.
pub struct ImageForecasts<T> {
    shared: Arc<Shared<T>>,
}
fn wall_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0., |d| d.as_millis() as f64)
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
fn stations_key(points: &[(String, f64, f64)]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for (n, lat, lon) in points {
        n.hash(&mut h);
        lat.to_bits().hash(&mut h);
        lon.to_bits().hash(&mut h);
    }
    h.finish()
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
            }),
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
    /// The forecast fold for a request at `now`; `generation` is the AirKorea publication count
    /// (a publication invalidates the memo). Starts the missing announcement's image acquisition
    /// and waits for it until `until`.
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
        // The expected announcement, or while its documents name no characterized pair yet
        // the previous one: legacy ran `do` for every announcement when it was expected (each
        // `getMinuDustFrcstDspth` run, `kecoRequester` L694), so its rows exist there. A pair
        // `getDustImage` rejects (a path missing or not the characterized cycle) is never
        // fetched.
        let target = forecasts.and_then(|f| {
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
                    let request = AirKoreaImageRequest::new(
                        at,
                        &pm10,
                        &pm25,
                        self.shared.calibration.clone(),
                    )
                    .ok()?;
                    Some((text, at, request))
                })
        });
        if let (Some((text, at, request)), Some(acquire)) = (target, acquire)
            && !self.fold().has(&pub_date(&text))
        {
            let counter = generation.clone();
            let shared = self.shared.clone();
            let published = flights
                .join_for(
                    &format!("images-{}", at.compact()),
                    until,
                    super::live::IMAGE_CALL_BUDGET + Duration::from_secs(10),
                    move || -> BoxFuture<'static, bool> {
                        Box::pin(async move {
                            let outcome = acquire.acquire_images(request).await;
                            // A failure may still have published (an ambiguous S3 write): the
                            // next request reads the catalogs again either way.
                            if !matches!(outcome, Ok(None)) {
                                shared
                                    .published_at
                                    .fetch_max(wall_ms() as i64, Ordering::AcqRel);
                            }
                            let ok = matches!(outcome, Ok(Some(_)));
                            if ok {
                                counter.fetch_add(1, Ordering::AcqRel);
                            }
                            ok
                        })
                    },
                )
                .await;
            if published {
                // The acquisition completed after the request instant: read up to now.
                self.read(wall_ms().max(now), stations, generation, until)
                    .await;
            }
        }
        self.fold()
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
/// Bring the fold up to `now`: list the image acquisitions of the last four KST days from their
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
    let days: Vec<String> = (0..DAYS)
        .rev()
        .map(|d| format!("{:08}", kst_date(cut - d as f64 * DAY_MS)))
        .collect();
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
    let calibration = shared.calibration.clone();
    let cpu = shared.cpu.clone();
    let coords: Arc<Vec<(f64, f64)>> =
        Arc::new(points.iter().map(|(_, lat, lon)| (*lat, *lon)).collect());
    let mut known = known;
    known.retain(|(_, p, _), _| days.contains(p));
    for day in days.iter().filter(|d| listed.contains(d)) {
        let id = image_catalog(day)?;
        for (fetched, group, member) in
            listed_acquisitions(&shared.reader.transport, &id, deadline).await?
        {
            let key = (fetched, day.clone(), group);
            if fetched as f64 > cut || known.contains_key(&key) {
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
            let values =
                tokio::time::timeout_at(deadline, super::air_input::cpu_task(&cpu, decode))
                    .await
                    .map_err(|_| "image decode deadline".to_owned())??;
            known.insert(key, Known { pub_date, values });
        }
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
