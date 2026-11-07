//! Values of the EC2 parity run of 2026-11-07 (server2 master from an empty bucket against the
//! production API, same paths and times; bodies `body-0..4.json` and `prod-0..4.json` of the
//! ignored `reports/kma-ec2-20261107p/results/parity/`) through the ASOS-primary assembly. The
//! stored inputs of that run are not kept, so a store double serves what its bodies show at
//! 18:31 KST: the 17:00 publication's 18:00 forecast as production answered it, the station's
//! 18:28 live reading and its ASOS hour of 2026-11-06 18:00, which the server2 bodies carry.
use super::support::clock_ms;
use serde_json::{Value, json};
use server2::domestic::kma::{
    AssemblyConfig, DbVersion, KmaStore, MidModel, Outcome, StoreResult, TownModel, assemble,
    backend::parse_path,
};
use server2::domestic::publication::Publication;
use server2::gateway::OrderedJson;

/// A request moment of 2026-11-07 KST: its instant, the latest short publication (whose first
/// hour is the current slot), the minute of the live reading and an extreme the publication
/// forecasts for the current row.
struct Moment {
    now: &'static str,
    publication: u16,
    live: u16,
    extreme: Option<(&'static str, f64)>,
}
/// The first request of the run: 18:31:05 KST, the 17:00 publication, the 18:28 reading.
const PARITY: Moment = Moment {
    now: "2026-11-07T09:31:05.000Z",
    publication: 1700,
    live: 1828,
    extreme: None,
};

struct Place {
    name: &'static str,
    town: [&'static str; 3],
    station: u32,
    /// The live reading of 18:28 (`current.t1h`).
    live: f64,
    /// The station's ASOS temperature of 2026-11-06 18:00.
    yesterday: f64,
    /// The 17:00 publication's 18:00 forecast as production sent it.
    pop: f64,
    wav: f64,
}
const PLACES: [Place; 5] = [
    Place {
        name: "Seoul",
        town: ["서울특별시", "중구", "명동"],
        station: 108,
        live: 6.5,
        yesterday: 6.7,
        pop: 0.,
        wav: 0.,
    },
    Place {
        name: "Busan",
        town: ["부산광역시", "연제구", "연산5동"],
        station: 159,
        live: 10.8,
        yesterday: 13.4,
        pop: 0.,
        wav: 0.,
    },
    Place {
        name: "Gangneung",
        town: ["강원특별자치도", "강릉시", "홍제동"],
        station: 105,
        live: 6.6,
        yesterday: 9.9,
        pop: 0.,
        wav: 0.,
    },
    Place {
        name: "Jeju",
        town: ["제주특별자치도", "제주시", "이도2동"],
        station: 184,
        live: 12.4,
        yesterday: 13.8,
        pop: 0.,
        wav: 0.5,
    },
    Place {
        name: "Cheorwon",
        town: ["강원특별자치도", "철원군", "갈말읍"],
        station: 95,
        live: 4.7,
        yesterday: 5.6,
        pop: 0.,
        wav: 0.,
    },
];

/// UTC milliseconds of a KST wall-clock time.
fn kst(date: u32, time: u16) -> f64 {
    server2::history::schedule::to_ms(Publication::new(date, time).unwrap()) as f64
}
fn json_of(v: Value) -> StoreResult {
    Ok(OrderedJson::parse(&serde_json::to_vec(&v).unwrap()).unwrap())
}
/// A DB 2.0 grid document.
fn doc(data_key: &str, published: f64, at: (u32, u16), data: Value) -> Value {
    let mut data = data;
    data["date"] = json!(format!("{:08}", at.0));
    data["time"] = json!(format!("{:04}", at.1));
    json!({"mCoord": {"mx": 60, "my": 127}, "pubDate": {"$date": published},
        "fcsDate": {"$date": kst(at.0, at.1)}, data_key: data})
}

/// The inputs of one place at a moment: grid observations through its hour today (none for
/// yesterday, as on the empty bucket), the latest short publication, the live station page and,
/// unless legacy mode is asked for, the station's ASOS records of 2026-11-06.
struct ParityStore {
    place: &'static Place,
    at: &'static Moment,
    asos: bool,
}
impl ParityStore {
    fn town(&self) -> Value {
        let [first, second, third] = self.place.town;
        json!({"name": self.place.name, "town": {"first": first, "second": second, "third": third},
            "mCoord": {"mx": 60, "my": 127}, "gCoord": {"lat": 37.566, "lon": 126.978}})
    }
}
impl KmaStore for ParityStore {
    fn db_version(&self) -> DbVersion {
        DbVersion::V2
    }
    fn towns(&self) -> StoreResult {
        json_of(json!([self.town()]))
    }
    fn town(&self, _: &str, _: &str, _: &str) -> StoreResult {
        json_of(json!([self.town()]))
    }
    fn region_code(&self, _: &str, _: &str) -> StoreResult {
        json_of(json!({"pointNumber": "109", "cityCode": "11B10101"}))
    }
    fn town_model(&self, model: TownModel, _: &Value, _: &Value) -> StoreResult {
        let mut docs = Vec::new();
        match model {
            TownModel::Short => {
                let published = kst(20261107, self.at.publication);
                let first = self.at.publication / 100 + 1;
                let hours = (first..24)
                    .map(|h| (20261107, h * 100))
                    .chain((0..24).map(|h| (20261108, h * 100)));
                for at in hours {
                    let current = at == (20261107, first * 100);
                    let (pop, wav) = if current {
                        (self.place.pop, self.place.wav)
                    } else {
                        (0., 0.)
                    };
                    let mut data = json!({"pop": pop, "pty": 0, "r06": 0, "s06": 0, "reh": 40,
                        "sky": 1, "t3h": 6, "tmn": -50, "tmx": -50, "uuu": 1, "vvv": -0.2,
                        "wav": wav, "vec": 287, "wsd": 1});
                    if let (true, Some((field, value))) = (current, self.at.extreme) {
                        data[field] = json!(value);
                    }
                    docs.push(doc("shortData", published, at, data));
                }
            }
            TownModel::Current => {
                for h in 0..=self.at.live / 100 {
                    let at = (20261107, h * 100);
                    docs.push(doc(
                        "currentData",
                        kst(at.0, at.1),
                        at,
                        json!({"t1h": 6.9, "rn1": 0, "sky": 1, "uuu": 1, "vvv": -0.2,
                            "reh": 23, "pty": 0, "lgt": 0, "vec": 290, "wsd": 1.1}),
                    ));
                }
            }
            TownModel::Shortest | TownModel::ShortRss => {}
        }
        json_of(Value::Array(docs))
    }
    fn mid_model(&self, _: MidModel, _: &Value) -> StoreResult {
        json_of(json!([]))
    }
    fn forecast_zone(&self, _: &str, _: &str) -> StoreResult {
        json_of(json!([]))
    }
    fn stn_hourly_and_min_rns(&self, _: &Value, _: &str, _: &Value) -> StoreResult {
        let (hour, minute) = (self.at.live / 100, self.at.live % 100);
        json_of(
            json!({"t1h": self.place.live, "vec": 279.9, "wsd": 1.3, "reh": 25, "rs1h": 0,
            "rns": false, "stnDateTime": format!("2026.11.07.{hour:02}:{minute:02}"),
            "stnId": self.place.station}),
        )
    }
    fn city_hourly(&self, _: &Value) -> StoreResult {
        json_of(json!([]))
    }
    fn history(&self, _: &Value) -> StoreResult {
        if !self.asos {
            // Legacy mode: ASOS history reads disabled.
            return Ok(OrderedJson::Null);
        }
        let station = self.place.station.to_string();
        let hourly: Vec<Value> = (0..24)
            .map(|h| {
                json!({"source": "KMA_ASOS", "kind": "hourly", "timeBasis": "UTC",
                    "stationId": station, "key": format!("20261106{h:02}00"),
                    "values": {"t1h": self.place.yesterday, "reh": 40, "sky": 1, "pty": 0,
                        "rn1": 0, "wsd": 1, "vec": 180}})
            })
            .collect();
        json_of(json!({"policy": "asos-primary-v1", "startDate": "20261031",
            "endDate": "20261106", "hourly": hourly,
            "daily": [{"source": "KMA_ASOS", "kind": "daily", "timeBasis": "UTC",
                "stationId": station, "key": "20261106",
                "values": {"taMin": self.place.yesterday, "taMax": self.place.yesterday,
                    "t1d": self.place.yesterday, "rn1": 0, "reh": 40, "wsd": 1}}]}))
    }
    fn area_no(&self, _: &str, _: &str, _: &str) -> StoreResult {
        json_of(json!([]))
    }
    fn area_no_near(&self, _: &Value) -> StoreResult {
        json_of(json!([]))
    }
    fn life_index(&self, _: f64) -> StoreResult {
        json_of(json!([]))
    }
    fn food_poisoning(&self, _: &str, _: &str, _: &str, _: &str) -> StoreResult {
        json_of(json!([]))
    }
    fn arpltn(&self, _: &Value, _: f64) -> StoreResult {
        json_of(json!({"arpltn": {}, "list": [], "stnList": []}))
    }
    fn dust_forecast(&self, _: &str, _: &str, _: &str) -> StoreResult {
        json_of(json!([]))
    }
    fn air_fallback(&self, _: &Value, _: f64) -> StoreResult {
        json_of(Value::Null)
    }
    fn air_forecast(&self, _: &str, _: &Value) -> StoreResult {
        json_of(json!([]))
    }
    fn rise_set(&self, _: &Value, _: &[String]) -> StoreResult {
        json_of(json!([]))
    }
    fn special_zones(&self, _: &[String]) -> StoreResult {
        json_of(json!([]))
    }
    fn as_of_ms(&self) -> Option<f64> {
        Some(clock_ms(self.at.now))
    }
}
/// `encodeURIComponent` of the non-ASCII town names.
fn encoded(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii() {
                c.to_string()
            } else {
                let mut buf = [0; 4];
                c.encode_utf8(&mut buf)
                    .bytes()
                    .map(|b| format!("%{b:02X}"))
                    .collect()
            }
        })
        .collect()
}
fn answered(place: &'static Place, at: &'static Moment, asos: bool) -> Value {
    let [first, second, third] = place.town;
    let path = format!(
        "/v000903/kma/addr/{}/{}/{}",
        encoded(first),
        encoded(second),
        encoded(third)
    );
    let request = parse_path(&path, "").unwrap();
    let store = ParityStore { place, at, asos };
    let out = assemble(
        &request,
        &store,
        clock_ms(at.now),
        AssemblyConfig::default(),
    );
    let Outcome::Json(body) = out else {
        panic!("{}: assembly failed: {out:?}", place.name)
    };
    serde_json::from_slice(&body.to_bytes()).unwrap()
}

