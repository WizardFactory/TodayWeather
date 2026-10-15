//! S15b-3c: the AirKorea image hourly forecast of one request.
//!
//! The `airkorea-forecast-image` acquisitions of the last three KST days (one group per
//! announcement: the PM10 and PM2.5 GIFs) are replayed in completion order as legacy `do` runs:
//! a stored `pubDate` is skipped, otherwise every station of the current station list is decoded
//! (the decoded values are cached per acquisition and station list), then rows older than one day
//! are removed. S3 reads and decoding run as owned single-flight tasks that update the process
//! fold; a request waits for them only until its own deadline.
//!
//! A request that reads the forecast (`airForecastSource` `airkorea`, or `kaq` mapped to it when
//! no KAQ forecast exists, AK 2026-10-15) and finds the announcement expected now missing starts
//! one owned acquisition of its two images (S13d `OwnedFlights`, 10-minute retry) from the dust
//! forecast documents' `imageUrl[6]`/`[7]` and waits for it only until its deadline.
use super::air_forecast::{CODES, Calibration, HourlyForecasts, Processed, decode_points};
use super::airkorea::{Forecasts, Stations};
use super::doc::Val;
use super::live::{AirKoreaAcquire, Flights};
use super::records::{Reader, months};
use crate::domestic::airkorea_image::{self as image, AirKoreaImageRequest};
use crate::domestic::publication::Publication;
use crate::gateway::BoxFuture;
use crate::history::IndexListing;
use crate::resolver::{OwnedConfig, OwnedFlights};
use crate::storage::CatalogStore;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::time::Instant;

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;
/// Image acquisitions read (a row lives one day; a forecast covers two).
const DAYS: i64 = 3;
/// A fold is re-read at most this often unless an AirKorea acquisition published.
const MEMO: Duration = Duration::from_secs(60);
/// Owned S3 reads with decoding.
const READ_FOR: Duration = Duration::from_secs(300);

