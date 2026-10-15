//! S15b-3c AIR FORECAST: the GIF frames and the AirKorea image forecast rebuilt from raw GIFs
//! equal the pinned legacy oracle (`fixtures/air_forecast.json.gz`, see
//! `fixtures/AIR-FORECAST-PROVENANCE.md`): get-pixels 3.3.2 / omggif 1.0.9 frames, the legacy
//! master (#2757) `AirkoreaHourlyForecastController` with Mongoose 5.1.2 over the in-memory
//! collection double, and the #2757 image regression cases (`server/test/offline/
//! airkorea-image.test.js`) over their own synthetic pixels.
use super::source::{at, items_of, text};
use server2::domestic::kma::source::air_forecast::{
    CODES, Calibration, HourlyForecasts, Pixels, Processed, StationValues, decode_gif,
    decode_points, frame_start, image_shape_ok,
};
use server2::domestic::kma::source::gif::GifReader;
use server2::gateway::OrderedJson;
use std::collections::HashMap;
use std::{io::Read, sync::OnceLock};

pub const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/domestic/fixtures/air_forecast.json.gz"
);
pub fn oracle() -> &'static OrderedJson {
    static ORACLE: OnceLock<OrderedJson> = OnceLock::new();
    ORACLE.get_or_init(|| {
        let gz = std::fs::read(FIXTURE).unwrap();
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(&gz[..])
            .read_to_end(&mut raw)
            .unwrap();
        OrderedJson::parse(&raw).unwrap()
    })
}
pub fn base64(text: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}
fn sha256(bytes: &[u8]) -> String {
    server2::storage::sha256(bytes)
}

#[test]
fn gif_frames_equal_get_pixels() {
    let cases = items_of(at(oracle(), &["gif", "cases"]));
    assert_eq!(cases.len(), 9);
    for case in cases {
        let name = text(at(case, &["name"]));
        let bytes = base64(&text(at(case, &["gif"])));
        let reader = GifReader::new(&bytes).unwrap();
        let shape: Vec<f64> = items_of(at(case, &["shape"]))
            .iter()
            .map(|n| n.number().unwrap())
            .collect();
        assert_eq!(
            [reader.num_frames(), reader.width, reader.height],
            [shape[0] as usize, shape[1] as usize, shape[2] as usize],
            "{name}"
        );
        let expected: Vec<String> = items_of(at(case, &["frames"])).iter().map(text).collect();
        for (f, want) in expected.iter().enumerate() {
            let mut frame = vec![0u8; reader.width * reader.height * 4];
            reader.decode_and_blit_rgba(f, &mut frame).unwrap();
            assert_eq!(&sha256(&frame), want, "{name} frame {f}");
        }
    }
}

