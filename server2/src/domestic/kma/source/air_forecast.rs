//! S15b-3c: the AirKorea image hourly forecast (`ArpltnHourlyForecast`), as legacy master after
//! #2757 ("Restore AirKorea image-derived hourly forecasts") and #2762 (variable frames and cycle
//! times, `1d60f728`) collects it.
//!
//! Legacy references (master `1d60f728`):
//! - collection: `kecoRequester.getMinuDustFrcstDspth` (L649-703) runs
//!   `AirkoreaHourlyForecastController.do(dataTime)` (L694) after every forecast run:
//!   `_checkHourlyForecast` (skip a `pubDate` with rows of both codes), `_getImgPaths` (the first
//!   PM10 document's `imageUrl[6]` and PM2.5 `imageUrl[7]` of that announcement), `getDustImage`
//!   (both paths must pass `airkoreaImageLayout.frameStart`, then get-pixels 3.3.2 decodes each,
//!   [`super::gif`], and `layout.validate` checks it), `_updateHourlyForecast` over every
//!   `MsrStnInfo` station (PM10 then PM2.5; `layout.station`), `_removeOldData` (rows dated
//!   before now - 1 day);
//! - `lib/airkoreaImageLayout.js` (with #2762, master `1d60f728`): the characterized NIER 09km
//!   animation: an 820x820 RGBA canvas of any positive frame count, in every frame the 36-band
//!   legend at x 680 inside each characterized colour's neighbourhood (half the distance to the
//!   nearest other band), the `/dustImage/YYYY/MM/DD/HH/09km/` six-hour cycles (HH 05, 11, 17,
//!   23; the first frame is HH + 1 KST), station pixels matched exactly and then to the nearest
//!   band of that frame's legend inside its neighbourhood, searching the centre and rings up to
//!   three pixels inside the map rectangle, values the band's lower threshold;
//! - `config.js` `image.airkorea_korea_image` (the `AIRKOREA_KOREA_IMAGE_*` names with the
//!   characterized defaults), `airkorea.finedust.image.parser` (`getImagePos` with `parseInt`,
//!   `getDefaultCoordi` with `parseFloat`, degree per pixel);
//! - storage and reader: `img.hourly.forecast.controller` (`_makeHourForecast` with the AirKorea
//!   override storing the KST hour as its UTC instant, `_updateDb` upsert by station, date and
//!   code; `getForecast`: `find({stationName}).sort({date: 1})`).
use super::doc::{Doc, Val};
use super::gif::GifReader;
use crate::gateway::OrderedJson;
use std::collections::HashMap;

const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;
/// The characterized canvas.
pub const CANVAS: usize = 820;
/// The characterized legend colours, top band first (`airkoreaImageLayout.colours`).
const COLOURS: [[i32; 3]; 36] = [
    [105, 0, 0],
    [130, 0, 0],
    [155, 0, 0],
    [180, 0, 0],
    [205, 0, 0],
    [230, 0, 0],
    [255, 0, 0],
    [255, 60, 60],
    [255, 90, 90],
    [255, 120, 120],
    [255, 150, 150],
    [100, 100, 0],
    [115, 115, 0],
    [131, 131, 0],
    [146, 146, 0],
    [162, 162, 0],
    [177, 177, 0],
    [193, 193, 0],
    [208, 208, 0],
    [224, 224, 0],
    [240, 240, 0],
    [0, 118, 0],
    [0, 138, 0],
    [0, 157, 0],
    [0, 177, 0],
    [0, 195, 0],
    [0, 216, 0],
    [0, 234, 0],
    [0, 254, 0],
    [100, 254, 100],
    [149, 254, 149],
    [53, 150, 249],
    [76, 162, 244],
    [100, 175, 240],
    [135, 192, 232],
    [152, 201, 228],
];
/// The lower threshold of each band (`airkoreaImageLayout.thresholds.PM10`; the unbounded top
/// band capped at its lowest labelled threshold).
pub const THRESHOLDS_PM10: [f64; 36] = [
    320., 280., 260., 240., 220., 200., 190., 180., 170., 160., 151., 143., 136., 129., 122., 115.,
    108., 101., 94., 87., 81., 75., 70., 65., 60., 55., 50., 45., 40., 35., 31., 24., 18., 12., 6.,
    0.,
];
/// `airkoreaImageLayout.thresholds.PM25`.
pub const THRESHOLDS_PM25: [f64; 36] = [
    200., 170., 160., 150., 140., 120., 110., 100., 90., 80., 76., 70., 65., 60., 55., 50., 46.,
    42., 39., 37., 36., 33., 31., 29., 27., 25., 23., 21., 19., 17., 16., 12., 9., 6., 3., 0.,
];
/// The pollutants (`this.pollutants`): the stored code, the image type and its thresholds.
pub const CODES: [(&str, &str, &[f64; 36]); 2] = [
    ("pm10", "PM10", &THRESHOLDS_PM10),
    ("pm25", "PM25", &THRESHOLDS_PM25),
];
/// The `INVALID_IMAGE` error of the layout checks.
pub const INVALID_IMAGE: &str = "INVALID_IMAGE";

