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
/// The row's `date` and `time` strings, as [`Row::get`] reads them, equal these.
fn row_is(row: &Row, date: &str, time: &str) -> bool {
    row.str_ref("date").as_deref() == Some(date) && row.str_ref("time").as_deref() == Some(time)
}
fn valid(row: &Row, family: Family, at: &(String, String), slot: &Slot) -> bool {
    row_is(row, &at.0, &at.1)
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
/// `row_at(row) == key` without building the row's stamp.
fn row_at_is(row: &Row, key: &str) -> bool {
    let date = row.str_ref("date").unwrap_or_default();
    let time = row.str_ref("time").unwrap_or_default();
    key.len() == date.len() + time.len() && key.starts_with(&*date) && key.ends_with(&*time)
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
        rows.iter().any(|r| row_at_is(r, &key))
            && rows
                .iter()
                .filter(|r| row_at_is(r, &key))
                .all(|r| valid(r, family, at, slot))
    })
}
/// `rawItems(items, product, slot, coord)`.
fn raw_items(items: &[Item], family: Family, slot: &Slot, coord: Coord) -> bool {
    raw_items_checked(items, family, slot, coord).unwrap_or(false)
}
fn raw_items_checked(
    items: &[Item],
    family: Family,
    slot: &Slot,
    coord: Coord,
) -> Result<bool, crate::storage::Error> {
    let Some(times) = expected(family, slot) else {
        return Ok(false);
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
    let last = times.last().map_or(f64::NAN, |t| stamp(&t.0, &t.1));
    let ids = identities(family, slot);
    // Tables borrow bounded typed inputs. Only fixed publication/time strings are copied.
    let mut slots: std::collections::HashMap<(&str, &str), std::collections::HashSet<&str>> =
        std::collections::HashMap::new();
    slots
        .try_reserve(times.len())
        .map_err(|_| crate::storage::Error::Capacity)?;
    // The same for every item: the coordinate text and, once seen, the echoed publication.
    let nx = crate::gateway::response::js_number(coord.mx);
    let ny = crate::gateway::response::js_number(coord.my);
    let mut echoed: Option<String> = None;
    for item in items {
        let part = |k| item.get(k).unwrap_or("undefined");
        let date = part("baseDate");
        let time = part("baseTime");
        if date.len().checked_add(time.len()) != Some(12) {
            return Ok(false);
        }
        // `date + time`, compared without building it.
        let publication = |p: &str| p.len() == 12 && p.starts_with(date) && p.ends_with(time);
        if !ids.iter().any(|id| publication(id))
            || echoed.as_deref().is_some_and(|p| !publication(p))
            || Some(nx.as_str()) != item.get("nx")
            || Some(ny.as_str()) != item.get("ny")
        {
            return Ok(false);
        }
        if echoed.is_none() {
            let mut first = String::new();
            first
                .try_reserve_exact(12)
                .map_err(|_| crate::storage::Error::Capacity)?;
            first.push_str(date);
            first.push_str(time);
            echoed = Some(first);
        }
        let category = item.get("category").unwrap_or("undefined");
        let at = (part("fcstDate"), part("fcstTime"));
        if !times.iter().any(|t| t.0 == at.0 && t.1 == at.1) {
            let t = stamp(at.0, at.1);
            if !(t > last && t <= last + DAY) {
                continue;
            }
        } else {
            let categories = slots.entry(at).or_default();
            categories
                .try_reserve(1)
                .map_err(|_| crate::storage::Error::Capacity)?;
            categories.insert(category);
        }
        let text = item.get("fcstValue");
        if numbers.contains(&category) {
            let Some(text) = text else { return Ok(false) };
            let t = text.trim_matches(precip::js_ws);
            if !plain_number(t) || !finite(Some(&Val::Num(string_to_number(text)))) {
                return Ok(false);
            }
        } else if ["PCP", "SNO", "RN1", "R06", "S06"].contains(&category) {
            let snow = category == "SNO" || category == "S06";
            let value = text.map_or(V::Undef, V::s);
            if precip::parse(
                &value,
                if snow { "cm" } else { "mm" },
                Some(if snow { "적설없음" } else { "강수없음" }),
            )
            .is_none()
            {
                return Ok(false);
            }
        }
    }
    Ok(times.iter().all(|at| {
        let Some(categories) = slots.get(&(at.0.as_str(), at.1.as_str())) else {
            return false;
        };
        let has = |c| categories.contains(c);
        if !["SKY", "REH", "PTY", "UUU", "VVV", "VEC", "WSD"]
            .into_iter()
            .all(has)
        {
            return false;
        }
        if family == Family::Short {
            has("POP")
                && (!(at.1 == "0600" && (at.0 != slot.date || slot.time == "0200")) || has("TMN"))
                && (!(at.1 == "1500" && (at.0 != slot.date || slot.time.as_str() <= "1100"))
                    || has("TMX"))
                && (has("TMP") || has("T3H"))
                && (has("PCP") || has("R06"))
                && (has("SNO") || has("S06"))
        } else {
            ["T1H", "RN1", "LGT"].into_iter().all(has)
                && (slot.key().as_str() < "202606231100" || has("POP"))
        }
    }))
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
/// Actual row descendants are accounted before each copy; fixed/transient typed scratch is
/// reserved once from the input shape. This state belongs to one admitted blocking build.
struct RowLimits {
    used: usize,
}
impl RowLimits {
    fn charge(&mut self, n: usize) -> Result<(), crate::storage::Error> {
        self.used = super::forecast_cache::add(self.used, n)?;
        if self.used > super::forecast_cache::PARSE_BYTES {
            return Err(crate::storage::Error::Capacity);
        }
        Ok(())
    }
}
fn put(
    row: &mut Row,
    key: &str,
    value: Val,
    limits: Option<&mut RowLimits>,
) -> Result<(), crate::storage::Error> {
    if let Some(limits) = limits {
        let before = row.heap_weight()?;
        let extra = super::forecast_cache::add(
            super::forecast_cache::allocation(key.len())?,
            match &value {
                Val::Str(s) => super::forecast_cache::allocation(s.capacity())?,
                _ => 0,
            },
        )?;
        if super::forecast_cache::add(limits.used, extra)? > super::forecast_cache::PARSE_BYTES {
            return Err(crate::storage::Error::Capacity);
        }
        row.try_set(key, &value)?;
        limits.used = super::forecast_cache::add(limits.used - before, row.heap_weight()?)?;
    } else {
        row.set(key, value);
    }
    Ok(())
}
fn string(s: &str, bounded: bool) -> Result<Val, crate::storage::Error> {
    if bounded {
        Val::checked_str(s)
    } else {
        Ok(Val::str(s))
    }
}
fn set_precipitation(
    row: &mut Row,
    field: &str,
    value: &str,
    unit: &str,
    no_value: &str,
    mut limits: Option<&mut RowLimits>,
) -> Result<(), crate::storage::Error> {
    let parsed = precip::parse(&V::s(value), unit, Some(no_value));
    put(
        row,
        field,
        Val::Num(parsed.as_ref().map_or(-1., |p| p.amount)),
        limits.as_deref_mut(),
    )?;
    let text_field = format!("{field}Text");
    if parsed.is_some_and(|p| p.approx) {
        put(
            row,
            &text_field,
            string(value.trim_matches(precip::js_ws), limits.is_some())?,
            limits,
        )?;
    } else {
        let before = row.heap_weight()?;
        row.delete(&text_field);
        if let Some(l) = limits {
            l.used = l.used - before + row.heap_weight()?;
        }
    }
    Ok(())
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
    limits: Option<&mut RowLimits>,
) -> Result<&'a mut Row, crate::storage::Error> {
    if let Some(i) = list.iter().position(|r| row_is(r, date, time)) {
        return Ok(&mut list[i]);
    }
    let row = if let Some(limits) = limits {
        limits.charge(super::forecast_cache::allocation(
            32 * std::mem::size_of::<(String, Val)>(),
        )?)?;
        if list.len() == list.capacity() {
            return Err(crate::storage::Error::Capacity);
        }
        Row::bounded(template)?
    } else {
        Row::new(template)
    };
    list.push(row);
    Ok(list.last_mut().expect("just inserted"))
}
/// `_emitOrganizedData(index, records, required)`.
fn emit(
    records: Vec<Row>,
    required: &[(&str, f64, f64)],
    checked: bool,
) -> Result<Option<Vec<Row>>, crate::storage::Error> {
    if records.is_empty() {
        return Ok(None);
    }
    for row in &records {
        let doc = if checked {
            row.checked_materialized()?
        } else {
            row.materialized()
        };
        if doc.entries().iter().any(|(k, v)| {
            (k.starts_with("wf")
                && !matches!(v,Val::Str(s) if !s.trim_matches(precip::js_ws).is_empty()))
                || matches!(v,Val::Num(n) if !n.is_finite())
        }) || required
            .iter()
            .any(|(name, missing, min)| match row.get(name) {
                Some(Val::Num(n)) => n == *missing || n < *min,
                _ => true,
            })
        {
            return Ok(None);
        }
    }
    Ok(Some(records))
}
fn sort_rows(rows: &mut [Row]) {
    fn text<'a>(r: &'a Row, k: &str) -> &'a str {
        r.own().get(k).and_then(Val::as_str).unwrap_or("")
    }
    rows.sort_by(|a, b| {
        text(a, "date")
            .cmp(text(b, "date"))
            .then_with(|| text(a, "time").cmp(text(b, "time")))
    });
}

