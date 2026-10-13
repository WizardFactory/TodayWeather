//! Warning zones ported from `server/lib/kmaWarningZones.js` (ca8735cf): getPwnCd event
//! replay and town-to-zone mapping. The zone table is a provenance-recorded copy.
use super::js::{self, chain, number, string, text, trim, truthy};
use crate::gateway::OrderedJson;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

/// Copy of `server/utils/data/kma_warning_zones.csv` at ca8735cf; see `data/PROVENANCE.md`.
pub const ZONE_TABLE: &str = include_str!("data/kma_warning_zones.csv");
const ROOT_ZONE: &str = "L1000000";
const ISSUE_COMMANDS: [&str; 4] = ["1", "3", "6", "7"];
const RELEASE_COMMANDS: [&str; 2] = ["2", "8"];
const PROVINCE_ALIASES: [(&str, &str); 4] = [
    ("강원특별자치도", "강원도"),
    ("전북특별자치도", "전북자치도"),
    ("전라북도", "전북자치도"),
    ("제주특별자치도", "제주도"),
];
const LEGACY_CITIES: [(&str, &str); 1] = [("청원군", "청주시")];
const SHARED_ZONES: [(&str, &[&str], &str); 1] =
    [("제주도", &["제주시", "서귀포시"], "제주도산지")];