/// `airkoreaImageLayout.number`: an empty value is NaN, otherwise `Number(value)`.
fn number(value: &str) -> f64 {
    if value.is_empty() {
        f64::NAN
    } else {
        crate::world::js::string_to_number(value)
    }
}

/// The map calibration (`config.image.airkorea_korea_image`): the setting texts as `config.js`
/// holds them (`process.env.X || default`).
#[derive(Debug, Clone, PartialEq)]
pub struct Calibration {
    /// `coordi`: top_lat, bottom_lat, left_lon, right_lon.
    coordi: [String; 4],
    /// `size`: width, height.
    size: [String; 2],
    /// `pixel_pos`: left, right, top, bottom.
    pos: [String; 4],
}
const COORDI_NAMES: [&str; 4] = [
    "AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT",
    "AIRKOREA_KOREA_IMAGE_COORDI_BOTTOM_LAT",
    "AIRKOREA_KOREA_IMAGE_COORDI_LEFT_LON",
    "AIRKOREA_KOREA_IMAGE_COORDI_RIGHT_LON",
];
const SIZE_NAMES: [&str; 2] = [
    "AIRKOREA_KOREA_IMAGE_SIZE_WIDTH",
    "AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT",
];
const POS_NAMES: [&str; 4] = [
    "AIRKOREA_KOREA_IMAGE_MAP_LEFT",
    "AIRKOREA_KOREA_IMAGE_MAP_RIGHT",
    "AIRKOREA_KOREA_IMAGE_MAP_TOP",
    "AIRKOREA_KOREA_IMAGE_MAP_BOTTOM",
];
impl Calibration {
    /// The `config.js` defaults of legacy master (L89-105): the characterized 820x820 canvas, map
    /// x 77..663 and y 75..794 (exclusive ends), the inherited geographic box.
    pub fn defaults() -> Self {
        Self {
            coordi: ["39.3769", "32.6942", "123.9523", "130.6741"].map(String::from),
            size: ["820", "820"].map(String::from),
            pos: ["77", "663", "75", "794"].map(String::from),
        }
    }
    /// The legacy setting names; an unset or empty value takes the default (`||`).
    pub fn from_vars(var: &dyn Fn(&str) -> Option<String>) -> Self {
        let d = Self::defaults();
        let pick = |name: &str, default: &String| {
            var(name)
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| default.clone())
        };
        Self {
            coordi: std::array::from_fn(|i| pick(COORDI_NAMES[i], &d.coordi[i])),
            size: std::array::from_fn(|i| pick(SIZE_NAMES[i], &d.size[i])),
            pos: std::array::from_fn(|i| pick(POS_NAMES[i], &d.pos[i])),
        }
    }
    /// `getImagePos`: left, right, top, bottom through `parseInt`.
    pub fn image_pos(&self) -> [f64; 4] {
        self.pos
            .clone()
            .map(|v| crate::domestic::kma::js::parse_int(&crate::domestic::kma::js::V::s(&v)))
    }
    /// `getDefaultCoordi`: top_lat, bottom_lat, left_lon, right_lon through `parseFloat`.
    pub fn coordinate(&self) -> [f64; 4] {
        self.coordi
            .clone()
            .map(|v| crate::world::js::parse_float(&v))
    }
    /// `layout.geometry`: integer map bounds inside the canvas and a finite, ordered box.
    fn geometry_ok(&self) -> bool {
        let p = self.pos.clone().map(|v| number(&v));
        let g = self.coordi.clone().map(|v| number(&v));
        let [left, right, top, bottom] = p;
        let [top_lat, bottom_lat, left_lon, right_lon] = g;
        p.iter().all(|v| v.is_finite() && v.fract() == 0.)
            && left >= 0.
            && top >= 0.
            && right <= CANVAS as f64
            && bottom <= CANVAS as f64
            && left < right
            && top < bottom
            && g.iter().all(|v| v.is_finite())
            && top_lat <= 90.
            && bottom_lat >= -90.
            && left_lon >= -180.
            && right_lon <= 180.
            && top_lat > bottom_lat
            && left_lon < right_lon
    }
    /// The canvas `layout.validate` accepts: the characterized 820x820, equal to the size
    /// settings (another size setting rejects every image).
    pub fn canvas_ok(&self, width: usize, height: usize) -> bool {
        width == CANVAS
            && height == CANVAS
            && width as f64 == number(&self.size[0])
            && height as f64 == number(&self.size[1])
    }
}