/// The organizer of one acquisition; None when legacy fails it (`recvFail`).
fn organize(
    family: Family,
    items: &[Item],
    mut list: Vec<Row>,
    mut limits: Option<RowLimits>,
) -> Result<Option<Vec<Row>>, crate::storage::Error> {
    macro_rules! need {
        ($value:expr) => {
            match $value {
                Some(value) => value,
                None => return Ok(None),
            }
        };
    }
    let bounded = limits.is_some();
    let template = match family {
        Family::Current => CURRENT_TEMPLATE,
        Family::Shortest => SHORTEST_TEMPLATE,
        Family::Short => SHORT_TEMPLATE,
    };
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
        let date = need!(item.get(date_key));
        let time = need!(item.get(time_key));
        if date.encode_utf16().count() <= 1 || time.encode_utf16().count() <= 1 {
            continue;
        }
        let bd = need!(item.get("baseDate"));
        let bt = need!(item.get("baseTime"));
        let mut publication = String::new();
        publication
            .try_reserve_exact(super::forecast_cache::add(bd.len(), bt.len())?)
            .map_err(|_| crate::storage::Error::Capacity)?;
        publication.push_str(bd);
        publication.push_str(bt);
        let mx = if bounded {
            super::doc::bounded_int(need!(item.get("nx")))?
        } else {
            parse_int(&V::s(need!(item.get("nx"))))
        };
        let my = if bounded {
            super::doc::bounded_int(need!(item.get("ny")))?
        } else {
            parse_int(&V::s(need!(item.get("ny"))))
        };
        let category = need!(item.get("category"));
        let row = find_or_create(&mut list, template, date, time, limits.as_mut())?;
        put(
            row,
            "pubDate",
            string(&publication, bounded)?,
            limits.as_mut(),
        )?;
        put(row, "date", string(date, bounded)?, limits.as_mut())?;
        put(row, "time", string(time, bounded)?, limits.as_mut())?;
        put(row, "mx", num(mx), limits.as_mut())?;
        put(row, "my", num(my), limits.as_mut())?;
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
                need!(raw);
                put(row, field, num(value()), limits.as_mut())?;
            }
            Family::Shortest => {
                let raw_text = raw.unwrap_or("");
                match category {
                    "RN1" => {
                        set_precipitation(row, "rn1", raw_text, "mm", "강수없음", limits.as_mut())?
                    }
                    "POP" => put(row, "pop", num(parse_percent(raw_text)), limits.as_mut())?,
                    "PTY" | "SKY" | "LGT" | "T1H" | "REH" | "UUU" | "VVV" | "VEC" | "WSD" => put(
                        row,
                        &category.to_ascii_lowercase(),
                        num(value()),
                        limits.as_mut(),
                    )?,
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
                let raw_text = need!(raw);
                match field {
                    "PCP" => {
                        set_precipitation(row, "r06", raw_text, "mm", "강수없음", limits.as_mut())?
                    }
                    "SNO" => {
                        set_precipitation(row, "s06", raw_text, "cm", "적설없음", limits.as_mut())?
                    }
                    "TMP" => put(
                        row,
                        "t3h",
                        num(parse_measurement(raw_text, -50.)),
                        limits.as_mut(),
                    )?,
                    other => put(
                        row,
                        &other.to_ascii_lowercase(),
                        num(value()),
                        limits.as_mut(),
                    )?,
                }
            }
        }
    }
    let first = need!(list.first());
    let t = |k: &str| first.num(k);
    match family {
        Family::Current => {
            if t("rn1") == -1. || t("pty") == -1. || t("t1h") == -50. || t("t1h") < -100. {
                return Ok(None);
            }
            let row = &mut list[0];
            for k in ["pty", "rn1", "reh"] {
                if row.num(k) < 0. {
                    row.delete(k);
                }
            }
            emit(list, &[], bounded)
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
                return Ok(None);
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
                bounded,
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
    collect_into(family, items, slot, coord, Vec::new(), false, None).unwrap_or(Organized::Failed)
}
/// Preflight the complete typed organizer workspace before any input-derived copies. Keys in
/// the legacy organizer are date/time pairs; no more rows can grow than this admitted set.
pub(super) fn collect_bounded(
    family: Family,
    items: &[Item],
    slot: &Slot,
    coord: Coord,
) -> Result<Organized, crate::storage::Error> {
    use super::forecast_cache::{add, allocation, reserve};
    let mut input = allocation(
        items
            .len()
            .checked_mul(std::mem::size_of::<Item>())
            .ok_or(crate::storage::Error::Capacity)?,
    )?;
    let mut payload = 0usize;
    for item in items {
        input = add(input, super::forecast_cache::vector(&item.0)?)?;
        for (k, v) in &item.0 {
            input = add(
                input,
                add(allocation(k.capacity())?, allocation(v.capacity())?)?,
            )?;
            payload = add(payload, add(k.len(), v.len())?)?;
        }
    }
    let mut rows = Vec::new();
    reserve(&mut rows, items.len())?;
    let mut limits = RowLimits { used: 0 };
    limits.charge(input)?;
    limits.charge(super::forecast_cache::vector(&rows)?)?;
    // One live input-sized value/canonicalization, one materialized row and comparison scratch;
    // each retained row string originates in an item field (canonical UTF-8 expands at most2x).
    limits.charge(
        payload
            .checked_mul(8)
            .ok_or(crate::storage::Error::Capacity)?,
    )?;
    // Borrowed table slots/categories plus fixed maximum seven-day selector work.
    limits.charge(
        items
            .len()
            .checked_mul(
                std::mem::size_of::<(&str, &str)>()
                    + std::mem::size_of::<std::collections::HashSet<&str>>()
                    + 64,
            )
            .ok_or(crate::storage::Error::Capacity)?,
    )?;
    limits.charge(7 * 24 * 256)?;
    if family != Family::Current && !raw_items_checked(items, family, slot, coord)? {
        return Ok(Organized::InvalidForecast);
    }
    collect_into(family, items, slot, coord, rows, true, Some(limits))
}
fn collect_into(
    family: Family,
    items: &[Item],
    slot: &Slot,
    coord: Coord,
    rows: Vec<Row>,
    validated: bool,
    limits: Option<RowLimits>,
) -> Result<Organized, crate::storage::Error> {
    if !validated && family != Family::Current && !raw_items(items, family, slot, coord) {
        return Ok(Organized::InvalidForecast);
    }
    let Some(mut rows) = organize(family, items, rows, limits)? else {
        return Ok(Organized::Failed);
    };
    if family == Family::Current {
        return Ok(Organized::Rows(rows));
    }
    let Some(times) = expected(family, slot) else {
        return Ok(Organized::BatchRejected);
    };
    let allowed: Vec<String> = times.iter().map(|t| format!("{}{}", t.0, t.1)).collect();
    rows.retain(|r| allowed.contains(&row_at(r)) || trailing(family, slot, r, &times));
    let ids = identities(family, slot);
    let first_pub = rows.first().map(|r| r.text("pubDate"));
    let mut seen = std::collections::HashSet::new();
    seen.try_reserve(rows.len())
        .map_err(|_| crate::storage::Error::Capacity)?;
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
        return Ok(Organized::BatchRejected);
    }
    for r in &mut rows {
        let p = canonical(family, &r.text("pubDate"));
        if validated {
            r.try_set("pubDate", &Val::checked_str(&p)?)?;
        } else {
            r.set("pubDate", Val::str(p));
        }
    }
    Ok(Organized::Rows(rows))
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
    pub(super) fn save_bounded(
        &mut self,
        family: Family,
        rows: Vec<Row>,
    ) -> Result<(), crate::storage::Error> {
        use super::doc::{checked_store, checked_strict};
        let Some(first) = rows.first() else {
            return Ok(());
        };
        let coord = Coord {
            mx: first.num("mx"),
            my: first.num("my"),
        };
        let mut publication = korea_date(&first.text("pubDate")).unwrap_or(f64::NAN);
        for mut row in rows {
            let Some(fcs) = korea_date(&(row.text("date") + &row.text("time"))) else {
                break;
            };
            let index = self
                .docs
                .iter()
                .position(|d| fcs_of(d) == fcs && d.get("mCoord") == Some(&coord_doc(coord)));
            if family == Family::Current {
                if publication.is_nan() {
                    publication = fcs;
                }
                if let Some(i) = index
                    && let Some(Val::Doc(old)) = self.docs[i].get("currentData")
                {
                    for (k, v) in old.entries() {
                        if !row.has_own(k) {
                            row.try_set(k, v)?;
                        }
                    }
                }
            } else {
                if publication.is_nan() {
                    break;
                }
                let bound = publication
                    + if family == Family::Shortest {
                        30. * 60_000.
                    } else {
                        0.
                    };
                if let Some(i) = index
                    && !match self.docs[i].get("pubDate") {
                        Some(Val::Date(p)) => *p <= bound,
                        None | Some(Val::Null) => true,
                        _ => false,
                    }
                {
                    continue;
                }
            }
            let data = checked_strict(&row.checked_materialized()?, family.schema())?;
            let mut d = if let Some(i) = index {
                self.docs[i].checked_clone()?
            } else {
                Doc::new()
            };
            if index.is_some() {
                d.try_set(family.data_key(), &data.into())?;
                d.try_set("fcsDate", &date_val(fcs))?;
                d.try_set("pubDate", &date_val(publication))?;
                d.try_set("mCoord", &coord_doc(coord))?;
            } else {
                d.try_set("mCoord", &coord_doc(coord))?;
                d.try_set("fcsDate", &date_val(fcs))?;
                if family == Family::Current {
                    d.try_set("__v", &Val::Num(0.))?;
                    d.try_set(family.data_key(), &data.into())?;
                    d.try_set("pubDate", &date_val(publication))?;
                } else {
                    d.try_set("pubDate", &date_val(publication))?;
                    d.try_set(family.data_key(), &data.into())?;
                    d.try_set("__v", &Val::Num(0.))?;
                }
            }
            checked_store(&mut self.docs, index, d)?;
        }
        Ok(())
    }
    pub(super) fn into_answer(mut self) -> Vec<Doc> {
        self.docs.sort_by(|a, b| {
            fcs_of(a)
                .partial_cmp(&fcs_of(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self.docs
    }
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

#[cfg(test)]
mod bounded_tests {
    use super::*;
    #[test]
    fn rows_are_found_by_their_date_and_time_as_get_reads_them() {
        let mut rows = vec![Row::new(CURRENT_TEMPLATE); 4];
        rows[0].set("date", Val::str("20260924"));
        rows[0].set("time", Val::str("1000"));
        // rows[1] keeps the template's empty date and time.
        rows[2].set("date", Val::Num(20260924.));
        rows[2].set("time", Val::str("1000"));
        rows[3].set("date", Val::checked_str("\u{10F800}").unwrap());
        rows[3].set("time", Val::str("1100"));
        let canonical = rows[3].text("date");
        let found = |rows: &mut Vec<Row>, date: &str, time: &str| {
            let n = rows.len();
            find_or_create(rows, CURRENT_TEMPLATE, date, time, None)
                .unwrap()
                .set("mark", Val::Num(1.));
            let at = rows.iter().position(|r| r.has_own("mark")).unwrap();
            rows[at].delete("mark");
            (at, rows.len() - n)
        };
        assert_eq!(found(&mut rows, "20260924", "1000"), (0, 0));
        assert_eq!(found(&mut rows, "", ""), (1, 0));
        assert_eq!(found(&mut rows, &canonical, "1100"), (3, 0));
        // A raw stand-in key never equals its canonical stored form; a number is not text.
        assert_eq!(found(&mut rows, "\u{10F800}", "1100"), (4, 1));
        assert_eq!(found(&mut rows, "20260924", "1100"), (5, 1));
    }
    #[test]
    fn borrowed_row_text_equals_the_copied_reads() {
        const STAND_IN: &[(&str, Tmpl)] = &[
            ("date", Tmpl::Str("\u{10F800}")),
            ("time", Tmpl::Str("0900")),
            ("mx", Tmpl::Num(1.)),
        ];
        let mut rows = vec![Row::new(CURRENT_TEMPLATE), Row::new(STAND_IN)];
        rows[0].set("date", Val::str("2026092"));
        rows[0].set("time", Val::str("41500"));
        let mut number = Row::new(STAND_IN);
        number.set("date", Val::Num(1.));
        rows.push(number);
        for row in &rows {
            for key in ["date", "time", "mx", "pubDate", "absent"] {
                assert_eq!(
                    row.str_ref(key).as_deref(),
                    row.get(key).as_ref().and_then(Val::as_str),
                    "{key}"
                );
            }
            for stamp in [
                "202609241500",
                "20260924",
                "1500",
                "",
                "\u{10F800}0900",
                &crate::domestic::kma::js::canon_str("\u{10F800}0900"),
                "0900",
            ] {
                assert_eq!(row_at_is(row, stamp), row_at(row) == stamp, "{stamp:?}");
            }
        }
    }
    #[test]
    fn canonicalization_mismatch_still_respects_the_item_count_row_reservation() {
        const ITEMS: usize = 64;
        let raw = "\u{10F800}";
        let mut rows = Vec::new();
        super::super::forecast_cache::reserve(&mut rows, ITEMS).unwrap();
        let capacity = rows.capacity();
        let mut limits = RowLimits {
            used: super::super::forecast_cache::vector(&rows).unwrap(),
        };
        for _ in 0..ITEMS {
            let row = find_or_create(&mut rows, CURRENT_TEMPLATE, raw, "1000", Some(&mut limits))
                .unwrap();
            put(
                row,
                "date",
                Val::checked_str(raw).unwrap(),
                Some(&mut limits),
            )
            .unwrap();
            put(
                row,
                "time",
                Val::checked_str("1000").unwrap(),
                Some(&mut limits),
            )
            .unwrap();
        }
        assert_eq!(
            rows.len(),
            ITEMS,
            "canonical stored text differs from the raw lookup key"
        );
        assert_eq!(
            rows.capacity(),
            capacity,
            "all row roots were reserved before organizer growth"
        );
        assert!(limits.used < super::super::forecast_cache::PARSE_BYTES);
    }
}
