//! DB 2.0 grid documents (`kma.town.current`, `kma.town.shortest`, `kma.town.short`) rebuilt from
//! captured `ultra-srt-ncst`, `ultra-srt-fcst` and `vilage-fcst` acquisitions with the legacy
//! collector at master: `collectTownForecast` organizers and `_emitOrganizedData`,
//! `forecastGridCollection` (`rawItems`, `within`, `batch`, `complete`, `canonical`), the
//! `kma.town.*.controller` savers (current merge, fenced forecast writes) and the 216-hour
//! retention. Documents are derived in memory per request; nothing derived is stored.
use super::doc::{Doc, Row, Tmpl, Val, strict};
use super::items::Item;
use crate::domestic::kma::js::{V, parse_int, round};
use crate::domestic::kma::precip;
use crate::world::js::{parse_float, string_to_number};

const HOUR: f64 = 3_600_000.;
const DAY: f64 = 24. * HOUR;
/// Retention window of every grid collection (`getPast8DaysTime`).
pub const RETENTION_MS: f64 = 216. * HOUR;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Family {
    Current,
    Shortest,
    Short,
}
impl Family {
    pub fn data_key(self) -> &'static str {
        match self {
            Self::Current => "currentData",
            Self::Shortest => "shortestData",
            Self::Short => "shortData",
        }
    }
    fn schema(self) -> &'static [&'static str] {
        match self {
            Self::Current => &[
                "date", "time", "mx", "my", "t1h", "rn1", "sky", "uuu", "vvv", "reh", "pty", "lgt",
                "vec", "wsd",
            ],
            Self::Shortest => &[
                "date", "time", "mx", "my", "pty", "rn1", "rn1Text", "sky", "lgt", "pop", "t1h",
                "reh", "uuu", "vvv", "vec", "wsd",
            ],
            Self::Short => &[
                "date", "time", "mx", "my", "pop", "pty", "r06", "r06Text", "reh", "s06",
                "s06Text", "sky", "t3h", "tmn", "tmx", "uuu", "vvv", "wav", "vec", "wsd",
            ],
        }
    }
}

const CURRENT_TEMPLATE: &[(&str, Tmpl)] = &[
    ("pubDate", Tmpl::Str("")),
    ("date", Tmpl::Str("")),
    ("time", Tmpl::Str("")),
    ("mx", Tmpl::Num(-1.)),
    ("my", Tmpl::Num(-1.)),
    ("t1h", Tmpl::Num(-50.)),
    ("rn1", Tmpl::Num(-1.)),
    ("sky", Tmpl::Num(-1.)),
    ("uuu", Tmpl::Num(-100.)),
    ("vvv", Tmpl::Num(-100.)),
    ("reh", Tmpl::Num(-1.)),
    ("pty", Tmpl::Num(-1.)),
    ("lgt", Tmpl::Num(-1.)),
    ("vec", Tmpl::Num(-1.)),
    ("wsd", Tmpl::Num(-1.)),
];
const SHORTEST_TEMPLATE: &[(&str, Tmpl)] = &[
    ("pubDate", Tmpl::Str("")),
    ("date", Tmpl::Str("")),
    ("time", Tmpl::Str("")),
    ("mx", Tmpl::Num(-1.)),
    ("my", Tmpl::Num(-1.)),
    ("pty", Tmpl::Num(-1.)),
    ("rn1", Tmpl::Num(-1.)),
    ("sky", Tmpl::Num(-1.)),
    ("lgt", Tmpl::Num(-1.)),
    ("pop", Tmpl::Num(-1.)),
    ("t1h", Tmpl::Num(-50.)),
    ("reh", Tmpl::Num(-1.)),
    ("uuu", Tmpl::Num(-100.)),
    ("vvv", Tmpl::Num(-100.)),
    ("vec", Tmpl::Num(-1.)),
    ("wsd", Tmpl::Num(-1.)),
];
const SHORT_TEMPLATE: &[(&str, Tmpl)] = &[
    ("pubDate", Tmpl::Str("")),
    ("date", Tmpl::Str("")),
    ("time", Tmpl::Str("")),
    ("mx", Tmpl::Num(-1.)),
    ("my", Tmpl::Num(-1.)),
    ("pop", Tmpl::Num(-1.)),
    ("pty", Tmpl::Num(-1.)),
    ("r06", Tmpl::Num(-1.)),
    ("reh", Tmpl::Num(-1.)),
    ("s06", Tmpl::Num(-1.)),
    ("sky", Tmpl::Num(-1.)),
    ("t3h", Tmpl::Num(-50.)),
    ("tmn", Tmpl::Num(-50.)),
    ("tmx", Tmpl::Num(-50.)),
    ("uuu", Tmpl::Num(-100.)),
    ("vvv", Tmpl::Num(-100.)),
    ("wav", Tmpl::Num(-1.)),
    ("vec", Tmpl::Num(-1.)),
    ("wsd", Tmpl::Num(-1.)),
];