/// The per-station values of one acquisition, per code.
type Decoded = Vec<(&'static str, Vec<Option<Vec<f64>>>)>;
/// One image acquisition: completion instant, partition, `pubDate`, the two GIFs.
struct Acquisition {
    fetched: u64,
    partition: String,
    pub_date: String,
    gifs: Vec<Arc<[u8]>>,
}
#[derive(Default)]
struct State {
    folded: Arc<HourlyForecasts>,
    decoded: HashMap<(u64, String, u64), Arc<Decoded>>,
    refreshed: Option<std::time::Instant>,
    generation: u64,
}
struct Shared<T> {
    reader: Reader<T>,
    calibration: Calibration,
    reads: OwnedFlights<String, bool>,
    state: std::sync::Mutex<State>,
    refresh: tokio::sync::Mutex<()>,
    cpu: Arc<tokio::sync::Semaphore>,
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
/// first PM2.5 document's `imageUrl[7]` of the announcement.
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

impl<T: IndexListing + Clone + 'static> ImageForecasts<T> {
    pub fn new(transport: T, store: Arc<CatalogStore<T>>, calibration: Calibration) -> Self {
        Self {
            shared: Arc::new(Shared {
                reader: Reader { transport, store },
                calibration,
                reads: OwnedFlights::new(OwnedConfig {
                    running: 2,
                    entries: 16,
                    retain: Duration::ZERO,
                })
                .expect("valid read bounds"),
                state: Default::default(),
                refresh: Default::default(),
                cpu: Arc::new(tokio::sync::Semaphore::new(1)),
            }),
        }
    }
    pub fn calibration(&self) -> &Calibration {
        &self.shared.calibration
    }
    /// The forecast fold for a request at `now`; `generation` is the AirKorea publication count
    /// (an image publication invalidates the memo). Starts the expected announcement's image
    /// acquisition when it is missing and waits for it until `until`.
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
        let expected = super::airkorea::expected_announcement(now);
        if let (Some(expected), Some(forecasts), Some(acquire)) = (expected, forecasts, acquire)
            && !self.fold().has(&pub_date(&expected))
            && let (Some(pm10), Some(pm25)) = image_paths(forecasts, &expected)
            && let Some(at) = announcement(&expected)
            && let Ok(request) = AirKoreaImageRequest::new(
                at,
                &pm10,
                &pm25,
                (
                    self.shared.calibration.width as usize,
                    self.shared.calibration.height as usize,
                ),
            )
        {
            let counter = generation.clone();
            let published = flights
                .join_for(
                    &format!("images-{}", at.compact()),
                    until,
                    super::live::IMAGE_CALL_BUDGET + Duration::from_secs(10),
                    move || -> BoxFuture<'static, bool> {
                        Box::pin(async move {
                            let ok = matches!(acquire.acquire_images(request).await, Ok(Some(_)));
                            if ok {
                                counter.fetch_add(1, Ordering::AcqRel);
                            }
                            ok
                        })
                    },
                )
                .await;
            if published {
                self.read(now, stations, generation, until).await;
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
        {
            let state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.generation == current && state.refreshed.is_some_and(|r| r.elapsed() < MEMO) {
                return;
            }
        }
        let shared = self.shared.clone();
        let _ = self
            .shared
            .reads
            .join(
                format!("images-{current}"),
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
/// Read the image acquisitions of the last three KST days and refold them (decoding only
/// acquisitions not decoded for this station list).
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
    // Acquisitions completed while the request waited are part of it.
    let cut = wall_ms().max(now);
    let days: Vec<String> = (0..DAYS)
        .rev()
        .map(|d| format!("{:08}", kst_date(cut - d as f64 * DAY_MS)))
        .collect();
    let key = AirKoreaImageRequest::provider_key();
    let listed = shared
        .reader
        .partitions(
            image::SOURCE,
            image::KIND,
            &key,
            &months(cut - (DAYS - 1) as f64 * DAY_MS, cut),
            deadline,
        )
        .await
        .map_err(|e| format!("image listing: {e}"))?;
    let mut acquisitions = Vec::new();
    for day in days.iter().filter(|d| listed.contains(d)) {
        for records in shared
            .reader
            .raw(image::SOURCE, image::KIND, &key, day, deadline)
            .await
            .map_err(|e| format!("image read: {e}"))?
        {
            let Some(fetched) = records
                .iter()
                .map(|r| r.envelope.identity.fetched_at_ms)
                .max()
            else {
                continue;
            };
            if fetched as f64 > cut || records.len() != 2 {
                continue;
            }
            let period = &records[0].envelope.identity.period;
            let date = format!("{:08}", period.local_date);
            let pub_date = format!(
                "{}-{}-{} {}:00",
                &date[..4],
                &date[4..6],
                &date[6..],
                period.slot.get(..2).unwrap_or("00")
            );
            acquisitions.push(Acquisition {
                fetched,
                partition: day.clone(),
                pub_date,
                gifs: records.iter().map(|r| r.bytes.clone()).collect(),
            });
        }
    }
    acquisitions.sort_by_key(|a| a.fetched);
    let points = station_points(&stations);
    let skey = stations_key(&points);
    let cached = shared
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .decoded
        .clone();
    let calibration = shared.calibration.clone();
    let cpu = shared.cpu.clone();
    let work = move || {
        let mut decoded = HashMap::new();
        let mut fold = HourlyForecasts::default();
        let coords: Vec<(f64, f64)> = points.iter().map(|(_, lat, lon)| (*lat, *lon)).collect();
        for a in &acquisitions {
            let id = (a.fetched, a.partition.clone(), skey);
            if fold.has(&a.pub_date) {
                // `_checkHourlyForecast`: the announcement is stored; only old rows go.
                fold.remove_old(a.fetched as f64);
                continue;
            }
            let values = match cached.get(&id) {
                Some(v) => v.clone(),
                None => {
                    let mut values: Decoded = Vec::new();
                    let mut failed = false;
                    for ((code, table), gif) in CODES.iter().zip(&a.gifs) {
                        match decode_points(gif, &calibration, table, &coords) {
                            Ok(v) => values.push((code, v)),
                            Err(_) => failed = true,
                        }
                    }
                    if failed {
                        // `getDustImage` failed: nothing is stored, old rows go.
                        fold.remove_old(a.fetched as f64);
                        continue;
                    }
                    Arc::new(values)
                }
            };
            fold.apply(&Processed {
                pub_date: a.pub_date.clone(),
                now: a.fetched as f64,
                stations: &points,
                values: (*values).clone(),
            });
            decoded.insert(id, values);
        }
        // The hourly `do` runs removed rows up to the last hour (here: the request).
        fold.remove_old(cut);
        (fold, decoded)
    };
    let (fold, decoded) = tokio::time::timeout_at(deadline, super::air_input::cpu_task(&cpu, work))
        .await
        .map_err(|_| "image fold deadline".to_owned())??;
    let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
    state.folded = Arc::new(fold);
    state.decoded = decoded;
    state.generation = generation;
    state.refreshed = Some(std::time::Instant::now());
    Ok(())
}