/// `layout.frameStart(path, type)`: the first frame instant of a characterized six-hour-cycle
/// animation URL (cycle hour 05, 11, 17 or 23; the first frame is the cycle hour + 1 KST), with the
/// KST wall time held in UTC fields; anything else fails closed. `kind` is the image type (`PM10`
/// or `PM25`).
pub fn frame_start(path: &str, kind: &str) -> Result<f64, String> {
    let invalid = || INVALID_IMAGE.to_owned();
    let rest = path
        .strip_prefix("https://")
        .or_else(|| path.strip_prefix("http://"))
        .ok_or_else(invalid)?;
    let rest = rest
        .strip_prefix("www.airkorea.or.kr/dustImage/")
        .ok_or_else(invalid)?;
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    let (year, rest) = rest.split_at_checked(4).ok_or_else(invalid)?;
    let rest = rest.strip_prefix('/').ok_or_else(invalid)?;
    let (month, rest) = rest.split_at_checked(2).ok_or_else(invalid)?;
    let rest = rest.strip_prefix('/').ok_or_else(invalid)?;
    let (day, rest) = rest.split_at_checked(2).ok_or_else(invalid)?;
    let rest = rest.strip_prefix('/').ok_or_else(invalid)?;
    let (cycle, rest) = rest.split_at_checked(2).ok_or_else(invalid)?;
    let rest = rest.strip_prefix("/09km/AQF.").ok_or_else(invalid)?;
    let (model, rest) = rest.split_at_checked(8).ok_or_else(invalid)?;
    let rest = rest.strip_prefix(".NIER_09_01.").ok_or_else(invalid)?;
    let pollutant = rest.strip_suffix(".2days.ani.gif").ok_or_else(invalid)?;
    if !(digits(year, 4)
        && digits(month, 2)
        && digits(day, 2)
        && digits(cycle, 2)
        && digits(model, 8))
        || model != format!("{year}{month}{day}")
        || !matches!((kind, pollutant), ("PM10", "PM10") | ("PM25", "PM2P5"))
    {
        return Err(invalid());
    }
    let hour: i64 = cycle.parse().map_err(|_| invalid())?;
    if hour > 23 || (hour + 1) % 6 != 0 {
        return Err(invalid());
    }
    let (y, m, d): (i64, i64, i64) = (
        year.parse().map_err(|_| invalid())?,
        month.parse().map_err(|_| invalid())?,
        day.parse().map_err(|_| invalid())?,
    );
    // `Date.UTC` maps years 0-99 to 1900+; the ISO date must read back unchanged.
    let days = crate::world::js::days_from_civil(y, m, d);
    let back = crate::world::js::parts(days as f64 * DAY_MS).ok_or_else(invalid)?;
    if y < 100 || (back.year, back.month, back.day) != (y, m, d) {
        return Err(invalid());
    }
    Ok(days as f64 * DAY_MS + (hour + 1) as f64 * HOUR_MS)
}

/// get-pixels frames (`pixels.get(frame, x, y, channel)`), one frame at a time.
pub trait Pixels {
    /// The ndarray shape: `[frames, width, height, 4]` for an animation.
    fn shape(&self) -> Vec<usize>;
    /// Make frame `f` current.
    fn select(&mut self, f: usize) -> Result<(), String>;
    /// `pixels.get(f, x, y, c)` of the current frame.
    fn get(&self, x: usize, y: usize, c: usize) -> i32;
}
/// The frames of a GIF as get-pixels gives them: each its own zeroed RGBA buffer.
pub struct GifPixels<'a> {
    reader: GifReader<'a>,
    frame: Vec<u8>,
}
impl<'a> GifPixels<'a> {
    pub fn new(gif: &'a [u8]) -> Result<Self, String> {
        let reader = GifReader::new(gif)?;
        // A GIF without frames: get-pixels decodes frame 0, which fails.
        if reader.num_frames() == 0 {
            return Err("Frame index out of range.".into());
        }
        let frame = vec![0u8; reader.width * reader.height * 4];
        Ok(Self { reader, frame })
    }
}
impl Pixels for GifPixels<'_> {
    fn shape(&self) -> Vec<usize> {
        vec![
            self.reader.num_frames(),
            self.reader.width,
            self.reader.height,
            4,
        ]
    }
    fn select(&mut self, f: usize) -> Result<(), String> {
        self.frame.iter_mut().for_each(|b| *b = 0);
        self.reader.decode_and_blit_rgba(f, &mut self.frame)
    }
    fn get(&self, x: usize, y: usize, c: usize) -> i32 {
        i32::from(self.frame[(y * self.reader.width + x) * 4 + c])
    }
}

