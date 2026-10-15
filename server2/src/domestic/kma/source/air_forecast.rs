//! S15b-3c: the AirKorea image hourly forecast (`ArpltnHourlyForecast`).
//!
//! Legacy references (master `1ed4fbf1`):
//! - collection: `kecoRequester.getMinuDustFrcstDspth` (L649-703) runs
//!   `AirkoreaHourlyForecastController.do(dataTime)` (L694) after every forecast run:
//!   `_checkHourlyForecast` (skip a stored `pubDate`), `_getImgPaths` (the first PM10 document's
//!   `imageUrl[6]` and PM2.5 `imageUrl[7]` of that announcement), `getDustImage` (get-pixels
//!   3.3.2, [`super::gif`]), `_updateHourlyForecast` over every `MsrStnInfo` station (PM10 then
//!   PM2.5), `_removeOldData` (rows dated before now - 1 day);
//! - decoding: `airkorea.finedust.image.parser` (`isValidImage`, the map rectangle and degree per
//!   pixel) and `airkorea.dust.image.controller.getDustInfo` (L213-299): the station pixel, then the
//!   8x8 block around it, the first exact colour-table match per frame, -1 otherwise; 48 hourly
//!   rows from the processing day (the next day for a 17시/23시 announcement processed that day);
//! - storage and reader: `img.hourly.forecast.controller` (`_makeHourForecast`, `_updateDb`
//!   upsert by station, date and code; `getForecast`: `find({stationName}).sort({date: 1})`).
//!
//! Intended differences (AK, 2026-10-15): the GIF screen is now 820x820 (the deployed
//! configuration expected 820x830 and rejected every current image), and the colour tables are
//! read from the current legend (see [`COLORS_PM10`]); the calibration is the deployed one.
use super::doc::{Doc, Val};
use super::gif::GifReader;
use crate::gateway::OrderedJson;
use std::collections::HashMap;

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;

/// The map calibration (`config.image.airkorea_korea_image`).
#[derive(Debug, Clone, PartialEq)]
pub struct Calibration {
    pub top_lat: f64,
    pub bottom_lat: f64,
    pub left_lon: f64,
    pub right_lon: f64,
    pub width: f64,
    pub height: f64,
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}
impl Calibration {
    /// The service host's `config.js` values (read-only, 2026-10-14, L89-105) with the GIF
    /// screen the provider sends now (AK, 2026-10-15: 820x820 instead of 820x830).
    pub fn deployed() -> Self {
        Self {
            top_lat: 39.3769,
            bottom_lat: 32.6942,
            left_lon: 123.9523,
            right_lon: 130.6741,
            width: 820.,
            height: 820.,
            left: 78.,
            right: 663.,
            top: 80.,
            bottom: 798.,
        }
    }
    /// The legacy setting names (`AIRKOREA_KOREA_IMAGE_*`, `config.js` L88-105) with the
    /// deployed values for an unset name; coordinates through `parseFloat`, pixels and sizes
    /// through `parseInt` as the parser reads them.
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Self {
        let d = Self::deployed();
        let float = |name: &str, default: f64| {
            var(name).map_or(default, |v| crate::world::js::parse_float(&v))
        };
        let int = |name: &str, default: f64| {
            var(name).map_or(default, |v| {
                crate::domestic::kma::js::parse_int(&crate::domestic::kma::js::V::s(&v))
            })
        };
        Self {
            top_lat: float("AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT", d.top_lat),
            bottom_lat: float("AIRKOREA_KOREA_IMAGE_COORDI_BOTTOM_LAT", d.bottom_lat),
            left_lon: float("AIRKOREA_KOREA_IMAGE_COORDI_LEFT_LON", d.left_lon),
            right_lon: float("AIRKOREA_KOREA_IMAGE_COORDI_RIGHT_LON", d.right_lon),
            width: int("AIRKOREA_KOREA_IMAGE_SIZE_WIDTH", d.width),
            height: int("AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT", d.height),
            left: int("AIRKOREA_KOREA_IMAGE_MAP_LEFT", d.left),
            right: int("AIRKOREA_KOREA_IMAGE_MAP_RIGHT", d.right),
            top: int("AIRKOREA_KOREA_IMAGE_MAP_TOP", d.top),
            bottom: int("AIRKOREA_KOREA_IMAGE_MAP_BOTTOM", d.bottom),
        }
    }
    /// `isValidImage(width, height)`.
    pub fn valid_size(&self, width: usize, height: usize) -> bool {
        self.width == width as f64 && self.height == height as f64
    }
    /// The station pixel (`getDustInfo`), or None for a geocode outside the box
    /// (`_isValidGeocode`); NaN coordinates pass the box and give NaN pixels.
    fn pixel(&self, lat: f64, lon: f64) -> Option<(f64, f64)> {
        if lat > self.top_lat
            || lat < self.bottom_lat
            || lon < self.left_lon
            || lon > self.right_lon
        {
            return None;
        }
        let dw = (self.right_lon - self.left_lon) / (self.right - self.left);
        let dh = (self.top_lat - self.bottom_lat) / (self.bottom - self.top);
        Some((
            js_parse_int_number((lon - self.left_lon) / dw) + self.left,
            js_parse_int_number((self.top_lat - lat) / dh) + self.top,
        ))
    }
}
/// `parseInt(number)`: the number's string form parsed as an integer.
fn js_parse_int_number(n: f64) -> f64 {
    crate::domestic::kma::js::parse_int(&crate::domestic::kma::js::V::Num(n))
}

