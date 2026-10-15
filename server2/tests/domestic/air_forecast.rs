//! S15b-3c AIR FORECAST: the GIF frames and the AirKorea image forecast rebuilt from raw GIFs
//! equal the pinned legacy oracle (`fixtures/air_forecast.json.gz`, see
//! `fixtures/AIR-FORECAST-PROVENANCE.md`): get-pixels 3.3.2 / omggif 1.0.9 frames, and the legacy
//! `AirkoreaHourlyForecastController` with Mongoose 5.1.2 over the in-memory collection double.
use super::source::{at, items_of, text};
use server2::domestic::kma::source::air_forecast::{
    CODES, Calibration, HourlyForecasts, Processed, decode_points,
};
use server2::domestic::kma::source::gif::GifReader;
use server2::gateway::OrderedJson;
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
    assert_eq!(cases.len(), 7);
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
/// One image set's GIFs (`pm10`, `pm25`).
pub fn set_gifs(set: usize) -> [Vec<u8>; 2] {
    let s = &items_of(at(oracle(), &["forecast", "sets"]))[set];
    [
        base64(&text(at(s, &["pm10"]))),
        base64(&text(at(s, &["pm25"]))),
    ]
}
type Decoded = Vec<(&'static str, Vec<Option<Vec<f64>>>)>;
/// The decoded values of every station for one set (None outside the map box), decoded once.
pub fn decoded(set: usize) -> Decoded {
    static SETS: OnceLock<Vec<Decoded>> = OnceLock::new();
    SETS.get_or_init(|| (0..2).map(decode_set).collect())[set].clone()
}
fn decode_set(set: usize) -> Decoded {
    let stations = stations();
    let points: Vec<(f64, f64)> = stations.iter().map(|(_, lat, lon)| (*lat, *lon)).collect();
    let gifs = set_gifs(set);
    let c = Calibration::deployed();
    CODES
        .iter()
        .zip(gifs.iter())
        .map(|((code, table), gif)| {
            let per_station = decode_points(gif, &c, table, &points).unwrap();
            (*code, per_station)
        })
        .collect()
}

#[test]
fn hourly_forecast_rows_and_answers_equal_legacy() {
    let f = at(oracle(), &["forecast"]);
    let stations = stations();
    let announcements: Vec<(String, usize)> = items_of(at(f, &["announcements"]))
        .iter()
        .map(|a| {
            let a = items_of(a);
            (text(&a[0]), a[1].number().unwrap() as usize)
        })
        .collect();
    let mut fold = HourlyForecasts::default();
    for run in items_of(at(f, &["runs"])) {
        let data_time = text(at(run, &["dataTime"]));
        let now = at(run, &["now"]).number().unwrap();
        let pub_date = format!("{}:00", &data_time[..13]);
        match announcements.iter().find(|(d, _)| *d == data_time) {
            Some((_, set)) if !fold.has(&pub_date) => fold.apply(&Processed {
                pub_date: pub_date.clone(),
                now,
                stations: &stations,
                values: decoded(*set),
            }),
            // `_checkHourlyForecast` skip, or no forecast documents: only `_removeOldData`.
            _ => fold.remove_old(now),
        }
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