/// `layout.distance`: the largest channel difference.
fn distance(a: [i32; 3], b: [i32; 3]) -> i32 {
    (0..3).map(|c| (a[c] - b[c]).abs()).max().unwrap_or(0)
}
/// `layout.bandLimits`: half the distance from each colour to its nearest other band (the bands'
/// non-overlapping quantization neighbourhoods).
fn band_limits(table: &[[i32; 3]; 36]) -> [f64; 36] {
    std::array::from_fn(|i| {
        let nearest = (0..36)
            .filter(|&j| j != i)
            .map(|j| distance(table[i], table[j]))
            .min()
            .unwrap_or(i32::MAX);
        f64::from(nearest) / 2.
    })
}
/// `layout.colourIndex`: an exact band, else the nearest band (the first of equals) when closer
/// than its limit; -1 (None) otherwise.
fn colour_index(rgb: [i32; 3], table: &[[i32; 3]; 36], limits: &[f64; 36]) -> Option<usize> {
    if !rgb.iter().all(|v| (0..=255).contains(v)) {
        return None;
    }
    let mut best = None;
    let mut nearest = i32::MAX;
    for (i, band) in table.iter().enumerate() {
        let delta = distance(rgb, *band);
        if delta == 0 {
            return Some(i);
        }
        if delta < nearest {
            nearest = delta;
            best = Some(i);
        }
    }
    best.filter(|&b| f64::from(nearest) < limits[b])
}
/// The search order of `layout.station`: the centre, then rings up to three pixels away
/// (`dx` outer, `dy` inner).
fn offsets() -> Vec<(i64, i64)> {
    let mut out = vec![(0, 0)];
    for r in 1..=3i64 {
        for dx in -r..=r {
            for dy in -r..=r {
                if dx.abs().max(dy.abs()) == r {
                    out.push((dx, dy));
                }
            }
        }
    }
    out
}