/// One legend colour and the value legacy stores for it.
pub type Color = ((u8, u8, u8), f64);
/// PM10 colours of the current AirKorea legend (the `11시 발표` GIFs of 2026-10-15, legend column
/// x = 686, top to bottom) with the band's upper label as the value, as legacy assigns them (the
/// band above the top label keeps legacy's 600). AK 2026-10-15: replaces legacy `colorTable_pm10`.
pub const COLORS_PM10: [Color; 36] = [
    ((105, 0, 0), 600.),
    ((130, 0, 0), 320.),
    ((155, 0, 0), 280.),
    ((180, 0, 0), 260.),
    ((205, 0, 0), 240.),
    ((230, 0, 0), 220.),
    ((255, 0, 0), 200.),
    ((255, 60, 60), 190.),
    ((255, 90, 90), 180.),
    ((255, 120, 120), 170.),
    ((255, 150, 150), 160.),
    ((100, 100, 0), 151.),
    ((115, 115, 0), 143.),
    ((131, 131, 0), 136.),
    ((146, 146, 0), 129.),
    ((162, 162, 0), 122.),
    ((177, 177, 0), 115.),
    ((193, 193, 0), 108.),
    ((208, 208, 0), 101.),
    ((224, 224, 0), 94.),
    ((240, 240, 0), 87.),
    ((0, 118, 0), 81.),
    ((0, 138, 0), 75.),
    ((0, 157, 0), 70.),
    ((0, 177, 0), 65.),
    ((0, 195, 0), 60.),
    ((0, 216, 0), 55.),
    ((0, 234, 0), 50.),
    ((0, 254, 0), 45.),
    ((100, 254, 100), 40.),
    ((149, 254, 149), 35.),
    ((53, 150, 249), 31.),
    ((75, 162, 244), 24.),
    ((100, 175, 240), 18.),
    ((135, 192, 232), 12.),
    ((152, 201, 228), 6.),
];
/// PM2.5 colours of the current legend (same source), the band's upper label as the value (the
/// band above the top label keeps legacy's 500). Replaces legacy `colorTable_pm25`.
pub const COLORS_PM25: [Color; 36] = [
    ((105, 0, 0), 500.),
    ((130, 0, 0), 200.),
    ((155, 0, 0), 170.),
    ((180, 0, 0), 160.),
    ((205, 0, 0), 150.),
    ((230, 0, 0), 140.),
    ((255, 0, 0), 120.),
    ((255, 60, 60), 110.),
    ((255, 90, 90), 100.),
    ((255, 120, 120), 90.),
    ((255, 150, 150), 80.),
    ((100, 100, 0), 76.),
    ((115, 115, 0), 70.),
    ((131, 131, 0), 65.),
    ((146, 146, 0), 60.),
    ((162, 162, 0), 55.),
    ((177, 177, 0), 50.),
    ((193, 193, 0), 46.),
    ((208, 208, 0), 42.),
    ((224, 224, 0), 39.),
    ((240, 240, 0), 37.),
    ((0, 118, 0), 36.),
    ((0, 138, 0), 33.),
    ((0, 157, 0), 31.),
    ((0, 177, 0), 29.),
    ((0, 195, 0), 27.),
    ((0, 216, 0), 25.),
    ((0, 234, 0), 23.),
    ((0, 254, 0), 21.),
    ((100, 254, 100), 19.),
    ((149, 254, 149), 17.),
    ((53, 150, 249), 16.),
    ((76, 162, 244), 12.),
    ((100, 175, 240), 9.),
    ((135, 192, 232), 6.),
    ((152, 201, 228), 3.),
];

/// The pollutant codes (`this.pollutants`) with their colour tables.
pub const CODES: [(&str, &[Color]); 2] = [("pm10", &COLORS_PM10), ("pm25", &COLORS_PM25)];

