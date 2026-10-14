//! `kma.town.mid.{forecast,land,temp}` documents rebuilt from `mid-fcst`, `mid-land-fcst` and
//! `mid-ta` acquisitions with the legacy collector at master: `organizeForecastData`,
//! `midForecastPolicy.parse`, `_emitOrganizedData`, `kmaTownMid.saveMid` with
//! `saveOnlyLastOne` (one document per region) and the `checkPubDate` skip of a stored
//! publication. Regions legacy never collects have no document.
use super::doc::{Doc, Val, strict};
use super::grid::korea_date;
use super::items::Item;
use crate::domestic::kma::MidModel;
use crate::domestic::kma::precip::js_ws;
use crate::world::js::string_to_number;
use std::sync::OnceLock;

/// `collectTownForecast` `listPointNumber` (getMidFcst `stnId`).
pub const POINT_NUMBERS: [&str; 10] = [
    "105", "108", "109", "131", "133", "146", "156", "143", "159", "184",
];
/// `collectTownForecast` `listAreaCode` (getMidLandFcst `regId`).
pub const LAND_CODES: [&str; 10] = [
    "11B00000", "11D10000", "11D20000", "11C20000", "11C10000", "11F20000", "11F10000", "11H10000",
    "11H20000", "11G00000",
];
const LAND_ZONES_CSV: &str = include_str!("data/kma_forecast_land_zones.csv");
/// `KmaForecastZoneController.landZoneIds()`.
pub fn land_zone_ids() -> &'static [String] {
    static IDS: OnceLock<Vec<String>> = OnceLock::new();
    IDS.get_or_init(|| {
        LAND_ZONES_CSV
            .split('\n')
            .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("REG_ID,"))
            .filter_map(|l| l.split(',').next())
            .filter(|id| {
                id.len() == 8
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
            })
            .map(str::to_owned)
            .collect()
    })
}
fn land_fields() -> Vec<String> {
    let mut out = Vec::new();
    for d in 3..=10 {
        let halves: &[&str] = if d <= 7 { &["Am", "Pm"] } else { &[""] };
        for h in halves {
            out.push(format!("wf{d}{h}"));
            out.push(format!("rnSt{d}{h}"));
        }
    }
    out
}
fn temp_fields() -> Vec<String> {
    (3..=10)
        .flat_map(|d| [format!("taMin{d}"), format!("taMax{d}")])
        .collect()
}
fn schema(model: MidModel) -> Vec<String> {
    let mut s: Vec<String> = match model {
        MidModel::Forecast => vec!["date", "time", "pointNumber", "cnt", "wfsv"],
        MidModel::Land | MidModel::Temp => vec!["regId", "date", "time"],
    }
    .into_iter()
    .map(str::to_owned)
    .collect();
    match model {
        MidModel::Land => s.extend(land_fields()),
        MidModel::Temp => s.extend(temp_fields()),
        MidModel::Forecast => {}
    }
    s
}
/// `midForecastPolicy` weather texts.
fn weather(v: &str) -> bool {
    const TEXTS: [&str; 24] = [
        "맑음",
        "구름조금",
        "구름많음",
        "흐림",
        "흐리고 한때 비",
        "흐리고 비",
        "흐리고 소나기",
        "구름적고 한때 비",
        "구름적고 비",
        "구름많고 한때 비",
        "구름많고 비",
        "구름많고 소나기",
        "흐리고 한때 눈",
        "흐리고 눈",
        "구름적고 한때 눈",
        "구름적고 눈",
        "구름많고 한때 눈",
        "구름많고 눈",
        "구름적고 비/눈",
        "구름적고 눈/비",
        "구름많고 비/눈",
        "구름많고 눈/비",
        "흐리고 비/눈",
        "흐리고 눈/비",
    ];
    TEXTS.contains(&v.trim_matches(js_ws))
}
/// `exports.number(value)` for xml2js text.
fn policy_number(v: &str) -> f64 {
    let t = v.trim_matches(js_ws);
    let u = t.strip_prefix(['+', '-']).unwrap_or(t);
    let ok = match u.split_once('.') {
        Some((a, b)) => {
            (!a.is_empty()
                && a.bytes().all(|c| c.is_ascii_digit())
                && b.bytes().all(|c| c.is_ascii_digit()))
                || (a.is_empty() && !b.is_empty() && b.bytes().all(|c| c.is_ascii_digit()))
        }
        None => !u.is_empty() && u.bytes().all(|c| c.is_ascii_digit()),
    };
    if ok { string_to_number(v) } else { f64::NAN }
}
/// `exports.publication(value)`: a 06:00 or 18:00 KST publication.
fn publication_ok(p: &str) -> bool {
    p.len() == 12
        && p.bytes().all(|b| b.is_ascii_digit())
        && (p.ends_with("0600") || p.ends_with("1800"))
        && korea_date(p).is_some_and(f64::is_finite)
}
/// The organized first record of one acquisition (`newData[0]`), or None when legacy fails it.
pub fn organize(model: MidModel, items: &[Item], publication: &str, code: &str) -> Option<Doc> {
    let (date, time) = (&publication[..8], &publication[8..]);
    match model {
        MidModel::Forecast => {
            // Every item needs a nonblank `wfSv`; the first record is saved.
            let mut first = None;
            for item in items {
                let wfsv = item
                    .get("wfSv")
                    .filter(|s| !s.trim_matches(js_ws).is_empty())?;
                first.get_or_insert_with(|| {
                    Doc::new()
                        .with("pubDate", Val::str(publication))
                        .with("date", Val::str(date))
                        .with("time", Val::str(time))
                        .with("pointNumber", Val::str(code))
                        .with("cnt", Val::Num(0.))
                        .with("wfsv", Val::str(wfsv))
                });
            }
            first
        }
        MidModel::Land | MidModel::Temp => {
            if !publication_ok(publication) || items.is_empty() {
                return None;
            }
            let fields = if model == MidModel::Land {
                land_fields()
            } else {
                temp_fields()
            };
            let mut first = None;
            for item in items {
                let reg_id = item
                    .get("regId")
                    .filter(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_alphanumeric()))?;
                let mut r = Doc::new()
                    .with("regId", Val::str(reg_id))
                    .with("date", Val::str(date))
                    .with("time", Val::str(time))
                    .with("pubDate", Val::str(publication));
                let mut usable = 0;
                for key in &fields {
                    let Some(value) = item.get(key) else { continue };
                    if key.starts_with("wf") {
                        if weather(value) {
                            r.set(key, Val::str(value.trim_matches(js_ws)));
                            usable += 1;
                        }
                    } else {
                        let n = policy_number(value);
                        let ok = n.is_finite()
                            && if model == MidModel::Temp {
                                n > -50. && n < 60.
                            } else {
                                (0. ..=100.).contains(&n)
                            };
                        if ok {
                            r.set(key, Val::Num(n));
                            if model == MidModel::Temp {
                                usable += 1;
                            }
                        }
                    }
                }
                if usable == 0 {
                    return None;
                }
                first.get_or_insert(r);
            }
            first
        }
    }
}