/// Per station, the value `layout.station` reads in each of the 48 frames (None: no legend
/// colour found), or None for a station outside the geographic box (`INVALID_STATION_COORDINATE`:
/// the station is skipped). The image must pass `layout.validate`; anything else is an error and
/// nothing is stored for the run.
pub type StationValues = Vec<Option<Vec<Option<f64>>>>;
pub fn decode_points<P: Pixels>(
    pixels: &mut P,
    calibration: &Calibration,
    kind: &str,
    points: &[(f64, f64)],
) -> Result<StationValues, String> {
    let thresholds = CODES
        .iter()
        .find(|(_, k, _)| *k == kind)
        .map(|(_, _, t)| *t)
        .ok_or(INVALID_IMAGE)?;
    // `layout.validate`: the shape (any positive frame count), the size settings, the geometry.
    let shape = pixels.shape();
    if shape.len() != 4
        || shape[0] == 0
        || shape[3] != 4
        || !calibration.canvas_ok(shape[1], shape[2])
        || !calibration.geometry_ok()
    {
        return Err(INVALID_IMAGE.into());
    }
    let [left, right, top, bottom] = calibration.image_pos();
    let [top_lat, bottom_lat, left_lon, right_lon] = calibration.coordinate();
    let dw = (right_lon - left_lon) / (right - left);
    let dh = (top_lat - bottom_lat) / (bottom - top);
    let offsets = offsets();
    // Per station the candidate pixels in search order, inside the map rectangle.
    let candidates: Vec<Option<Vec<(usize, usize)>>> = points
        .iter()
        .map(|&(lat, lon)| {
            if !lat.is_finite()
                || !lon.is_finite()
                || lat > top_lat
                || lat <= bottom_lat
                || lon < left_lon
                || lon >= right_lon
            {
                return None;
            }
            let x = ((lon - left_lon) / dw).floor() + left;
            let y = ((top_lat - lat) / dh).floor() + top;
            Some(
                offsets
                    .iter()
                    .filter_map(|&(dx, dy)| {
                        let (px, py) = (x + dx as f64, y + dy as f64);
                        (px >= left && px < right && py >= top && py < bottom)
                            .then_some((px as usize, py as usize))
                    })
                    .collect(),
            )
        })
        .collect();
    let count = shape[0];
    let nominal_limits = band_limits(&COLOURS);
    let mut out: StationValues = candidates
        .iter()
        .map(|c| c.as_ref().map(|_| Vec::with_capacity(count)))
        .collect();
    for f in 0..count {
        pixels.select(f)?;
        // The frame's legend: 36 bands at x 680, each opaque and inside its characterized
        // colour's neighbourhood.
        let mut legend = [[0i32; 3]; 36];
        for (i, band) in legend.iter_mut().enumerate() {
            let y = (74. + (i as f64 + 0.5) * 701. / 36.).floor() as usize;
            let rgb = [0, 1, 2].map(|c| pixels.get(680, y, c));
            if pixels.get(680, y, 3) != 255
                || !rgb.iter().all(|v| (0..=255).contains(v))
                || f64::from(distance(rgb, COLOURS[i])) >= nominal_limits[i]
            {
                return Err(INVALID_IMAGE.into());
            }
            *band = rgb;
        }
        let limits = band_limits(&legend);
        for (values, pixel_list) in out.iter_mut().zip(&candidates) {
            let (Some(values), Some(pixel_list)) = (values.as_mut(), pixel_list) else {
                continue;
            };
            let mut found = None;
            for &(px, py) in pixel_list {
                if pixels.get(px, py, 3) != 255 {
                    continue;
                }
                let rgb = [0, 1, 2].map(|c| pixels.get(px, py, c));
                if let Some(band) = colour_index(rgb, &legend, &limits) {
                    found = Some(thresholds[band]);
                    break;
                }
            }
            values.push(found);
        }
    }
    Ok(out)
}
/// [`decode_points`] of a GIF file.
pub fn decode_gif(
    gif: &[u8],
    calibration: &Calibration,
    kind: &str,
    points: &[(f64, f64)],
) -> Result<StationValues, String> {
    decode_points(&mut GifPixels::new(gif)?, calibration, kind, points)
}
/// Whether an acquired image is the characterized animation shape (cheap: the logical screen
/// and at least one frame; `layout.validate` checks the legends when it is decoded).
pub fn image_shape_ok(gif: &[u8], calibration: &Calibration) -> bool {
    GifReader::new(gif)
        .is_ok_and(|r| r.num_frames() > 0 && calibration.canvas_ok(r.width, r.height))
}

/// `'YYYY-MM-DD HH:MM'` of the UTC fields of a time value (`toISOString().slice(0,16)`).
fn minute_text(ms: f64) -> Option<String> {
    let p = crate::world::js::parts(ms)?;
    Some(format!(
        "{:04}-{:02}-{:02} {:02}:{:02}",
        p.year, p.month, p.day, p.hour, p.minute
    ))
}

/// One stored row (`_makeHourForecast` with the AirKorea date override).
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
/// One processed announcement: its `pubDate`, the processing instant and, per code, the first
/// frame instant of its image and the decoded values of every station.
pub struct Processed<'a> {
    pub pub_date: String,
    pub now: f64,
    pub stations: &'a [(String, f64, f64)],
    /// `(code, frame start, per station values per frame)` in `this.pollutants` order.
    pub values: Vec<(&'static str, f64, StationValues)>,
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
    /// One `do` that reached `_updateHourlyForecast`: every station's rows per code (an hour
    /// without a value is not stored; a station outside the box is skipped), then
    /// `_removeOldData` at `now`.
    pub fn apply(&mut self, p: &Processed) {
        for (code, start, per_station) in &p.values {
            for ((station, _, _), values) in p.stations.iter().zip(per_station) {
                let Some(values) = values else {
                    continue;
                };
                for (f, value) in values.iter().enumerate() {
                    let Some(val) = *value else {
                        continue;
                    };
                    let wall = start + f as f64 * HOUR_MS;
                    let Some(data_time) = minute_text(wall) else {
                        continue;
                    };
                    // `new Date(dataTime + ':00+09:00')`: the KST hour as its instant.
                    self.upsert(Row {
                        station: station.clone(),
                        date: wall - 9. * HOUR_MS,
                        code,
                        val,
                        data_time,
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
    /// `_removeOldData` at `now`: rows dated before now - 1 day.
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