/// The 18:00 row is the current one at 18:31 (CURRENT-ROW): it keeps the 17:00 publication's
/// probability, wave height and snow amount as production sent them (the run's server2 answer
/// sent -1, -1 and -10 or nothing).
#[test]
fn the_current_row_of_the_parity_run_keeps_its_forecast() {
    for place in &PLACES {
        let body = answered(place, &PARITY, true);
        let row = body["short"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["date"] == "20261107" && r["time"] == 18)
            .unwrap_or_else(|| panic!("{}: no 18:00 row", place.name));
        assert_eq!(row["currentIndex"], true, "{}: {row}", place.name);
        assert_eq!(row["pop"], place.pop, "{}: {row}", place.name);
        assert_eq!(row["wav"], place.wav, "{}: {row}", place.name);
        assert_eq!(row["s06"], 0, "{}: {row}", place.name);
    }
}

/// The current row also keeps its publication's daily extreme where legacy does
/// (`_mergeShortWithCurrent`): today's 06:00 `tmn` is the lower of the forecast and the observed
/// minimum, today's 15:00 `tmx` the higher, and `adjustShort` places the day's extreme on one row.
/// The run had no current 06:00 or 15:00 row, so these moments take Seoul's inputs at 06:31 and
/// 15:31 with a forecast extreme beyond every temperature of the day.
#[test]
fn the_current_row_keeps_its_forecast_extreme_where_legacy_does() {
    const MORNING: Moment = Moment {
        now: "2026-11-06T21:31:05.000Z",
        publication: 500,
        live: 628,
        extreme: Some(("tmn", 0.)),
    };
    const AFTERNOON: Moment = Moment {
        now: "2026-11-07T06:31:05.000Z",
        publication: 1400,
        live: 1528,
        extreme: Some(("tmx", 12.)),
    };
    for at in [&MORNING, &AFTERNOON] {
        let (field, value) = at.extreme.unwrap();
        let shown = |asos| {
            answered(&PLACES[0], at, asos)["short"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["date"] == "20261107" && r[field] == value)
                .count()
        };
        assert_eq!(shown(false), 1, "legacy places today's {field} {value}");
        assert_eq!(shown(true), 1, "ASOS-primary keeps today's {field} {value}");
    }
}

/// The live reading of station X now and X's ASOS hour exactly 24 h earlier are one thermometer
/// (YESTERDAY): production sent `yesterday.t1h` for all five places, the run's server2 none.
#[test]
fn the_parity_run_places_get_yesterdays_temperature() {
    for place in &PLACES {
        let body = answered(place, &PARITY, true);
        let current = &body["current"];
        assert_eq!(current["t1h"], place.live, "{}: {current}", place.name);
        let yesterday = &current["yesterday"];
        assert_eq!(
            yesterday["comparisonAvailable"], true,
            "{}: {yesterday}",
            place.name
        );
        assert_eq!(yesterday["t1h"], place.yesterday, "{}", place.name);
    }
}