/// A publication slot as legacy requests it (`{date: 'YYYYMMDD', time: 'HHMM'}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Slot {
    pub date: String,
    pub time: String,
}
impl Slot {
    pub fn new(date: &str, time: &str) -> Self {
        Self {
            date: date.into(),
            time: time.into(),
        }
    }
    fn key(&self) -> String {
        format!("{}{}", self.date, self.time)
    }
}
/// The grid a legacy collection requested (`srcList[index]`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coord {
    pub mx: f64,
    pub my: f64,
}

/// `stamp(slot)`: KST wall clock as UTC components; NaN for a malformed slot.
fn stamp(date: &str, time: &str) -> f64 {
    let ok = date.len() == 8
        && date.bytes().all(|b| b.is_ascii_digit())
        && time.len() == 4
        && time.bytes().all(|b| b.is_ascii_digit());
    if !ok {
        return f64::NAN;
    }
    let n = |s: &str| s.parse::<f64>().unwrap_or(f64::NAN);
    let (h, mi) = (n(&time[..2]), n(&time[2..]));
    if h > 23. || mi > 59. {
        return f64::NAN;
    }
    crate::domestic::kma::time::make_date_literal(
        n(&date[..4]),
        n(&date[4..6]) - 1.,
        n(&date[6..8]),
        h,
        mi,
        0.,
    )
}
/// `parts(t)`: {date, time HH00}.
fn parts(t: f64) -> (String, String) {
    let p = crate::world::js::parts(t).expect("bounded slot time");
    (
        format!("{:04}{:02}{:02}", p.year, p.month, p.day),
        format!("{:02}00", p.hour),
    )
}
/// `expected(product, slot)`.
fn expected(family: Family, slot: &Slot) -> Option<Vec<(String, String)>> {
    let base = stamp(&slot.date, &slot.time);
    if !base.is_finite() {
        return None;
    }
    let start = (base / HOUR).floor() * HOUR;
    let mut times = Vec::new();
    match family {
        Family::Shortest => {
            for i in 1..=6 {
                times.push(start + f64::from(i) * HOUR);
            }
        }
        Family::Short => {
            let midnight = (start / DAY).floor() * DAY;
            let hour: f64 = slot.time[..2].parse().ok()?;
            let extension = midnight + if hour >= 17. { 4. } else { 3. } * DAY;
            let mut t = start + HOUR;
            while t < extension {
                times.push(t);
                t += HOUR;
            }
            let mut t = extension;
            while t < extension + DAY {
                times.push(t);
                t += 3. * HOUR;
            }
        }
        Family::Current => return None,
    }
    Some(times.into_iter().map(parts).collect())
}
/// `finite(value)`.
fn finite(v: Option<&Val>) -> bool {
    matches!(v, Some(Val::Num(n)) if n.is_finite() && *n > -900. && *n < 900.)
}
/// One `RULES` entry: (ne, gte, lte).
fn rule(field: &str) -> (Option<f64>, Option<f64>, Option<f64>) {
    match field {
        "t3h" | "t1h" => (Some(-50.), Some(-100.), None),
        "sky" => (None, Some(1.), Some(4.)),
        "reh" => (None, Some(0.), Some(100.)),
        "pty" => (None, Some(0.), Some(8.)),
        "uuu" | "vvv" => (Some(-100.), None, None),
        "vec" => (None, Some(0.), Some(360.)),
        "wsd" | "r06" | "s06" | "rn1" => (None, Some(0.), None),
        "pop" => (None, Some(0.), Some(100.)),
        "tmn" | "tmx" => (Some(-50.), None, None),
        _ => (None, None, None),
    }
}
fn accepts(field: &str, v: Option<&Val>) -> bool {
    let (ne, gte, lte) = rule(field);
    let n = v.and_then(Val::as_num).unwrap_or(f64::NAN);
    finite(v)
        && ne.is_none_or(|x| n != x)
        && gte.is_none_or(|x| n >= x)
        && lte.is_none_or(|x| n <= x)
}
fn fields(family: Family, at: &(String, String), slot: &Slot) -> Vec<&'static str> {
    let short = family == Family::Short;
    let mut list = vec![
        if short { "t3h" } else { "t1h" },
        "sky",
        "reh",
        "pty",
        "uuu",
        "vvv",
        "vec",
        "wsd",
    ];
    if short {
        list.extend(["r06", "s06"]);
    } else {
        list.push("rn1");
    }
    if short || slot.key().as_str() >= "202606231100" {
        list.push("pop");
    }
    if family == Family::Shortest {
        list.push("lgt");
    }
    if short && at.1 == "0600" && (at.0 != slot.date || slot.time == "0200") {
        list.push("tmn");
    }
    if short && at.1 == "1500" && (at.0 != slot.date || slot.time.as_str() <= "1100") {
        list.push("tmx");
    }
    list
}
fn valid(row: &Row, family: Family, at: &(String, String), slot: &Slot) -> bool {
    row.get("date").as_ref().and_then(Val::as_str) == Some(at.0.as_str())
        && row.get("time").as_ref().and_then(Val::as_str) == Some(at.1.as_str())
        && fields(family, at, slot)
            .into_iter()
            .all(|f| accepts(f, row.get(f).as_ref()))
}
/// `identities(product, slot)`.
fn identities(family: Family, slot: &Slot) -> Vec<String> {
    let exact = slot.key();
    if family == Family::Shortest && &slot.time[2..] != "00" {
        vec![format!("{}{}00", slot.date, &slot.time[..2]), exact]
    } else {
        vec![exact]
    }
}
/// `canonical(product, pub)`.
fn canonical(family: Family, publication: &str) -> String {
    if family == Family::Shortest
        && publication.len() == 12
        && publication.bytes().all(|b| b.is_ascii_digit())
    {
        format!("{}00", &publication[..10])
    } else {
        publication.to_owned()
    }
}
fn row_at(row: &Row) -> String {
    row.text("date") + &row.text("time")
}
/// `trailing(product, slot, row)`.
fn trailing(family: Family, slot: &Slot, row: &Row, times: &[(String, String)]) -> bool {
    let Some(last) = times.last() else {
        return false;
    };
    let last = stamp(&last.0, &last.1);
    let at = stamp(&row.text("date"), &row.text("time"));
    at > last && at <= last + DAY && valid(row, family, &(row.text("date"), row.text("time")), slot)
}
fn complete(family: Family, slot: &Slot, rows: &[Row], times: &[(String, String)]) -> bool {
    times.iter().all(|at| {
        let key = format!("{}{}", at.0, at.1);
        let found: Vec<&Row> = rows.iter().filter(|r| row_at(r) == key).collect();
        !found.is_empty() && found.iter().all(|r| valid(r, family, at, slot))
    })
}
/// `rawItems(items, product, slot, coord)`.
fn raw_items(items: &[Item], family: Family, slot: &Slot, coord: Coord) -> bool {
    let Some(times) = expected(family, slot) else {
        return false;
    };
    let numbers: &[&str] = if family == Family::Short {
        &[
            "TMP", "T3H", "SKY", "REH", "PTY", "POP", "UUU", "VVV", "VEC", "WSD", "TMN", "TMX",
        ]
    } else {
        &[
            "T1H", "SKY", "REH", "PTY", "POP", "UUU", "VVV", "VEC", "WSD", "LGT",
        ]
    };
    let allowed: Vec<String> = times.iter().map(|t| format!("{}{}", t.0, t.1)).collect();
    let last = times.last().map_or(f64::NAN, |t| stamp(&t.0, &t.1));
    let ids = identities(family, slot);
    let mut echoed: Option<String> = None;
    let mut slots: std::collections::HashMap<String, std::collections::HashSet<String>> =
        std::collections::HashMap::new();
    let value = |item: &Item, k: &str| item.get(k).map(str::to_owned);
    for item in items {
        // `value(item, 'baseDate') + value(item, 'baseTime')` (undefined prints as text).
        let part = |k| value(item, k).unwrap_or_else(|| "undefined".into());
        let publication = part("baseDate") + &part("baseTime");
        let echo = echoed.get_or_insert_with(|| publication.clone()).clone();
        if !ids.contains(&publication)
            || publication != echo
            || Some(crate::gateway::response::js_number(coord.mx)) != value(item, "nx")
            || Some(crate::gateway::response::js_number(coord.my)) != value(item, "ny")
        {
            return false;
        }
        let category = value(item, "category").unwrap_or_else(|| "undefined".into());
        let at = part("fcstDate") + &part("fcstTime");
        if !allowed.contains(&at) {
            let t = stamp(&part("fcstDate"), &part("fcstTime"));
            if !(t > last && t <= last + DAY) {
                continue;
            }
        } else {
            slots.entry(at).or_default().insert(category.clone());
        }
        let text = value(item, "fcstValue");
        if numbers.contains(&category.as_str()) {
            let Some(text) = text else { return false };
            let t = text.trim_matches(precip::js_ws);
            if !plain_number(t) || !finite(Some(&Val::Num(string_to_number(&text)))) {
                return false;
            }
        } else if ["PCP", "SNO", "RN1", "R06", "S06"].contains(&category.as_str()) {
            let snow = category == "SNO" || category == "S06";
            let v = text.map_or(V::Undef, |t| V::s(&t));
            if precip::parse(
                &v,
                if snow { "cm" } else { "mm" },
                Some(if snow { "적설없음" } else { "강수없음" }),
            )
            .is_none()
            {
                return false;
            }
        }
    }
    times.iter().all(|at| {
        let Some(categories) = slots.get(&format!("{}{}", at.0, at.1)) else {
            return false;
        };
        let has = |c: &str| categories.contains(c);
        let mut required = vec!["SKY", "REH", "PTY", "UUU", "VVV", "VEC", "WSD"];
        if family == Family::Short {
            required.push("POP");
            if at.1 == "0600" && (at.0 != slot.date || slot.time == "0200") {
                required.push("TMN");
            }
            if at.1 == "1500" && (at.0 != slot.date || slot.time.as_str() <= "1100") {
                required.push("TMX");
            }
            if !(has("TMP") || has("T3H"))
                || !(has("PCP") || has("R06"))
                || !(has("SNO") || has("S06"))
            {
                return false;
            }
        } else {
            required.extend(["T1H", "RN1", "LGT"]);
            if slot.key().as_str() >= "202606231100" {
                required.push("POP");
            }
        }
        required.into_iter().all(has)
    })
}
/// `/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/`.
fn plain_number(t: &str) -> bool {
    let t = t.strip_prefix(['+', '-']).unwrap_or(t);
    match t.split_once('.') {
        Some((a, b)) => {
            (!a.is_empty()
                && a.bytes().all(|c| c.is_ascii_digit())
                && b.bytes().all(|c| c.is_ascii_digit()))
                || (a.is_empty() && !b.is_empty() && b.bytes().all(|c| c.is_ascii_digit()))
        }
        None => !t.is_empty() && t.bytes().all(|c| c.is_ascii_digit()),
    }
}
/// `parseMeasurement(value, missing, unit, noValue)` (only the forms the organizers use).
fn parse_measurement(value: &str, missing: f64) -> f64 {
    let text = value.trim_matches(precip::js_ws);
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let ok = match unsigned.split_once('.') {
        Some((a, b)) => {
            (!a.is_empty()
                && !b.is_empty()
                && a.bytes().all(|c| c.is_ascii_digit())
                && b.bytes().all(|c| c.is_ascii_digit()))
                || (a.is_empty() && !b.is_empty() && b.bytes().all(|c| c.is_ascii_digit()))
        }
        None => !unsigned.is_empty() && unsigned.bytes().all(|c| c.is_ascii_digit()),
    };
    if !ok {
        return missing;
    }
    let n = string_to_number(text);
    if n.is_finite() { n } else { missing }
}
fn parse_percent(value: &str) -> f64 {
    let n = parse_measurement(value, -1.);
    if (0. ..=100.).contains(&n) {
        round(n)
    } else {
        -1.
    }
}
/// `setPrecipitation(result, field, value, unit, noValue)`.
fn set_precipitation(row: &mut Row, field: &str, value: &str, unit: &str, no_value: &str) {
    let parsed = precip::parse(&V::s(value), unit, Some(no_value));
    row.set(field, Val::Num(parsed.as_ref().map_or(-1., |p| p.amount)));
    let text_field = format!("{field}Text");
    if parsed.is_some_and(|p| p.approx) {
        row.set(&text_field, Val::str(value.trim_matches(precip::js_ws)));
    } else {
        row.delete(&text_field);
    }
}
fn num(v: f64) -> Val {
    Val::Num(v)
}
/// `_createOrFindResult(list, template, date, time)`.
fn find_or_create<'a>(
    list: &'a mut Vec<Row>,
    template: &'static [(&'static str, Tmpl)],
    date: &str,
    time: &str,
) -> &'a mut Row {
    let i = list
        .iter()
        .position(|r| {
            r.get("date").as_ref().and_then(Val::as_str) == Some(date)
                && r.get("time").as_ref().and_then(Val::as_str) == Some(time)
        })
        .unwrap_or_else(|| {
            list.push(Row::new(template));
            list.len() - 1
        });
    &mut list[i]
}
/// `_emitOrganizedData(index, records, required)`.
fn emit(records: Vec<Row>, required: &[(&str, f64, f64)]) -> Option<Vec<Row>> {
    let invalid = records.is_empty()
        || records.iter().any(|r| {
            r.materialized().entries().iter().any(|(k, v)| {
                (k.starts_with("wf")
                    && !matches!(v, Val::Str(s) if !s.trim_matches(precip::js_ws).is_empty()))
                    || matches!(v, Val::Num(n) if !n.is_finite())
            }) || required
                .iter()
                .any(|(name, missing, min)| match r.get(name) {
                    Some(Val::Num(n)) => n == *missing || n < *min,
                    _ => true,
                })
        });
    (!invalid).then_some(records)
}
fn sort_rows(rows: &mut [Row]) {
    // `_sortByDateTime` with V8's stable sort.
    rows.sort_by_key(|r| (r.text("date"), r.text("time")));
}

