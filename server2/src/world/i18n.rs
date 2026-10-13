//! i18n 0.8.3 locale selection and `__(key)` lookup for the legacy locales.
//! `locales.json` is a provenance-recorded subset of the legacy locale files at ca8735cf.
use std::{collections::HashMap, sync::OnceLock};

pub const LOCALES: [&str; 6] = ["en", "ko", "ja", "zh-CN", "de", "zh-TW"];
const DEFAULT: &str = "en";
type Table = HashMap<String, HashMap<String, String>>;
fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("locales.json")).expect("embedded locale subset");
        let mut out = Table::new();
        if let Some(locales) = raw.get("locales").and_then(|v| v.as_object()) {
            for (locale, entries) in locales {
                let map = entries
                    .as_object()
                    .map(|o| {
                        o.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                            .collect()
                    })
                    .unwrap_or_default();
                out.insert(locale.clone(), map);
            }
        }
        out
    })
}
/// Selected request locale.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Locale(&'static str);
impl Locale {
    pub fn name(self) -> &'static str {
        self.0
    }
    /// `res.__(key)`: a missing translation returns the key itself.
    pub fn tr(self, key: &str) -> String {
        table()
            .get(self.0)
            .and_then(|t| t.get(key))
            .cloned()
            .unwrap_or_else(|| key.to_owned())
    }
}
fn known(tag: &str) -> Option<&'static str> {
    LOCALES.iter().copied().find(|l| *l == tag)
}
/// `guessLanguage` for the Accept-Language header (no query parameter or cookie on this path).
pub fn guess(header: Option<&str>) -> Locale {
    let Some(header) = header.filter(|h| !h.is_empty()) else {
        return Locale(DEFAULT);
    };
    let mut order = Vec::new();
    let mut preferences: HashMap<String, f64> = HashMap::new();
    for item in header.split(',') {
        let item = item.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
        let mut parts = item.split(";q=");
        let lang = parts.next().unwrap_or("").to_owned();
        let quality = match parts.next() {
            None => 1.,
            Some(q) => {
                let v = super::js::parse_float(q);
                if v != 0. && !v.is_nan() { v } else { 0. }
            }
        };
        preferences.insert(lang.clone(), quality);
        order.push(lang);
    }
    let mut accepted: Vec<String> = order
        .into_iter()
        .filter(|l| preferences.get(l).copied().unwrap_or(0.) > 0.)
        .collect();
    super::js::js_sort(&mut accepted, |a, b| {
        let d = preferences[b] - preferences[a];
        if d > 0. {
            1
        } else if d < 0. {
            -1
        } else {
            0
        }
    });
    let mut fallback = None;
    for lang in &accepted {
        let parent = lang.split('-').next().unwrap_or("");
        if let Some(found) = known(lang) {
            return Locale(found);
        }
        if fallback.is_none() {
            fallback = known(parent);
        }
    }
    Locale(fallback.unwrap_or(DEFAULT))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accept_language_follows_i18n_083() {
        assert_eq!(guess(Some("ko-KR,ko;q=0.9")).name(), "ko");
        assert_eq!(guess(Some("zh-cn")).name(), "en");
        assert_eq!(guess(Some("fr-FR,de;q=0.8")).name(), "de");
        assert_eq!(guess(Some("zh-TW,zh;q=0.9")).name(), "zh-TW");
        assert_eq!(guess(Some("ja-JP")).name(), "ja");
        assert_eq!(guess(None).name(), "en");
        assert_eq!(Locale("ko").tr("LOC_CLEAR"), "맑음");
        assert_eq!(Locale("en").tr("LOC_UNKNOWN_KEY"), "LOC_UNKNOWN_KEY");
    }
}