/// The oracle's stations `(name, lat, lon)`.
pub fn stations() -> Vec<(String, f64, f64)> {
    items_of(at(oracle(), &["forecast", "stations"]))
        .iter()
        .map(|s| {
            let s = items_of(s);
            (text(&s[0]), s[1].number().unwrap(), s[2].number().unwrap())
        })
        .collect()
}
/// The oracle's images.
pub fn images() -> &'static Vec<Vec<u8>> {
    static IMAGES: OnceLock<Vec<Vec<u8>>> = OnceLock::new();
    IMAGES.get_or_init(|| {
        items_of(at(oracle(), &["forecast", "images"]))
            .iter()
            .map(|g| base64(&text(g)))
            .collect()
    })
}
/// The oracle's image of a URL (None: the URL answers 404).
pub fn image_at(url: &str) -> Option<&'static [u8]> {
    let OrderedJson::Object(urls) = at(oracle(), &["forecast", "urls"]) else {
        panic!("urls");
    };
    urls.iter()
        .find(|(k, _)| String::from_utf16_lossy(k) == url)
        .map(|(_, i)| images()[i.number().unwrap() as usize].as_slice())
}
/// A 23-cycle image URL of the oracle (`YYYY/MM/DD`).
pub fn image_url(code: &str, day: &str) -> String {
    format!(
        "https://www.airkorea.or.kr/dustImage/{day}/23/09km/AQF.{}.NIER_09_01.{}.2days.ani.gif",
        day.replace('/', ""),
        if code == "pm25" { "PM2P5" } else { "PM10" }
    )
}
type Decoded = Vec<(&'static str, f64, StationValues)>;
/// Per code, the decoded values of every oracle station for an image URL pair (cached), or
/// None when `getDustImage` rejects the pair.
pub fn decoded(pm10: &str, pm25: &str) -> Option<Decoded> {
    type Cache = std::sync::Mutex<HashMap<(String, String), Option<Decoded>>>;
    static CACHE: OnceLock<Cache> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let key = (pm10.to_owned(), pm25.to_owned());
    if let Some(v) = cache.lock().unwrap().get(&key) {
        return v.clone();
    }
    let points: Vec<(f64, f64)> = stations().iter().map(|(_, a, b)| (*a, *b)).collect();
    let result = (|| {
        let starts = [
            frame_start(pm10, "PM10").ok()?,
            frame_start(pm25, "PM25").ok()?,
        ];
        let mut out = Vec::new();
        for (((code, kind, _), url), start) in CODES.iter().zip([pm10, pm25]).zip(starts) {
            let values =
                decode_gif(image_at(url)?, &Calibration::defaults(), kind, &points).ok()?;
            out.push((*code, start, values));
        }
        Some(out)
    })();
    cache.lock().unwrap().insert(key, result.clone());
    result
}

#[test]
fn hourly_forecast_rows_and_answers_equal_legacy() {
    let f = at(oracle(), &["forecast"]);
    let stations = stations();
    let announcements: Vec<(String, Option<String>, Option<String>)> =
        items_of(at(f, &["announcements"]))
            .iter()
            .map(|a| {
                let a = items_of(a);
                (text(&a[0]), a[1].string(), a[2].string())
            })
            .collect();
    let runs = items_of(at(f, &["runs"]));
    assert_eq!(runs.len(), 9);
    let mut fold = HourlyForecasts::default();
    for run in runs {
        let data_time = text(at(run, &["dataTime"]));
        let now = at(run, &["now"]).number().unwrap();
        let pub_date = format!("{}:00", &data_time[..13]);
        let legacy_error = at(run, &["error"]).string();
        // `_checkHourlyForecast`, `_getImgPaths`, `getDustImage` (both paths, both layouts).
        let processed = if fold.has(&pub_date) {
            None
        } else {
            match announcements.iter().find(|(d, _, _)| *d == data_time) {
                Some((_, Some(pm10), Some(pm25))) => Some(decoded(pm10, pm25)),
                _ => Some(None),
            }
        };
        match &processed {
            Some(Some(values)) => fold.apply(&Processed {
                pub_date: pub_date.clone(),
                now,
                stations: &stations,
                values: values.clone(),
            }),
            // A skip, or a run that failed: only `_removeOldData`.
            _ => fold.remove_old(now),
        }
        assert_eq!(
            legacy_error.is_some(),
            matches!(processed, Some(None)),
            "outcome of {data_time}: legacy {legacy_error:?}"
        );
        super::source::same(
            &fold.json(),
            at(run, &["docs"]),
            &format!("rows after {data_time}"),
        );
        for a in items_of(at(run, &["answers"])) {
            let name = text(at(a, &["stationName"]));
            super::source::same(
                &fold.by_station(&name),
                at(a, &["result"]),
                &format!("getForecast {name} after {data_time}"),
            );
        }
    }
}

// ---- the #2757 regression cases (server/test/offline/airkorea-image.test.js) ----

/// The characterized legend (`airkorea-image-harness.js` `nominal`, copied from legacy master
/// `91c77fcb`; sha256 in the fixture's `harness.source`).
const NOMINAL: [[i32; 3]; 36] = [
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
/// The harness's synthetic `pixels(options)`: the legend column at x 680, every other pixel one
/// colour (band 31 unless `band`), opaque everywhere.
#[derive(Default, Clone)]
struct Harness {
    shape: Option<Vec<usize>>,
    bad_legend: bool,
    palette_delta: Option<i32>,
    unknown: bool,
    band: Option<usize>,
    frame: usize,
}
impl Harness {
    fn from_json(v: &OrderedJson) -> Self {
        let num = |k: &str| v.get(k).and_then(OrderedJson::number);
        Self {
            shape: v.get("shape").map(|s| {
                items_of(s)
                    .iter()
                    .map(|n| n.number().unwrap() as usize)
                    .collect()
            }),
            bad_legend: v.get("badLegend").is_some(),
            palette_delta: num("paletteDelta").map(|d| d as i32),
            unknown: v.get("unknown").is_some(),
            band: num("band").map(|b| b as usize),
            frame: 0,
        }
    }
}
impl Pixels for Harness {
    fn shape(&self) -> Vec<usize> {
        self.shape.clone().unwrap_or(vec![48, 820, 820, 4])
    }
    fn select(&mut self, f: usize) -> Result<(), String> {
        self.frame = f;
        Ok(())
    }
    fn get(&self, x: usize, y: usize, c: usize) -> i32 {
        if c == 3 {
            return 255;
        }
        if x == 680 && (74..775).contains(&y) {
            let band = 35.min((y - 74) * 36 / 701);
            if self.bad_legend && self.frame == 47 && band == 10 {
                return 255;
            }
            let delta = match self.palette_delta {
                Some(d) if band == 21 && c == 1 => d,
                _ => 0,
            };
            return NOMINAL[band][c] + delta;
        }
        if self.unknown {
            return 0;
        }
        NOMINAL[self.band.unwrap_or(31)][c]
    }
}

/// Every #2757 regression case, run through the server2 decoder over the same synthetic pixels,
/// stores the rows legacy stored (or rejects as legacy did).
#[test]
fn the_legacy_image_regression_cases_store_the_same_rows() {
    let cases = items_of(at(oracle(), &["harness", "cases"]));
    assert_eq!(cases.len(), 29);
    let station = [("synthetic-seoul".to_owned(), 37.5665, 126.978)];
    for case in cases {
        let name = text(at(case, &["name"]));
        let setup = at(case, &["setup"]);
        let env: HashMap<String, String> = match setup.get("env") {
            Some(OrderedJson::Object(e)) => e
                .iter()
                .map(|(k, v)| (String::from_utf16_lossy(k), text(v)))
                .collect(),
            _ => HashMap::new(),
        };
        let calibration = Calibration::from_vars(&|n| env.get(n).cloned());
        if name == "explicit-calibration" {
            let map = at(case, &["map"]);
            let [left, right, _, _] = calibration.image_pos();
            let [_, _, left_lon, right_lon] = calibration.coordinate();
            let n = |k: &str| map.get(k).unwrap().number().unwrap();
            assert_eq!(left, n("left"));
            assert_eq!(left_lon, n("left_lon"));
            assert_eq!(right - left, n("map_width"));
            assert_eq!(
                (right_lon - left_lon) / (right - left),
                n("map_pixel_distance_width")
            );
            continue;
        }
        let pixels = setup
            .get("pixels")
            .map(Harness::from_json)
            .unwrap_or_default();
        let (pub_date, pm10, pm25) = match setup.get("paths") {
            Some(p) => (
                text(p.get("pubDate").unwrap()),
                p.get("pm10").map(text),
                p.get("pm25").map(text),
            ),
            None => (
                "2026-10-15 11:00".to_owned(),
                Some(image_url("pm10", "2026/10/14")),
                Some(image_url("pm25", "2026/10/14")),
            ),
        };
        // `getDustImage`: both paths through `frameStart`, then both images through the layout.
        let result = (|| -> Result<Decoded, String> {
            let urls = [
                pm10.clone().ok_or("missing")?,
                pm25.clone().ok_or("missing")?,
            ];
            let starts = [
                frame_start(&urls[0], "PM10")?,
                frame_start(&urls[1], "PM25")?,
            ];
            let points = [(station[0].1, station[0].2)];
            let mut out = Vec::new();
            for ((code, kind, _), start) in CODES.iter().zip(starts) {
                let values = decode_points(&mut pixels.clone(), &calibration, kind, &points)?;
                out.push((*code, start, values));
            }
            Ok(out)
        })();
        let mut fold = HourlyForecasts::default();
        match (&result, case.get("error")) {
            (Ok(values), None) => {
                // `hourly-do-twice`: the second `do` is skipped (`_checkHourlyForecast`).
                let runs = if name == "hourly-do-twice" { 2 } else { 1 };
                for _ in 0..runs {
                    if !fold.has(&pub_date) {
                        fold.apply(&Processed {
                            pub_date: pub_date.clone(),
                            // The harness removes nothing.
                            now: 0.,
                            stations: &station,
                            values: values.clone(),
                        });
                    }
                }
            }
            (Err(_), Some(_)) => {}
            (r, e) => panic!(
                "{name}: server2 {:?}, legacy {e:?}",
                r.as_ref().map(|_| "rows")
            ),
        }
        // The stored rows: `{stationName, date, code, val, dataTime, pubDate}` in write order.
        let OrderedJson::Array(rows) = fold.json() else {
            unreachable!()
        };
        let got: Vec<serde_json::Value> = rows
            .iter()
            .map(|r| {
                let v: serde_json::Value = serde_json::from_slice(&r.to_bytes()).unwrap();
                let ms = v["date"]["$date"].as_f64().unwrap();
                serde_json::json!({
                    "stationName": v["stationName"], "date": iso(ms), "code": v["code"],
                    "val": v["val"], "dataTime": v["dataTime"], "pubDate": v["pubDate"]
                })
            })
            .collect();
        let want: serde_json::Value =
            serde_json::from_slice(&at(case, &["stored"]).to_bytes()).unwrap();
        assert_eq!(serde_json::Value::Array(got), want, "{name}");
    }
}
fn iso(ms: f64) -> String {
    let p = server2::world::js::parts(ms).unwrap();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        p.year, p.month, p.day, p.hour, p.minute, p.second, p.milli
    )
}

/// The legacy `AIRKOREA_KOREA_IMAGE_*` names (master `config.js` L89-L105) with the characterized
/// defaults; an unset or empty value takes the default (`||`), a set value is read as legacy reads
/// it (`parseInt`/`parseFloat` for the map, `Number` for the layout checks).
#[test]
fn the_calibration_reads_the_legacy_names() {
    let defaults = Calibration::defaults();
    assert_eq!(defaults.image_pos(), [77., 663., 75., 794.]);
    assert_eq!(
        defaults.coordinate(),
        [39.3769, 32.6942, 123.9523, 130.6741]
    );
    assert!(defaults.canvas_ok(820, 820));
    assert_eq!(Calibration::from_vars(&|_| None), defaults);
    assert_eq!(Calibration::from_vars(&|_| Some(String::new())), defaults);
    let set = Calibration::from_vars(&|name| {
        Some(
            match name {
                "AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT" => "39.5x",
                "AIRKOREA_KOREA_IMAGE_MAP_LEFT" => "80px",
                "AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT" => "830",
                _ => return None,
            }
            .into(),
        )
    });
    assert_eq!(set.image_pos()[0], 80.);
    assert_eq!(set.coordinate()[0], 39.5);
    // Another size setting rejects the characterized canvas.
    assert!(!set.canvas_ok(820, 820) && !set.canvas_ok(820, 830));
}

/// A GIF file: an 820x820 screen with a two-colour palette and `frames` image descriptors of the
/// given size (one LZW sub-block each; never decoded here).
fn gif_with_frames(frames: usize, width: u16, height: u16) -> Vec<u8> {
    let mut g = b"GIF89a".to_vec();
    g.extend_from_slice(&820u16.to_le_bytes());
    g.extend_from_slice(&820u16.to_le_bytes());
    g.extend_from_slice(&[0x80, 0, 0, 0, 0, 0, 255, 255, 255]);
    for _ in 0..frames {
        g.push(0x2c);
        for v in [0u16, 0, width, height] {
            g.extend_from_slice(&v.to_le_bytes());
        }
        g.extend_from_slice(&[0, 2, 2, 0x44, 0x01, 0]);
    }
    g.push(0x3b);
    g
}

/// Review S15b3c-R1: frame descriptors are bounded before any buffer exists (legacy has no bound;
/// a hostile image would exhaust its memory). The characterized shape stays well inside.
#[test]
fn gifs_beyond_the_decoding_bounds_are_refused_before_allocation() {
    use server2::domestic::kma::source::gif::{MAX_FRAME_PIXELS, MAX_FRAMES, MAX_TOTAL_PIXELS};
    let live = gif_with_frames(48, 673, 795);
    assert_eq!(GifReader::new(&live).unwrap().num_frames(), 48);
    assert!(image_shape_ok(&live, &Calibration::defaults()));
    assert!(!image_shape_ok(
        &gif_with_frames(54, 673, 795),
        &Calibration::defaults()
    ));
    for (frames, width, height) in [
        (1, 65535, 65535),
        (1, 2049, 2048),
        (MAX_FRAMES + 1, 1, 1),
        (MAX_TOTAL_PIXELS / MAX_FRAME_PIXELS + 1, 2048, 2048),
    ] {
        let hostile = gif_with_frames(frames, width, height);
        assert!(
            GifReader::new(&hostile).is_err(),
            "{frames} x {width}x{height}"
        );
        assert!(!image_shape_ok(&hostile, &Calibration::defaults()));
        assert!(decode_gif(&hostile, &Calibration::defaults(), "PM10", &[(37.5, 127.)]).is_err());
    }
    // At the bounds.
    assert!(GifReader::new(&gif_with_frames(MAX_FRAMES, 1, 1)).is_ok());
    assert!(
        GifReader::new(&gif_with_frames(
            MAX_TOTAL_PIXELS / MAX_FRAME_PIXELS,
            2048,
            2048
        ))
        .is_ok()
    );
}