/// The organizer of one acquisition; None when legacy fails it (`recvFail`).
fn organize(family: Family, items: &[Item]) -> Option<Vec<Row>> {
    let template = match family {
        Family::Current => CURRENT_TEMPLATE,
        Family::Shortest => SHORTEST_TEMPLATE,
        Family::Short => SHORT_TEMPLATE,
    };
    let mut list: Vec<Row> = Vec::new();
    let (date_key, time_key, value_key) = match family {
        Family::Current => ("baseDate", "baseTime", "obsrValue"),
        _ => ("fcstDate", "fcstTime", "fcstValue"),
    };
    for item in items {
        if item.get(date_key).is_none()
            && item.get(time_key).is_none()
            && item.get(value_key).is_none()
        {
            continue;
        }
        // A missing field read is a TypeError caught by the organizer: the grid fails.
        let date = item.get(date_key)?;
        let time = item.get(time_key)?;
        if date.encode_utf16().count() <= 1 || time.encode_utf16().count() <= 1 {
            continue;
        }
        let publication = format!("{}{}", item.get("baseDate")?, item.get("baseTime")?);
        let mx = parse_int(&V::s(item.get("nx")?));
        let my = parse_int(&V::s(item.get("ny")?));
        let category = item.get("category")?;
        let row = find_or_create(&mut list, template, date, time);
        row.set("pubDate", Val::str(publication));
        row.set("date", Val::str(date));
        row.set("time", Val::str(time));
        row.set("mx", num(mx));
        row.set("my", num(my));
        let raw = item.get(value_key);
        let value = || raw.map_or(f64::NAN, parse_float);
        match family {
            Family::Current => {
                let field = match category {
                    "T1H" => "t1h",
                    "RN1" => "rn1",
                    "SKY" => "sky",
                    "UUU" => "uuu",
                    "VVV" => "vvv",
                    "REH" => "reh",
                    "PTY" => "pty",
                    "LGT" => "lgt",
                    "VEC" => "vec",
                    "WSD" => "wsd",
                    _ => continue,
                };
                // `parseFloat(item.obsrValue[0])`: a missing value is a TypeError.
                raw?;
                row.set(field, num(value()));
            }
            Family::Shortest => {
                let raw_text = raw.unwrap_or("");
                match category {
                    "RN1" => set_precipitation(row, "rn1", raw_text, "mm", "강수없음"),
                    "POP" => row.set("pop", num(parse_percent(raw_text))),
                    "PTY" | "SKY" | "LGT" | "T1H" | "REH" | "UUU" | "VVV" | "VEC" | "WSD" => {
                        row.set(&category.to_ascii_lowercase(), num(value()))
                    }
                    _ => (),
                }
            }
            Family::Short => {
                // Every matched category reads `item.fcstValue[0]` (a TypeError when absent).
                let field = match category {
                    "POP" | "PTY" | "R06" | "REH" | "S06" | "SKY" | "T3H" | "TMN" | "TMX"
                    | "UUU" | "VVV" | "WAV" | "VEC" | "WSD" | "PCP" | "SNO" | "TMP" => category,
                    _ => continue,
                };
                let raw_text = raw?;
                match field {
                    "PCP" => set_precipitation(row, "r06", raw_text, "mm", "강수없음"),
                    "SNO" => set_precipitation(row, "s06", raw_text, "cm", "적설없음"),
                    "TMP" => row.set("t3h", num(parse_measurement(raw_text, -50.))),
                    other => row.set(&other.to_ascii_lowercase(), num(value())),
                }
            }
        }
    }
    let first = list.first()?;
    let t = |k: &str| first.num(k);
    match family {
        Family::Current => {
            if t("rn1") == -1. || t("pty") == -1. || t("t1h") == -50. || t("t1h") < -100. {
                return None;
            }
            let row = &mut list[0];
            for k in ["pty", "rn1", "reh"] {
                if row.num(k) < 0. {
                    row.delete(k);
                }
            }
            emit(list, &[])
        }
        Family::Shortest | Family::Short => {
            let temp = if family == Family::Short {
                "t3h"
            } else {
                "t1h"
            };
            if t("sky") == -1.
                || t("reh") == -1.
                || t("pty") == -1.
                || t(temp) == -50.
                || t("pty") < 0.
                || t("sky") < 0.
                || t(temp) < -100.
                || t("reh") < 0.
            {
                return None;
            }
            sort_rows(&mut list);
            emit(
                list,
                &[
                    ("sky", -1., 0.),
                    ("reh", -1., 0.),
                    ("pty", -1., 0.),
                    (temp, -50., -100.),
                ],
            )
        }
    }
}