/// Per point, the value `getDustInfo` reads in every frame (-1: no colour found), or None for a
/// point outside the map box (`_isValidGeocode`: the station is skipped). Frames are decoded one
/// at a time into one zeroed RGBA buffer, as get-pixels gives each frame its own.
pub fn decode_points(
    gif: &[u8],
    calibration: &Calibration,
    table: &[Color],
    points: &[(f64, f64)],
) -> Result<Vec<Option<Vec<f64>>>, String> {
    let reader = GifReader::new(gif)?;
    if !calibration.valid_size(reader.width, reader.height) {
        return Err("INVALID_IMAGE".into());
    }
    let (w, h) = (reader.width as isize, reader.height as isize);
    let pixels: Vec<Option<(f64, f64)>> = points
        .iter()
        .map(|(lat, lon)| calibration.pixel(*lat, *lon))
        .collect();
    let mut out: Vec<Option<Vec<f64>>> = pixels
        .iter()
        .map(|p| p.map(|_| Vec::with_capacity(reader.num_frames())))
        .collect();
    let mut frame = vec![0u8; reader.width * reader.height * 4];
    for f in 0..reader.num_frames() {
        frame.iter_mut().for_each(|b| *b = 0);
        reader.decode_and_blit_rgba(f, &mut frame)?;
        for (i, pixel) in pixels.iter().enumerate() {
            let Some((x, y)) = pixel else {
                continue;
            };
            if let Some(values) = out[i].as_mut() {
                values.push(value_at(&frame, w, h, *x, *y, table));
            }
        }
    }
    Ok(out)
}
/// The centre, then the 8x8 block (-4..+3) in row-major order: the first pixel whose RGB is a
/// table colour gives that colour's first value. `pixels.get(i, x, y, c)` reads the frame at
/// `y * width + x`; a NaN or out-of-frame position never matches (a read outside every frame is
/// `undefined`; one into another frame never happens for points inside the map rectangle).
fn value_at(frame: &[u8], w: isize, h: isize, x: f64, y: f64, table: &[Color]) -> f64 {
    if !x.is_finite() || !y.is_finite() {
        return -1.;
    }
    let (x, y) = (x as isize, y as isize);
    for j in 0..64isize {
        let (dx, dy) = if j == 0 {
            (0, 0)
        } else {
            (j / 8 - 4, j % 8 - 4)
        };
        let (px, py) = (x + dx, y + dy);
        let idx = (py * w + px) * 4;
        if py < 0 || py >= h || idx < 0 || (idx as usize + 2) >= frame.len() {
            continue;
        }
        let i = idx as usize;
        let rgb = (frame[i], frame[i + 1], frame[i + 2]);
        if let Some((_, v)) = table.iter().find(|(c, _)| *c == rgb) {
            return *v;
        }
    }
    -1.
}

/// `'YYYY-MM-DD HH:MM'` of a time value (the process's local time is UTC).
fn minute_text(ms: f64) -> Option<String> {
    let p = crate::world::js::parts(ms)?;
    Some(format!(
        "{:04}-{:02}-{:02} {:02}:{:02}",
        p.year, p.month, p.day, p.hour, p.minute
    ))
}
/// `new Date('YYYY-MM-DD HH:MM')` in the UTC process.
fn parse_minute(text: &str) -> Option<f64> {
    let ms = crate::domestic::kma::time::new_date(&crate::domestic::kma::js::V::s(text));
    ms.is_finite().then_some(ms)
}
/// The 48 row times `getDustInfo` assigns at processing time `now` to a `pubDate`
/// (`YYYY-MM-DD HH:00`): from the processing day (KST as local), the next day for a 17시 or
/// later announcement processed on its own day.
pub fn timeline(pub_date: &str, now: f64) -> Option<Vec<String>> {
    let pub_ms = parse_minute(pub_date)?;
    let pub_parts = crate::world::js::parts(pub_ms)?;
    let mut forecast = now + 9. * HOUR_MS;
    let today = crate::world::js::parts(forecast)?;
    if pub_parts.hour >= 17 && pub_parts.day == today.day {
        forecast += DAY_MS;
    }
    let mut out = Vec::with_capacity(48);
    for i in 0..48 {
        if i == 24 {
            forecast += DAY_MS;
        }
        let p = crate::world::js::parts(forecast)?;
        // setHours(i % 24); setMinutes(0): the seconds stay, the text shows minutes only.
        let day_start = crate::world::js::days_from_civil(p.year, p.month, p.day) as f64 * DAY_MS;
        forecast =
            day_start + f64::from(i % 24) * HOUR_MS + (forecast - day_start).rem_euclid(60_000.);
        out.push(minute_text(forecast)?);
    }
    Some(out)
}

