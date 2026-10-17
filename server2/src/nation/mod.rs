//! S17c native nation APIs. The cities share one absolute request deadline.
pub mod air;
use crate::{
    domestic::kma::{KmaRequest, Outcome, backend::KmaBackend},
    gateway::{BoxFuture, OrderedJson},
};
use futures_util::{StreamExt, stream};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

pub fn text(s: &str) -> OrderedJson {
    OrderedJson::String(s.encode_utf16().collect())
}
pub fn object(fields: Vec<(&str, OrderedJson)>) -> OrderedJson {
    OrderedJson::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
/// Province rows and safe availability metadata, already in legacy order.
pub struct NationAir {
    pub rows: Vec<OrderedJson>,
    pub status: OrderedJson,
}
pub trait NationSource: Send + Sync {
    fn nation_air(&self, now: f64, deadline: Instant) -> BoxFuture<'_, NationAir>;
}
pub const CITIES: [&str; 15] = [
    "서울특별시",
    "강원도/춘천시",
    "부산광역시",
    "대구광역시",
    "제주특별자치도/제주시",
    "광주광역시",
    "대전광역시",
    "충청북도/청주시",
    "전라북도/전주시",
    "강원도/강릉시",
    "인천광역시",
    "전라남도/목포시",
    "전라남도/여수시",
    "경상북도/안동시",
    "울산광역시",
];
/// Legacy-selected child-version assembly, never an HTTP hop to legacy. Air and all 15 cities share one
/// absolute three-second deadline; unfinished provider work is owned by the shared sources.
pub trait CitySource: Send + Sync {
    fn weather(
        &self,
        request: KmaRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Outcome, crate::gateway::GatewayError>>;
}
impl CitySource for KmaBackend {
    fn weather(
        &self,
        request: KmaRequest,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Outcome, crate::gateway::GatewayError>> {
        Box::pin(self.outcome(request, deadline))
    }
}
pub struct NationBackend {
    kma: Arc<dyn CitySource>,
    source: Arc<dyn NationSource>,
    clock: crate::domestic::kma::backend::Clock,
    narrative: Option<Arc<dyn crate::narrative::Read>>,
}
impl NationBackend {
    pub fn new(
        kma: Arc<dyn CitySource>,
        source: Arc<dyn NationSource>,
        clock: crate::domestic::kma::backend::Clock,
    ) -> Self {
        Self {
            kma,
            source,
            clock,
            narrative: None,
        }
    }
    pub fn with_narrative(mut self, reader: Option<Arc<dyn crate::narrative::Read>>) -> Self {
        self.narrative = reader;
        self
    }
    pub async fn outcome(&self, base: KmaRequest) -> Outcome {
        self.outcome_for(base, true).await
    }
    pub async fn outcome_for(&self, base: KmaRequest, national: bool) -> Outcome {
        let deadline = Instant::now() + Duration::from_secs(3);
        let now = (self.clock)();
        let air = self.source.nation_air(now, deadline);
        let weather = async {
            let mut jobs = Vec::new();
            for (index, city) in CITIES.into_iter().enumerate() {
                let mut request = base.clone();
                let mut parts = city.split('/');
                request.region = parts.next().map(str::to_owned);
                request.city = parts.next().map(str::to_owned);
                request.town = None;
                request.mount = if base.version == "v000903" {
                    "/v000903/kma".into()
                } else {
                    format!("/{}/kma/addr", base.version)
                };
                let city_path = city
                    .split('/')
                    .map(|part| {
                        part.bytes()
                            .map(|b| {
                                if b.is_ascii_alphanumeric()
                                    || matches!(b, b'-' | b'_' | b'.' | b'~')
                                {
                                    (b as char).to_string()
                                } else {
                                    format!("%{b:02X}")
                                }
                            })
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
                    .join("/");
                let query = base.original_url.split_once('?').map_or("", |(_, q)| q);
                request.original_url = format!("/{}/kma/addr/{city_path}?{query}", base.version);
                jobs.push(async move {
                    match self.kma.weather(request, deadline).await {
                        Ok(Outcome::Json(mut result)) => {
                            if let OrderedJson::Object(fields) = &mut result {
                                fields.retain(|(k, _)| {
                                    !["airInfo", "airInfoList", "forecastNarrative"]
                                        .iter()
                                        .any(|s| k == &s.encode_utf16().collect::<Vec<_>>())
                                });
                            }
                            Ok((index, result))
                        }
                        Ok(Outcome::Status(code, _)) if code >= 400 => Err(code),
                        _ => Err(500),
                    }
                });
            }
            let mut requests = stream::iter(jobs).buffer_unordered(CITIES.len());
            let mut results = Vec::new();
            while let Some(result) = requests.next().await {
                results.push(result?);
            }
            results.sort_by_key(|r| r.0);
            Ok::<_, u16>(results.into_iter().map(|(_, r)| r).collect::<Vec<_>>())
        };
        let answer = tokio::time::timeout_at(deadline, async { tokio::join!(air, weather) }).await;
        let (air, weather) = match answer {
            Ok((air, Ok(weather))) => (air, weather),
            Ok((_, Err(status))) => return child_error(status),
            Err(_) => return child_error(500),
        };
        let values: Vec<_> = base
            .query
            .iter()
            .filter(|(k, _)| k == "airUnit")
            .map(|(_, v)| v.as_str())
            .collect();
        let unit = match values.as_slice() {
            [] | ["(null)"] => text("airkorea"),
            [v] => text(v),
            _ => OrderedJson::Array(values.iter().map(|v| text(v)).collect()),
        };
        let rows = air
            .rows
            .iter()
            .map(|r| crate::domestic::kma::recalculate_nation_air(r, &unit))
            .collect::<Result<Vec<_>, _>>();
        let rows = match rows {
            Ok(rows) => rows,
            Err(_) => {
                let name = air
                    .rows
                    .iter()
                    .find_map(|row| {
                        ["pm10", "pm25", "o3", "no2", "co", "so2"]
                            .into_iter()
                            .find(|k| row.get(&format!("{k}Value")).is_some())
                    })
                    .unwrap_or("pm10");
                return rendered_error(&format!(
                    "Cannot read properties of undefined (reading '{name}')"
                ));
            }
        };
        let mut result = object(vec![
            ("nation", text("KR")),
            ("weather", OrderedJson::Array(weather)),
            ("air", OrderedJson::Array(rows)),
            ("airStatus", air.status),
        ]);
        crate::narrative::attach(
            &mut result,
            national.then_some(108),
            self.narrative.as_ref(),
            deadline,
        )
        .await;
        Outcome::Json(result)
    }
}

/// Express route `/:nation` accepts every nonempty nation segment, returning `nation: KR`.
/// Mounted only under the two used legacy nation versions; a trailing slash is accepted.
pub fn mount(path: &str) -> Option<&'static str> {
    let path = path
        .split('?')
        .next()?
        .strip_suffix('/')
        .unwrap_or(path.split('?').next()?);
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 4
        || !parts[0].is_empty()
        || !parts[2].eq_ignore_ascii_case("nation")
        || parts[3].is_empty()
    {
        return None;
    }
    if parts[1].eq_ignore_ascii_case("v000903") {
        Some("v000903")
    } else if parts[1].eq_ignore_ascii_case("v000901") {
        Some("v000901")
    } else {
        None
    }
}
/// Production `views/error.jade` extends layout.jade; no session middleware is run natively,
/// so the undefined sID is omitted from the JSON metadata as in the offline legacy oracle.
pub fn child_error(status: u16) -> Outcome {
    rendered_error(&format!(
        "response.statusCode={status} {{\"method\":\"getWeather\"}}"
    ))
}
/// Jade's escaped interpolation, with the literal legacy production layout and no stack.
pub fn rendered_error(message: &str) -> Outcome {
    rendered_error_status(500, message)
}
pub fn rendered_error_status(status: u16, message: &str) -> Outcome {
    let escaped = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    Outcome::Status(
        status,
        format!(
            r#"<!DOCTYPE html><html><head><title></title><link rel="stylesheet" href="/stylesheets/style.css"></head><body><h1>{escaped}</h1><h2></h2><pre></pre></body></html>"#
        ),
    )
}

/// Express decodes the route parameter even though nation composition always returns KR.
pub fn valid_parameter(value: &str) -> bool {
    let b = value.as_bytes();
    let mut decoded = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let digit = |b: u8| match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                b'A'..=b'F' => Some(b - b'A' + 10),
                _ => None,
            };
            let (Some(a), Some(c)) = (
                b.get(i + 1).and_then(|b| digit(*b)),
                b.get(i + 2).and_then(|b| digit(*b)),
            ) else {
                return false;
            };
            decoded.push(a * 16 + c);
            i += 3;
        } else {
            decoded.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(decoded).is_ok()
}