/// One acquisition ready to save, or why legacy would not save it.
#[derive(Debug)]
pub enum Organized {
    Rows(Vec<Row>),
    /// `validateForecastItems` failed (`invalidForecast`).
    InvalidForecast,
    /// The organizer failed (`recvFail`).
    Failed,
    /// `batch` refused the organized rows.
    BatchRejected,
}
/// The collector steps of `_recursiveRequestData` for one grid: forecast publication checks,
/// organizer, `within`, `batch` and the canonical publication.
pub fn collect(family: Family, items: &[Item], slot: &Slot, coord: Coord) -> Organized {
    if family != Family::Current && !raw_items(items, family, slot, coord) {
        return Organized::InvalidForecast;
    }
    let Some(mut rows) = organize(family, items) else {
        return Organized::Failed;
    };
    if family == Family::Current {
        return Organized::Rows(rows);
    }
    let Some(times) = expected(family, slot) else {
        return Organized::BatchRejected;
    };
    let allowed: Vec<String> = times.iter().map(|t| format!("{}{}", t.0, t.1)).collect();
    rows.retain(|r| allowed.contains(&row_at(r)) || trailing(family, slot, r, &times));
    let ids = identities(family, slot);
    let first_pub = rows.first().map(|r| r.text("pubDate"));
    let mut seen = std::collections::HashSet::new();
    let ok = first_pub.as_ref().is_some_and(|p| ids.contains(p))
        && rows.iter().all(|r| {
            seen.insert(row_at(r))
                && (allowed.contains(&row_at(r)) || trailing(family, slot, r, &times))
                && Some(r.text("pubDate")) == first_pub
                && r.num("mx") == coord.mx
                && r.num("my") == coord.my
        })
        && complete(family, slot, &rows, &times);
    if !ok {
        return Organized::BatchRejected;
    }
    for r in &mut rows {
        let p = canonical(family, &r.text("pubDate"));
        r.set("pubDate", Val::str(p));
    }
    Organized::Rows(rows)
}