/// One stored row (`_makeHourForecast`).
#[derive(Debug, Clone, PartialEq)]
struct Row {
    station: String,
    date: f64,
    code: &'static str,
    val: f64,
    data_time: String,
    pub_date: String,
}
/// The `ArpltnHourlyForecast` collection in natural order.
#[derive(Debug, Clone, Default)]
pub struct HourlyForecasts {
    rows: Vec<Row>,
    index: HashMap<(String, u64, &'static str), usize>,
}
/// One processed announcement: its `pubDate`, the processing instant and, per code, the decoded
/// values of every station (None: the station is outside the map box).
pub struct Processed<'a> {
    pub pub_date: String,
    pub now: f64,
    pub stations: &'a [(String, f64, f64)],
    /// `(code, per station values per frame)` in `this.pollutants` order.
    pub values: Vec<(&'static str, Vec<Option<Vec<f64>>>)>,
}
impl HourlyForecasts {
    pub fn len(&self) -> usize {
        self.rows.len()
    }
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
    /// `_checkHourlyForecast(pubDate)`: rows of both codes with that `pubDate` exist.
    pub fn has(&self, pub_date: &str) -> bool {
        ["pm10", "pm25"].iter().all(|code| {
            self.rows
                .iter()
                .any(|r| r.code == *code && r.pub_date == pub_date)
        })
    }
    /// One `do` that reached `_updateHourlyForecast`: every station's 48 rows per code (an hour
    /// without a value is not stored), then `_removeOldData` at `now`.
    pub fn apply(&mut self, p: &Processed) {
        for (code, per_station) in &p.values {
            for ((station, _, _), values) in p.stations.iter().zip(per_station) {
                // `_isValidGeocode` failed: the station is skipped.
                let Some(values) = values else {
                    continue;
                };
                let Some(times) = timeline(&p.pub_date, p.now) else {
                    continue;
                };
                for (i, time) in times.iter().enumerate() {
                    // `result[i]`: missing for a GIF with fewer frames, -1 without a colour.
                    let Some(val) = values.get(i).copied().filter(|v| *v != -1.) else {
                        continue;
                    };
                    let Some(date) = parse_minute(time) else {
                        continue;
                    };
                    self.upsert(Row {
                        station: station.clone(),
                        date,
                        code,
                        val,
                        data_time: time.clone(),
                        pub_date: p.pub_date.clone(),
                    });
                }
            }
        }
        self.remove_old(p.now);
    }
    fn upsert(&mut self, row: Row) {
        let key = (row.station.clone(), row.date.to_bits(), row.code);
        match self.index.get(&key) {
            Some(i) => self.rows[*i] = row,
            None => {
                self.rows.push(row);
                self.index.insert(key, self.rows.len() - 1);
            }
        }
    }
    /// `_removeOldData` at `now`: rows dated before now - 1 day (`date` holds the KST wall time
    /// as a UTC instant, compared with the real instant as legacy does).
    pub fn remove_old(&mut self, now: f64) {
        let limit = now - DAY_MS;
        if self.rows.iter().all(|r| r.date >= limit) {
            return;
        }
        self.rows.retain(|r| r.date >= limit);
        self.index = self
            .rows
            .iter()
            .enumerate()
            .map(|(i, r)| ((r.station.clone(), r.date.to_bits(), r.code), i))
            .collect();
    }
    /// `getForecast(stationName)`: `find({stationName}).sort({date: 1})` (stable).
    pub fn by_station(&self, station: &str) -> OrderedJson {
        let mut rows: Vec<&Row> = self.rows.iter().filter(|r| r.station == station).collect();
        rows.sort_by(|a, b| a.date.total_cmp(&b.date));
        OrderedJson::Array(rows.into_iter().map(|r| row_doc(r).json()).collect())
    }
    pub fn json(&self) -> OrderedJson {
        OrderedJson::Array(self.rows.iter().map(|r| row_doc(r).json()).collect())
    }
}
/// The stored form: the query fields, `__v` from the upsert's insert, then the replacement's
/// remaining keys in Mongoose 5.1.2's reverse walk.
fn row_doc(r: &Row) -> Doc {
    Doc::new()
        .with("stationName", Val::str(&r.station))
        .with("date", Val::Date(r.date))
        .with("code", Val::str(r.code))
        .with("__v", Val::num(0.))
        .with("pubDate", Val::str(&r.pub_date))
        .with("dataTime", Val::str(&r.data_time))
        .with("val", Val::num(r.val))
}
