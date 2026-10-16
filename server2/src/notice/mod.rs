//! Operator-authored notices. S20 owns mounting the exported API in the process.
pub mod api;
pub mod cli;
pub mod store;
pub mod translate;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const LANGUAGES: [&str; 7] = ["en", "es", "ja", "de", "pt", "fr", "ko"];
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    Invalid(&'static str),
    Unavailable,
    Corrupt,
    Conflict,
    Uncertain,
    NotFound,
    Capacity,
    Translation(&'static str),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Invalid(s) => s,
            Self::Unavailable => "notice storage unavailable",
            Self::Corrupt => "notice state corrupt",
            Self::Conflict => "notice concurrent modification",
            Self::Uncertain => "notice write outcome uncertain",
            Self::NotFound => "notice not found",
            Self::Capacity => "notice state capacity",
            Self::Translation(s) => s,
        })
    }
}
impl std::error::Error for Error {}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub from: String,
    pub model: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Text {
    pub title: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translated: Option<Provenance>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Notice {
    pub id: u64,
    pub texts: BTreeMap<String, Text>,
    pub link_url: Option<String>,
    pub starts_at: i64,
    pub ends_at: Option<i64>,
    pub withdrawn_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
fn time(v: &Value) -> Result<i64, Error> {
    let s = v.as_str().ok_or(Error::Invalid("notice time"))?;
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .map_err(|_| Error::Invalid("notice time"))
}
fn utc(t: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(t)
        .expect("validated notice time")
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn has_markup(s: &str) -> bool {
    s.match_indices('<').any(|(i, _)| {
        let rest = &s[i + 1..];
        let first = rest.chars().next();
        first.is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, '/' | '!' | '?'))
            && rest.contains('>')
    })
}
fn valid_text(s: &str, max: usize, body: bool) -> bool {
    !s.trim().is_empty()
        && s.chars().count() <= max
        && !has_markup(s)
        && !s
            .chars()
            .any(|c| c.is_control() && !(body && matches!(c, '\n' | '\r' | '\t')))
}
impl Text {
    pub fn validate(&self) -> Result<(), Error> {
        if !valid_text(&self.title, 100, false) || !valid_text(&self.body, 2000, true) {
            return Err(Error::Invalid("notice text"));
        }
        if let Some(p) = &self.translated
            && (!LANGUAGES.contains(&p.from.as_str())
                || p.model.trim().is_empty()
                || p.model.len() > 128
                || p.model.chars().any(char::is_control))
        {
            return Err(Error::Invalid("notice translation provenance"));
        }
        Ok(())
    }
}
impl Notice {
    pub fn from_input(id: u64, v: &Value, now: i64) -> Result<Self, Error> {
        let o = v.as_object().ok_or(Error::Invalid("notice input"))?;
        if o.keys()
            .any(|k| !matches!(k.as_str(), "texts" | "linkUrl" | "startsAt" | "endsAt"))
        {
            return Err(Error::Invalid("notice input field"));
        }
        let texts = serde_json::from_value(
            o.get("texts")
                .cloned()
                .ok_or(Error::Invalid("notice texts"))?,
        )
        .map_err(|_| Error::Invalid("notice texts"))?;
        let link_url = match o.get("linkUrl") {
            None | Some(Value::Null) => None,
            Some(Value::String(v)) => Some(v.clone()),
            _ => return Err(Error::Invalid("notice link")),
        };
        let starts_at = o.get("startsAt").map(time).transpose()?.unwrap_or(now);
        let ends_at = match o.get("endsAt") {
            None | Some(Value::Null) => None,
            Some(v) => Some(time(v)?),
        };
        let n = Self {
            id,
            texts,
            link_url,
            starts_at,
            ends_at,
            withdrawn_at: None,
            created_at: now,
            updated_at: now,
        };
        n.validate()?;
        Ok(n)
    }
    pub fn validate(&self) -> Result<(), Error> {
        if self.id == 0 || self.id > 9_007_199_254_740_991 {
            return Err(Error::Invalid("notice id"));
        }
        if self.texts.is_empty() || !self.texts.contains_key("ko") && !self.texts.contains_key("en")
        {
            return Err(Error::Invalid("notice source text"));
        }
        for (lang, t) in &self.texts {
            if !LANGUAGES.contains(&lang.as_str()) {
                return Err(Error::Invalid("notice language"));
            }
            t.validate()?;
        }
        if let Some(link) = &self.link_url {
            let url = reqwest::Url::parse(link).map_err(|_| Error::Invalid("notice HTTPS link"))?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || link.len() > 2048
                || link.chars().any(char::is_control)
            {
                return Err(Error::Invalid("notice HTTPS link"));
            }
        }
        for t in [
            Some(self.starts_at),
            self.ends_at,
            self.withdrawn_at,
            Some(self.created_at),
            Some(self.updated_at),
        ]
        .into_iter()
        .flatten()
        {
            if DateTime::<Utc>::from_timestamp_millis(t).is_none() {
                return Err(Error::Invalid("notice time"));
            }
        }
        if self.ends_at.is_some_and(|t| t <= self.starts_at) {
            return Err(Error::Invalid("notice time window"));
        }
        Ok(())
    }
    pub fn active(&self, now: i64) -> bool {
        self.withdrawn_at.is_none()
            && self.starts_at <= now
            && self.ends_at.is_none_or(|end| now < end)
    }
    pub fn text(&self, query: Option<&str>, accept: Option<&str>) -> (&str, &Text) {
        let primary = |tag: &str| {
            tag.trim()
                .split('-')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase()
        };
        let mut wanted = Vec::new();
        if let Some(q) = query {
            wanted.push(primary(q));
        } else if let Some(header) = accept {
            for entry in header.split(',') {
                let mut parts = entry.split(';');
                let tag = parts.next().unwrap_or("");
                if parts.any(|p| {
                    // RFC 9110 section12.4.2 names q case-insensitively.
                    p.trim().split_once('=').is_some_and(|(name, value)| {
                        name.eq_ignore_ascii_case("q")
                            && value.parse::<f64>().ok().is_some_and(|q| q <= 0.)
                    })
                }) {
                    continue;
                }
                wanted.push(primary(tag));
            }
        }
        wanted.extend(["en".into(), "ko".into()]);
        for lang in wanted {
            if let Some((key, text)) = self.texts.get_key_value(&lang) {
                return (key, text);
            }
        }
        unreachable!("validated notice has English or Korean")
    }
    pub fn public(&self, query: Option<&str>, accept: Option<&str>) -> Value {
        let (lang, text) = self.text(query, accept);
        json!({"id":self.id,"title":text.title,"body":text.body,"linkUrl":self.link_url,"lang":lang,"startsAt":utc(self.starts_at),"endsAt":self.ends_at.map(utc)})
    }
    pub fn source(&self) -> (&str, &Text) {
        self.texts
            .get_key_value("ko")
            .or_else(|| self.texts.get_key_value("en"))
            .map(|(l, t)| (l.as_str(), t))
            .expect("validated notice source")
    }
}
pub fn latest(notices: &[Notice], now: i64) -> Option<&Notice> {
    notices
        .iter()
        .filter(|n| n.active(now))
        .max_by_key(|n| (n.starts_at, n.id))
}