/// `getKoreaDateObj('YYYYMMDDHHMM')` for a 12-digit string; None otherwise.
pub fn korea_date(s: &str) -> Option<f64> {
    if s.len() != 12 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let iso = format!(
        "{}-{}-{}T{}:{}:00+09:00",
        &s[..4],
        &s[4..6],
        &s[6..8],
        &s[8..10],
        &s[10..12]
    );
    Some(crate::domestic::kma::time::parse_date(&iso))
}
fn date_val(ms: f64) -> Val {
    Val::Date(ms)
}
fn fcs_of(doc: &Doc) -> f64 {
    match doc.get("fcsDate") {
        Some(Val::Date(ms)) => *ms,
        _ => f64::NAN,
    }
}
fn coord_doc(c: Coord) -> Val {
    Doc::new()
        .with("mx", Val::num(c.mx))
        .with("my", Val::num(c.my))
        .into()
}

/// One grid's documents of one collection, in insertion (natural) order.
#[derive(Debug, Clone, Default)]
pub struct GridDocs {
    docs: Vec<Doc>,
}
impl GridDocs {
    pub fn docs(&self) -> &[Doc] {
        &self.docs
    }
    /// Save organized rows as the DB 2.0 saver of `family` does. Rows whose dates cannot be
    /// reproduced end the save (None) with the documents written so far kept, as legacy does.
    pub fn save(&mut self, family: Family, rows: Vec<Row>) -> Option<()> {
        let first = rows.first()?;
        let coord = Coord {
            mx: first.num("mx"),
            my: first.num("my"),
        };
        let mut publication = korea_date(&first.text("pubDate")).unwrap_or(f64::NAN);
        for row in rows {
            let fcs = korea_date(&(row.text("date") + &row.text("time")))?;
            match family {
                Family::Current => {
                    if publication.is_nan() {
                        publication = fcs;
                    }
                    self.save_current(coord, publication, fcs, row);
                }
                Family::Shortest | Family::Short => {
                    if publication.is_nan() {
                        // `pubDate.getTime()` of an Invalid Date is NaN: the fence never matches.
                        return None;
                    }
                    self.save_fenced(family, coord, publication, fcs, &row);
                }
            }
        }
        Some(())
    }
    fn save_current(&mut self, coord: Coord, publication: f64, fcs: f64, mut row: Row) {
        let matches = |d: &Doc| fcs_of(d) == fcs && d.get("mCoord") == Some(&coord_doc(coord));
        let found: Vec<usize> = (0..self.docs.len())
            .filter(|i| matches(&self.docs[*i]))
            .collect();
        if found.len() == 1
            && let Some(Val::Doc(old)) = self.docs[found[0]].get(Family::Current.data_key())
        {
            for (k, v) in old.entries() {
                if !row.has_own(k) {
                    row.set(k, v.clone());
                }
            }
        }
        let data = strict(&row.materialized(), Family::Current.schema());
        match found.first() {
            Some(&i) => {
                // `$set` in Mongoose's reversed key order: currentData, fcsDate, pubDate, mCoord.
                let d = &mut self.docs[i];
                d.set("currentData", data.into());
                d.set("fcsDate", date_val(fcs));
                d.set("pubDate", date_val(publication));
                d.set("mCoord", coord_doc(coord));
            }
            None => {
                let d = Doc::new()
                    .with("mCoord", coord_doc(coord))
                    .with("fcsDate", date_val(fcs))
                    .with("__v", Val::Num(0.))
                    .with("currentData", data.into())
                    .with("pubDate", date_val(publication));
                self.docs.push(d);
            }
        }
    }
    fn save_fenced(&mut self, family: Family, coord: Coord, publication: f64, fcs: f64, row: &Row) {
        let bound = if family == Family::Shortest {
            publication + 30. * 60_000.
        } else {
            publication
        };
        let key = family.data_key();
        let data = strict(&row.materialized(), family.schema());
        let in_slot = |d: &Doc| {
            fcs_of(d) == fcs
                && d.get("mCoord").and_then(Val::as_doc).is_some_and(|m| {
                    m.get("mx") == Some(&Val::num(coord.mx))
                        && m.get("my") == Some(&Val::num(coord.my))
                })
        };
        let mut hit = false;
        for d in self.docs.iter_mut().filter(|d| in_slot(d)) {
            let fenced = match d.get("pubDate") {
                Some(Val::Date(p)) => *p <= bound,
                None | Some(Val::Null) => true,
                _ => false,
            };
            if fenced {
                hit = true;
                d.set(key, data.clone().into());
                d.set("fcsDate", date_val(fcs));
                d.set("pubDate", date_val(publication));
                d.set("mCoord", coord_doc(coord));
            }
        }
        if !hit && !self.docs.iter().any(in_slot) {
            self.docs.push(
                Doc::new()
                    .with("mCoord", coord_doc(coord))
                    .with("fcsDate", date_val(fcs))
                    .with("pubDate", date_val(publication))
                    .with(key, data.into())
                    .with("__v", Val::Num(0.)),
            );
        }
    }
    /// `remove({fcsDate: {$lte: anchor - 216 h}})`.
    pub fn retain(&mut self, anchor_ms: f64) {
        let limit = anchor_ms - RETENTION_MS;
        // A document without a valid date never matches `$lte`.
        self.docs
            .retain(|d| fcs_of(d) > limit || fcs_of(d).is_nan());
    }
    /// `find({'mCoord.mx', 'mCoord.my'}, {_id: 0}).sort({fcsDate: 1})`.
    pub fn answer(&self) -> Vec<Doc> {
        let mut out = self.docs.clone();
        out.sort_by(|a, b| {
            fcs_of(a)
                .partial_cmp(&fcs_of(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        out
    }
}
