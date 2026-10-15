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
    // `[dataTime, set, pm10 state, pm25 state]`: `image`, `absent` (no URL), `nodoc` (no document)
    // or `broken` (an image get-pixels cannot read).
    let announcements: Vec<(String, usize, [String; 2])> = items_of(at(f, &["announcements"]))
        .iter()
        .map(|a| {
            let a = items_of(a);
            (
                text(&a[0]),
                a[1].number().unwrap() as usize,
                [text(&a[2]), text(&a[3])],
            )
        })
        .collect();
    assert_eq!(announcements.len(), 6);
    let mut fold = HourlyForecasts::default();
    for run in items_of(at(f, &["runs"])) {
        let data_time = text(at(run, &["dataTime"]));
        let now = at(run, &["now"]).number().unwrap();
        let pub_date = format!("{}:00", &data_time[..13]);
        match announcements.iter().find(|(d, _, _)| *d == data_time) {
            // A broken image fails `getDustImage`: nothing is stored.
            Some((_, set, states))
                if !fold.has(&pub_date) && !states.contains(&"broken".into()) =>
            {
                // A pollutant without an image is skipped; the other one is stored.
                let values = decoded(*set)
                    .into_iter()
                    .zip(states)
                    .filter(|(_, state)| *state == "image")
                    .map(|(v, _)| v)
                    .collect();
                fold.apply(&Processed {
                    pub_date: pub_date.clone(),
                    now,
                    stations: &stations,
                    values,
                })
            }
            // `_checkHourlyForecast` skip, a broken image, or no forecast documents: only
            // `_removeOldData`.
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

/// The legacy `AIRKOREA_KOREA_IMAGE_*` names (`config.js` L89-L105) with the deployed values as
/// defaults: `parseFloat` / `parseInt` of a set value, an empty value is unset.
#[test]
fn the_calibration_reads_the_legacy_names() {
    let deployed = Calibration::deployed();
    assert_eq!(
        [
            deployed.top_lat,
            deployed.bottom_lat,
            deployed.left_lon,
            deployed.right_lon
        ],
        [39.3769, 32.6942, 123.9523, 130.6741]
    );
    assert_eq!(
        [
            deployed.width,
            deployed.height,
            deployed.left,
            deployed.right,
            deployed.top,
            deployed.bottom
        ],
        [820., 820., 78., 663., 80., 798.]
    );
    let none = Calibration::from_vars(&|_| None);
    assert_eq!(none, deployed);
    let empty = Calibration::from_vars(&|_| Some(String::new()));
    assert_eq!(empty, deployed);
    let set = Calibration::from_vars(&|name| {
        Some(
            match name {
                "AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT" => "39.5x",
                "AIRKOREA_KOREA_IMAGE_COORDI_BOTTOM_LAT" => "32.5",
                "AIRKOREA_KOREA_IMAGE_COORDI_LEFT_LON" => "124",
                "AIRKOREA_KOREA_IMAGE_COORDI_RIGHT_LON" => "131.25",
                "AIRKOREA_KOREA_IMAGE_SIZE_WIDTH" => "830px",
                "AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT" => "830.9",
                "AIRKOREA_KOREA_IMAGE_MAP_LEFT" => "76",
                "AIRKOREA_KOREA_IMAGE_MAP_RIGHT" => "abc",
                "AIRKOREA_KOREA_IMAGE_MAP_TOP" => "73",
                "AIRKOREA_KOREA_IMAGE_MAP_BOTTOM" => "794",
                other => panic!("{other}"),
            }
            .into(),
        )
    });
    assert_eq!(
        [set.top_lat, set.bottom_lat, set.left_lon, set.right_lon],
        [39.5, 32.5, 124., 131.25]
    );
    assert_eq!(
        [set.width, set.height, set.left, set.top, set.bottom],
        [830., 830., 76., 73., 794.]
    );
    assert!(set.right.is_nan());
    assert!(set.valid_size(830, 830) && !set.valid_size(820, 820));
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
/// a hostile image would exhaust its memory). The live forecast shape stays well inside.
#[test]
fn gifs_beyond_the_decoding_bounds_are_refused_before_allocation() {
    use server2::domestic::kma::source::gif::{MAX_FRAME_PIXELS, MAX_FRAMES, MAX_TOTAL_PIXELS};
    let live = gif_with_frames(54, 673, 795);
    assert_eq!(GifReader::new(&live).unwrap().num_frames(), 54);
    assert!(server2::domestic::airkorea_image::valid_image(
        &live,
        (820, 820)
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
        assert!(!server2::domestic::airkorea_image::valid_image(
            &hostile,
            (820, 820)
        ));
        assert!(
            decode_points(
                &hostile,
                &Calibration::deployed(),
                CODES[0].1,
                &[(37.5, 127.)]
            )
            .is_err()
        );
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