/// One region's stored document (`saveOnlyLastOne`).
#[derive(Debug, Clone, Default)]
pub struct MidDoc(Option<Doc>);
impl MidDoc {
    /// `checkPubDate`: the stored document already has this publication.
    pub fn has_publication(&self, publication_ms: f64) -> bool {
        self.0
            .as_ref()
            .is_some_and(|d| d.get("pubDate") == Some(&Val::Date(publication_ms)))
    }
    /// `saveMid(type, record, overwrite = true)`.
    pub fn save(&mut self, model: MidModel, record: &Doc) {
        let text = |k| record.get(k).and_then(Val::as_str).unwrap_or("").to_owned();
        let reg_id = match record.get("pointNumber") {
            Some(v) => v.clone(),
            None => record.get("regId").cloned().unwrap_or(Val::Null),
        };
        let (Some(publication), Some(fcs)) = (
            korea_date(&text("pubDate")),
            korea_date(&(text("date") + &text("time"))),
        ) else {
            return;
        };
        let fields = schema(model);
        let names: Vec<&str> = fields.iter().map(String::as_str).collect();
        let data = strict(record, &names);
        match &mut self.0 {
            Some(d) => {
                d.set("data", data.into());
                d.set("fcsDate", Val::Date(fcs));
                d.set("pubDate", Val::Date(publication));
                d.set("regId", reg_id);
            }
            None => {
                self.0 = Some(
                    Doc::new()
                        .with("regId", reg_id)
                        .with("__v", Val::Num(0.))
                        .with("data", data.into())
                        .with("fcsDate", Val::Date(fcs))
                        .with("pubDate", Val::Date(publication)),
                )
            }
        }
    }
    /// `find({regId}).sort({pubDate: -1}).limit(1)`.
    pub fn answer(&self) -> Vec<Doc> {
        self.0.iter().cloned().collect()
    }
}