const ISLAND_ZONES: [(&str, &str, &str); 7] = [
    ("울릉", "", "울릉도.독도"),
    ("신안", "흑산", "흑산도.홍도"),
    ("제주시", "추자", "추자도"),
    ("여수", "삼산", "거문도.초도"),
    ("옹진", "백령", "백령도.대청도"),
    ("옹진", "대청", "백령도.대청도"),
    ("옹진", "연평", "연평도.우도"),
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Zone {
    pub id: String,
    pub up: String,
    pub ko: String,
    pub name: String,
}
/// Insertion-ordered zone table (`Object.keys(table.byId)` order).
#[derive(Clone, Debug, Default)]
pub struct ZoneTable {
    order: Vec<String>,
    by_id: HashMap<String, Zone>,
    children: HashMap<String, Vec<String>>,
    first_level: Vec<String>,
}
impl ZoneTable {
    /// `parseZoneTable(text, nowStr)`; rows whose TM_ED is earlier than `now` are ignored.
    pub fn parse(text: &str, now: Option<&str>) -> Self {
        let mut t = Self::default();
        for line in text.split('\n') {
            let line = line.strip_suffix('\r').unwrap_or(line);
            if line.is_empty() || line.starts_with('#') || line.starts_with("REG_ID,") {
                continue;
            }
            let f: Vec<&str> = line.split(',').collect();
            if f.len() < 7 || now.is_some_and(|n| !n.is_empty() && f[2] < n) {
                continue;
            }
            let zone = Zone {
                id: f[0].into(),
                up: f[4].into(),
                ko: f[5].into(),
                name: f[6].into(),
            };
            if !t.by_id.contains_key(&zone.id) {
                t.order.push(zone.id.clone());
            }
            t.by_id.insert(zone.id.clone(), zone);
        }
        for id in &t.order {
            let zone = &t.by_id[id];
            t.children
                .entry(zone.up.clone())
                .or_default()
                .push(id.clone());
            if zone.up == ROOT_ZONE {
                t.first_level.push(id.clone());
            }
        }
        t
    }
    /// Process-wide table filtered with the first caller's KST time, as legacy caches it.
    pub fn shared(now_ms: i64) -> &'static Self {
        static TABLE: OnceLock<ZoneTable> = OnceLock::new();
        TABLE.get_or_init(|| {
            let kst = js::iso(now_ms + 9 * 3_600_000);
            let now = format!(
                "{}{}{}{}{}",
                &kst[0..4],
                &kst[5..7],
                &kst[8..10],
                &kst[11..13],
                &kst[14..16]
            );
            Self::parse(ZONE_TABLE, Some(&now))
        })
    }
    pub fn zone(&self, id: &str) -> Option<&Zone> {
        self.by_id.get(id)
    }
    pub fn zone_name(&self, id: &str) -> Option<&str> {
        self.by_id.get(id).map(|z| z.name.as_str())
    }
    fn all(&self) -> Vec<&Zone> {
        self.order.iter().map(|id| &self.by_id[id]).collect()
    }
    fn descendants<'a>(&'a self, zone: &Zone, out: &mut Vec<&'a Zone>) {
        for child in self.children.get(&zone.id).into_iter().flatten() {
            let c = &self.by_id[child];
            out.push(c);
            self.descendants(c, out);
        }
    }
    fn expand(&self, roots: &[&Zone]) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let mut add = |id: &str| {
            if seen.insert(id.to_owned()) {
                out.push(id.to_owned());
            }
        };
        for root in roots {
            let mut list = vec![*root];
            self.descendants(root, &mut list);
            for z in list {
                add(&z.id);
            }
            let mut up = self.by_id.get(&root.up);
            while let Some(z) = up {
                add(&z.id);
                up = self.by_id.get(&z.up);
            }
        }
        out
    }
    fn named(&self, name: &str) -> Vec<&Zone> {
        self.all().into_iter().filter(|z| z.name == name).collect()
    }
    fn ancestors_and_self(&self, zone: &Zone) -> Vec<String> {
        let mut ids = Vec::new();
        let mut z = Some(zone);
        while let Some(current) = z {
            ids.push(current.id.clone());
            z = self.by_id.get(&current.up);
        }
        ids
    }
    fn city_zones<'a>(&'a self, zones: Vec<&'a Zone>, second: &str) -> Vec<&'a Zone> {
        let candidates: Vec<&Zone> = zones
            .into_iter()
            .filter(|z| {
                let base = base_name(&z.name);
                base == second || (ends_with_any(&base, "시군구") && second.starts_with(&*base))
            })
            .collect();
        candidates
            .iter()
            .filter(|zone| {
                !candidates.iter().any(|other| {
                    other.id != zone.id && {
                        let mut d = Vec::new();
                        self.descendants(other, &mut d);
                        d.iter().any(|x| x.id == zone.id)
                    }
                })
            })
            .copied()
            .collect()
    }
    /// `zonesForTown(town)`.
    pub fn zones_for_town(&self, town: &Town) -> Vec<String> {
        if town.first.is_empty() {
            return vec![];
        }
        let province_name = PROVINCE_ALIASES
            .iter()
            .find(|(k, _)| *k == town.first)
            .map_or(town.first.as_str(), |(_, v)| v);
        let Some(province) = self
            .first_level
            .iter()
            .map(|id| &self.by_id[id])
            .find(|z| z.name == province_name)
        else {
            return vec![];
        };
        let (second, third) = (town.second.as_str(), town.third.as_str());
        if let Some((_, _, zone)) = ISLAND_ZONES
            .iter()
            .find(|(s, t, _)| second.contains(s) && third.contains(t))
        {
            return self.expand(&self.named(zone));
        }
        if second.is_empty() {
            return self.expand(&[province]);
        }
        let mut descendants = Vec::new();
        self.descendants(province, &mut descendants);
        let lookup = LEGACY_CITIES
            .iter()
            .find(|(k, _)| *k == second)
            .map_or(second, |(_, v)| v);
        let mut candidates = self.city_zones(descendants, lookup);
        if !candidates.is_empty() {
            for (p, cities, zone) in SHARED_ZONES {
                if p == province.name && cities.iter().any(|c| second.starts_with(c)) {
                    candidates.extend(self.named(zone));
                }
            }
            return self.expand(&candidates);
        }
        if !["특별시", "광역시", "특별자치시"]
            .iter()
            .any(|s| province.name.ends_with(s))
        {
            let elsewhere = self.city_zones(self.all(), second);
            return if elsewhere.is_empty() {
                self.ancestors_and_self(province)
            } else {
                self.expand(&elsewhere)
            };
        }
        let children: Vec<&Zone> = self
            .children
            .get(&province.id)
            .into_iter()
            .flatten()
            .map(|id| &self.by_id[id])
            .collect();
        let same: Vec<&Zone> = children
            .iter()
            .copied()
            .filter(|z| z.name == province.name)
            .collect();
        if !same.is_empty() {
            return self.expand(&same);
        }
        let rest: Vec<&Zone> = children
            .iter()
            .copied()
            .filter(|z| !ends_with_any(&base_name(&z.name), "시군"))
            .collect();
        if rest.is_empty() {
            self.expand(&[province])
        } else {
            self.expand(&rest)
        }
    }
}
fn ends_with_any(s: &str, chars: &str) -> bool {
    s.chars().last().is_some_and(|c| chars.contains(c))
}
/// `name.replace(/\(.*\)\s*$/, '').trim()`.
pub fn base_name(name: &str) -> String {
    let body = name.trim_end_matches(js::is_space);
    if body.ends_with(')')
        && let Some(open) = name.find('(')
        && open < body.len() - 1
        && !name[open..body.len()]
            .chars()
            .any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
    {
        return trim(&name[..open]).to_owned();
    }
    trim(name).to_owned()
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Town {
    pub first: String,
    pub second: String,
    pub third: String,
}

/// One `KmaSpecialWeatherZone` state entry.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub area_code: String,
    pub area_name: String,
    pub warn_var: f64,
    pub warn_stress: f64,
    pub active: bool,
    pub command: String,
    pub event_tm_fc: f64,
    pub event_tm_seq: f64,
    pub event_rank: f64,
}
impl Entry {
    /// A legacy exported zone document; `None` for the `_sync` marker or a non-object.
    pub fn from_legacy(doc: &Value) -> Option<Self> {
        let o = doc.as_object()?;
        let area_code = text(o.get("areaCode"));
        if area_code == "_sync" {
            return None;
        }
        Some(Self {
            area_code,
            area_name: text(o.get("areaName")),
            warn_var: number(o.get("warnVar")),
            warn_stress: number(o.get("warnStress")),
            active: truthy(o.get("active")),
            command: text(o.get("command")),
            event_tm_fc: number(o.get("eventTmFc")),
            event_tm_seq: number(o.get("eventTmSeq")),
            event_rank: number(o.get("eventRank")),
        })
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub area_code: String,
    pub area_name: String,
    pub warn_var: f64,
    pub warn_stress: f64,
    pub command: String,
    pub cancel: bool,
    pub tm_fc: f64,
    pub tm_seq: f64,
    pub end_time: f64,
    pub all_end_time: f64,
    pub rank: f64,
}
fn num0(v: Option<&Value>) -> f64 {
    let n = js::number_str(&text(v));
    if n.is_nan() { 0. } else { n }
}
/// `normalizeRow(row)`.
pub fn normalize_row(row: &Value) -> Event {
    let g = |k| row.get(k);
    Event {
        area_code: trim(&text(g("areaCode"))).into(),
        area_name: trim(&text(g("areaName"))).into(),
        warn_var: num0(g("warnVar")),
        warn_stress: num0(g("warnStress")),
        command: trim(&text(g("command"))).into(),
        cancel: trim(&text(g("cancel"))) == "1",
        tm_fc: num0(g("tmFc")),
        tm_seq: num0(g("tmSeq")),
        end_time: num0(g("endTime")),
        all_end_time: num0(g("allEndTime")),
        rank: 0.,
    }
}
/// `prepareEvents(rows)`: drop cancelled/duplicate rows, stable-sort ascending.
pub fn prepare_events(rows: &[Value]) -> Vec<Event> {
    let mut seen = HashSet::new();
    let mut events = Vec::new();
    for row in rows {
        let mut e = normalize_row(row);
        if e.area_code.is_empty() || e.tm_fc == 0. || e.cancel {
            continue;
        }
        let n = crate::gateway::response::js_number;
        let id = [
            e.area_code.clone(),
            n(e.warn_var),
            n(e.tm_fc),
            n(e.tm_seq),
            e.command.clone(),
            n(e.warn_stress),
            n(e.end_time),
            n(e.all_end_time),
        ]
        .join("|");
        if !seen.insert(id) {
            continue;
        }
        e.rank = if ISSUE_COMMANDS.contains(&e.command.as_str()) {
            1.
        } else {
            0.
        };
        events.push(e);
    }
    events.sort_by(|a, b| {
        js::order(chain(&[
            a.tm_fc - b.tm_fc,
            a.tm_seq - b.tm_seq,
            a.rank - b.rank,
        ]))
    });
    events
}
pub fn state_key(area_code: &str, warn_var: f64) -> String {
    format!(
        "{area_code}|{}",
        crate::gateway::response::js_number(warn_var)
    )
}
/// Insertion-ordered zone state, the replacement of the persisted zone collection.
#[derive(Clone, Debug, Default)]
pub struct ZoneState {
    order: Vec<String>,
    entries: HashMap<String, Entry>,
}
impl ZoneState {
    pub fn insert(&mut self, entry: Entry) {
        let key = state_key(&entry.area_code, entry.warn_var);
        if !self.entries.contains_key(&key) {
            self.order.push(key.clone());
        }
        self.entries.insert(key, entry);
    }
    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.order.iter().map(|k| &self.entries[k])
    }
    pub fn len(&self) -> usize {
        self.order.len()
    }
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
    /// `applyEvents(state, events)` -> changed keys.
    pub fn apply(&mut self, events: &[Event]) -> Vec<String> {
        let mut changed = Vec::new();
        for e in events {
            let issue = ISSUE_COMMANDS.contains(&e.command.as_str());
            if !issue && !RELEASE_COMMANDS.contains(&e.command.as_str()) {
                continue;
            }
            let key = state_key(&e.area_code, e.warn_var);
            let newer = self.entries.get(&key).is_none_or(|old| {
                chain(&[
                    e.tm_fc - old.event_tm_fc,
                    e.tm_seq - old.event_tm_seq,
                    e.rank - old.event_rank,
                ]) > 0.
            });
            if newer {
                self.insert(Entry {
                    area_code: e.area_code.clone(),
                    area_name: e.area_name.clone(),
                    warn_var: e.warn_var,
                    warn_stress: e.warn_stress,
                    active: issue,
                    command: e.command.clone(),
                    event_tm_fc: e.tm_fc,
                    event_tm_seq: e.tm_seq,
                    event_rank: e.rank,
                });
                if !changed.contains(&key) {
                    changed.push(key);
                }
            }
        }
        changed
    }
}
fn table_value(v: f64, table: &[(i32, i32, &'static str)]) -> (i32, &'static str) {
    table
        .iter()
        .find(|(k, _, _)| f64::from(*k) == v)
        .map_or((0, ""), |(_, a, b)| (*a, *b))
}
const WARN_VAR_WEATHER: [(i32, i32, &str); 11] = [
    (1, 1, "강풍"),
    (2, 3, "호우"),
    (3, 9, "한파"),
    (4, 5, "건조"),
    (5, 7, "폭풍해일"),
    (6, 2, "풍랑"),
    (7, 10, "태풍"),
    (8, 4, "대설"),
    (9, 11, "황사"),
    (12, 12, "폭염"),
    (13, 13, "열대야"),
];
const WARN_STRESS_LEVEL: [(i32, i32, &str); 3] =
    [(0, 1, "주의보"), (1, 2, "경보"), (2, 4, "중대경보")];
pub fn weather_of(warn_var: f64) -> (i32, &'static str) {
    table_value(warn_var, &WARN_VAR_WEATHER)
}
pub fn level_of(warn_stress: f64) -> (i32, &'static str) {
    table_value(warn_stress, &WARN_STRESS_LEVEL)
}
/// One `specialInfo` item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpecialInfo {
    pub weather: i32,
    pub weather_str: String,
    pub level: i32,
    pub level_str: String,
    pub location_name: String,
}
impl SpecialInfo {
    pub fn to_json(&self) -> OrderedJson {
        OrderedJson::Object(vec![
            (js::key("weather"), OrderedJson::Number(self.weather.into())),
            (js::key("weatherStr"), js::ostr(&self.weather_str)),
            (js::key("level"), OrderedJson::Number(self.level.into())),
            (js::key("levelStr"), js::ostr(&self.level_str)),
            (js::key("locationName"), js::ostr(&self.location_name)),
        ])
    }
}
/// `specialInfoFor(entries, areaCodes)` followed by the controller's identical full sort.
pub fn special_info_for<'a>(
    table: &ZoneTable,
    entries: impl Iterator<Item = &'a Entry>,
    area_codes: &[String],
) -> Vec<SpecialInfo> {
    let in_town: HashSet<&str> = area_codes.iter().map(String::as_str).collect();
    let mut seen = HashSet::new();
    let mut list = Vec::new();
    for e in entries {
        if !e.active
            || e.warn_var.is_nan()
            || e.warn_var <= 0.
            || !in_town.contains(e.area_code.as_str())
        {
            continue;
        }
        let (weather, weather_str) = weather_of(e.warn_var);
        let (level, level_str) = level_of(e.warn_stress);
        let location_name = table
            .zone_name(&e.area_code)
            .filter(|n| !n.is_empty())
            .unwrap_or(&e.area_name)
            .to_owned();
        let id = format!("{weather}|{level}|{location_name}");
        if seen.insert(id) {
            list.push(SpecialInfo {
                weather,
                weather_str: weather_str.into(),
                level,
                level_str: level_str.into(),
                location_name,
            });
        }
    }
    list.sort_by(|a, b| {
        b.weather
            .cmp(&a.weather)
            .then(b.level.cmp(&a.level))
            .then_with(|| js::utf16(&a.location_name).cmp(&js::utf16(&b.location_name)))
    });
    list
}
/// `driftFromT6(entries, t6)` for logging: (active, none, missing).
pub fn drift_from_t6<'a>(
    entries: impl Iterator<Item = &'a Entry>,
    t6: Option<&Value>,
) -> (usize, bool, Vec<String>) {
    let compact = js::collapse_space(&text(t6), "");
    let none = compact.contains("없음") && !compact.contains("주의보") && !compact.contains("경보");
    let mut active = 0;
    let mut missing: Vec<String> = Vec::new();
    for e in entries {
        if !e.active || e.warn_var.is_nan() || e.warn_var <= 0. {
            continue;
        }
        active += 1;
        let name = format!("{}{}", weather_of(e.warn_var).1, level_of(e.warn_stress).1);
        if (none || !compact.contains(&name)) && !missing.contains(&name) {
            missing.push(name);
        }
    }
    (active, none, missing)
}
/// `String(row.tmFc) === String(status.tmFc)` style identity of a JSON field.
pub fn same_text(a: Option<&Value>, b: Option<&Value>) -> bool {
    string(a) == string(b)
}
