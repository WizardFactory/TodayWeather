//! Legacy unit, AQI, description and summary helpers used by the world response.
//! Ports UnitConverter, AqiConverter, ControllerWeatherDesc, UV grades, WAQI station names and
//! the ControllerTown/ControllerTown24h summary builders at ca8735cf.
use super::{
    i18n::Locale,
    js::{Obj, Val, fixed, js_sort, num_string, round},
    vc::js_string,
};

pub const UNIT_LIST: [&str; 6] = [
    "temperatureUnit",
    "windSpeedUnit",
    "pressureUnit",
    "distanceUnit",
    "precipitationUnit",
    "airUnit",
];
pub fn default_unit(name: &str) -> &'static str {
    match name {
        "temperatureUnit" => "C",
        "windSpeedUnit" => "m/s",
        "pressureUnit" => "hPa",
        "distanceUnit" => "km",
        "precipitationUnit" => "mm",
        "airUnit" => "airkorea",
        _ => "",
    }
}
fn beaufort(ms: f64) -> Val {
    let limits = [
        0.3, 1.5, 3.3, 5.5, 8.0, 10.8, 13.9, 17.2, 20.7, 24.5, 28.4, 32.6,
    ];
    for (i, l) in limits.iter().enumerate() {
        if ms < *l {
            return Val::Num(i as f64);
        }
    }
    if ms >= 32.6 {
        Val::Num(12.)
    } else {
        Val::Undef
    }
}
/// `new UnitConverter().convertUnits(from, to, val)` for the defaults used by the world path.
pub fn convert(from: &str, to: &Val, val: &Val) -> Val {
    if val.is_nullish() {
        return val.clone();
    }
    let to_s = to.str();
    if to_s == Some(from) {
        return val.clone();
    }
    let v = val.to_number();
    let to = to_s.unwrap_or("");
    match from {
        "m/s" => match to {
            "mph" => Val::Num(fixed(v * 2.236936, 1)),
            "km/h" => Val::Num(fixed(v * 3.6, 1)),
            "bft" => beaufort(v),
            "kt" => Val::Num(fixed(v * 1.943844, 1)),
            _ => Val::Undef,
        },
        "hPa" => match to {
            "mmHg" => Val::Num(fixed(v * 0.750062, 1)),
            "inHg" => Val::Num(fixed(v * 0.02953, 1)),
            "hPa" | "mb" => val.clone(),
            _ => Val::Undef,
        },
        "km" => Val::Num(fixed(v * 0.621371, 1)),
        "mm" => Val::Num(fixed(v * 0.03937, 1)),
        _ => val.clone(),
    }
}

/// AQI breakpoints by unit and pollutant.
fn breakpoints(unit: &str, code: &str) -> Option<&'static [f64]> {
    Some(match (unit, code) {
        ("airkorea", "pm25") => &[0., 15., 35., 75., 500.],
        ("airkorea", "pm10") => &[0., 30., 80., 150., 600.],
        ("airkorea" | "airkorea_who", "o3") => &[0., 0.03, 0.09, 0.15, 0.6],
        ("airkorea" | "airkorea_who", "no2") => &[0., 0.03, 0.06, 0.2, 2.],
        ("airkorea" | "airkorea_who", "co") => &[0., 2., 9., 15., 50.],
        ("airkorea" | "airkorea_who", "so2") => &[0., 0.02, 0.05, 0.15, 1.],
        ("airkorea" | "airkorea_who", "aqi") => &[0., 50., 100., 250., 500.],
        ("airkorea_who", "pm25") => &[0., 15., 25., 50., 500.],
        ("airkorea_who", "pm10") => &[0., 30., 50., 100., 600.],
        ("airnow", "pm25") => &[0., 12.0, 35.4, 55.4, 150.4, 250.4, 500.4],
        ("airnow", "pm10") => &[0., 54., 154., 254., 354., 424., 604.],
        ("airnow", "o3") => &[0., 54., 124., 164., 204., 404., 604.],
        ("airnow", "no2") => &[0., 53., 100., 360., 649., 1249., 2049.],
        ("airnow", "co") => &[0., 4.4, 9.4, 12.4, 15.4, 30.4, 50.4],
        ("airnow", "so2") => &[0., 35., 75., 185., 304., 604., 1004.],
        ("airnow" | "aqicn", "aqi") => &[0., 50., 100., 150., 200., 300., 500.],
        ("aqicn", "pm25") => &[0., 35., 75., 115., 150., 250., 500.],
        ("aqicn", "pm10") => &[0., 50., 150., 250., 350., 420., 600.],
        ("aqicn", "o3") => &[0., 160., 200., 300., 400., 800., 1200.],
        ("aqicn", "no2") => &[0., 100., 200., 700., 1200., 2340., 3840.],
        ("aqicn", "co") => &[0., 5., 10., 35., 60., 90., 150.],
        ("aqicn", "so2") => &[0., 150., 500., 650., 800., 1600., 2620.],
        _ => return None,
    })
}
fn known_unit(unit: &str) -> bool {
    matches!(unit, "airkorea" | "airkorea_who" | "airnow" | "aqicn")
}
fn at(list: &[f64], i: f64) -> f64 {
    if i >= 0. && i.fract() == 0. {
        list.get(i as usize).copied().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}
fn ppm2um(code: &str, value: f64) -> f64 {
    let mol = match code {
        "so2" => 64.05,
        "no2" => 45.99,
        "o3" => 47.97,
        "co" => 28.00,
        _ => return -1.,
    };
    round(value * 1000. * mol / 22.4)
}
pub fn um2ppm(code: &str, value: f64) -> f64 {
    let mol = match code {
        "so2" => 64.05,
        "no2" => 45.99,
        "o3" => 47.97,
        "co" => 28.00,
        _ => return -1.,
    };
    round(value * 22.4 / mol) / 1000.
}
pub fn ppb2ppm(value: f64) -> f64 {
    fixed(value / 1000., 3)
}
fn unit_value(unit: &str, code: &str, mut v: f64) -> f64 {
    if matches!(code, "o3" | "no2" | "so2") {
        if unit == "airnow" {
            v *= 1000.;
        } else if unit == "aqicn" {
            v = ppm2um(code, v);
            if v.is_nan() || v < 0. {
                v = 0.;
            }
        }
    } else if code == "co" && unit == "aqicn" {
        v = ppm2um(code, v) / 1000.;
        if v.is_nan() || v < 0. {
            v = 0.;
        }
    }
    v
}
/// The legacy TypeError for an unknown air unit or unsupported summary value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnknownUnit;
/// Ok(grade) or Err for an unknown unit (the legacy TypeError).
pub fn value2grade(unit: &str, code: &str, v: f64) -> Result<f64, UnknownUnit> {
    value2grade_converting(unit, unit, code, v)
}
/// `value2grade` whose breakpoint table is looked up by `unit` (the property key of `airUnit`)
/// while the value conversion follows `conversion` (legacy compares `airUnit === 'airnow'`
/// strictly and `airUnit == 'aqicn'` loosely, so a non-string `airUnit` can select a table
/// without its conversion; the caller passes `""` for no conversion).
pub fn value2grade_converting(
    unit: &str,
    conversion: &str,
    code: &str,
    v: f64,
) -> Result<f64, UnknownUnit> {
    if !known_unit(unit) {
        return Err(UnknownUnit);
    }
    let b = breakpoints(unit, code).ok_or(UnknownUnit)?;
    let v = unit_value(conversion, code, v);
    Ok(grade_of(b, v))
}
fn grade_of(b: &[f64], v: f64) -> f64 {
    if v < b[0] {
        -1.
    } else if v <= b[1] {
        1.
    } else if v <= b[2] {
        2.
    } else if v <= b[3] {
        3.
    } else if v > b[3] {
        if b.len() > 4 {
            if v <= b[4] {
                return 4.;
            } else if v <= b[5] {
                return 5.;
            } else if v > b[5] {
                return 6.;
            }
        }
        4.
    } else {
        -1.
    }
}
pub fn value2index(unit: &str, code: &str, value: f64) -> Result<f64, UnknownUnit> {
    value2index_converting(unit, unit, code, value)
}
/// `value2index` with the table/conversion split of [`value2grade_converting`].
pub fn value2index_converting(
    unit: &str,
    conversion: &str,
    code: &str,
    value: f64,
) -> Result<f64, UnknownUnit> {
    if !known_unit(unit) {
        return Err(UnknownUnit);
    }
    let b = breakpoints(unit, code).ok_or(UnknownUnit)?;
    let a = breakpoints(unit, "aqi").ok_or(UnknownUnit)?;
    let grade = value2grade_converting(unit, conversion, code, value)?;
    let v = unit_value(conversion, code, value);
    Ok(round(
        (at(a, grade) - at(a, grade - 1.)) / (at(b, grade) - at(b, grade - 1.))
            * (v - at(b, grade - 1.))
            + at(a, grade - 1.),
    ))
}
/// `index2Grade(unit, index)`; an `undefined` index returns -1.
pub fn index2grade(unit: &str, index: &Val) -> Result<f64, UnknownUnit> {
    if index.is_undef() {
        return Ok(-1.);
    }
    let aqi = parse_int(index);
    let a = breakpoints(unit, "aqi").ok_or(UnknownUnit)?;
    Ok(grade_of(a, aqi))
}
fn parse_int(v: &Val) -> f64 {
    let s = js_string(v);
    let t = s.trim_start();
    let (sign, rest) = match t.as_bytes().first() {
        Some(b'-') => (-1., &t[1..]),
        Some(b'+') => (1., &t[1..]),
        _ => (1., t),
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        f64::NAN
    } else {
        sign * digits.parse::<f64>().unwrap_or(f64::NAN)
    }
}
pub fn airkorea_grade_str(grade: f64, ts: Locale) -> String {
    let key = match grade {
        1. => "LOC_GOOD",
        2. => "LOC_MODERATE",
        3. => "LOC_UNHEALTHY",
        4. => "LOC_VERY_UNHEALTHY",
        _ => return String::new(),
    };
    ts.tr(key)
}
pub fn airnow_grade_str(grade: f64, ts: Locale) -> String {
    let key = match grade {
        1. => "LOC_GOOD",
        2. => "LOC_MODERATE",
        3. => "LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS",
        4. => "LOC_UNHEALTHY",
        5. => "LOC_VERY_UNHEALTHY",
        6. => "LOC_HAZARDOUS",
        _ => return String::new(),
    };
    ts.tr(key)
}
pub fn air_grade_str(unit: &str, grade: f64, ts: Locale) -> String {
    if unit == "airnow" || unit == "aqicn" {
        airnow_grade_str(grade, ts)
    } else {
        airkorea_grade_str(grade, ts)
    }
}
/// `AqiConverter.getActionGuide`; `undefined` for an unmatched grade.
pub fn action_guide(unit: &Val, pollutant: &str, grade: &Val, ts: Locale) -> Val {
    let g = match grade {
        Val::Num(n) if n.fract() == 0. => *n as i64,
        _ => return Val::Undef,
    };
    let dust = matches!(pollutant, "pm25" | "pm10" | "aqi");
    let key = if matches!(unit.str(), Some("aqicn" | "airnow")) {
        match g {
            1 => "LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES",
            2 => "LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL",
            3 if dust => "LOC_SENSITIVE_PEOPLE_WEAR_DUST_MASK",
            3 => "LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL",
            4 if dust => "LOC_WEAR_A_DUST_MASK_WHEN_YOU_GO_OUT",
            4 => "LOC_BE_CAREFUL_OUTDOOR_ACTIVITIES",
            5 => "LOC_DO_NOT_GO_OUT_ON_SENSITIVE_PEOPLE",
            6 => "LOC_DO_NOT_GO_OUT",
            _ => return Val::Undef,
        }
    } else {
        match g {
            1 => "LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES",
            2 if dust || pollutant == "o3" => "LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL",
            2 => "LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES",
            3 if dust => "LOC_WEAR_A_DUST_MASK_WHEN_YOU_GO_OUT",
            3 => "LOC_BE_CAREFUL_OUTDOOR_ACTIVITIES",
            4 => "LOC_DO_NOT_GO_OUT",
            _ => return Val::Undef,
        }
    };
    Val::Str(ts.tr(key))
}

const WEATHER_TYPE_KEYS: [&str; 67] = [
    "LOC_CLEAR",
    "LOC_PARTLY_CLOUDY",
    "LOC_MOSTLY_CLOUDY",
    "LOC_CLOUDY",
    "LOC_MIST",
    "LOC_HAZE",
    "LOC_FOG",
    "LOC_THIN_FOG",
    "LOC_DENSE_FOG",
    "LOC_FOG_STOPPED",
    "LOC_FOG",
    "LOC_PARTLY_FOG",
    "LOC_YELLOW_DUST",
    "LOC_RAIN",
    "LOC_LIGHT_DRIZZLE",
    "LOC_DRIZZLE",
    "LOC_HEAVY_DRIZZLE",
    "LOC_DRIZZLE_STOPPED",
    "LOC_LIGHT_RAIN_AT_TIMES",
    "LOC_LIGHT_RAIN",
    "LOC_RAIN_AT_TIMES",
    "LOC_RAIN",
    "LOC_HEAVY_RAIN_AT_TIMES",
    "LOC_HEAVY_RAIN",
    "LOC_LIGHT_SHOWERS",
    "LOC_SHOWERS",
    "LOC_HEAVY_SHOWERS",
    "LOC_SHOWERS_STOPPED",
    "LOC_RAIN_STOPPED",
    "LOC_LIGHT_SLEET",
    "LOC_HEAVY_SLEET",
    "LOC_SLEET_STOPPED",
    "LOC_LIGHT_SNOW_AT_TIMES",
    "LOC_LIGHT_SNOW",
    "LOC_SNOW_AT_TIMES",
    "LOC_SNOW",
    "LOC_HEAVY_SNOW_AT_TIMES",
    "LOC_HEAVY_SNOW",
    "LOC_LIGHT_SNOW_SHOWERS",
    "LOC_HEAVY_SNOW_SHOWERS",
    "LOC_SNOW_SHOWERS_STOPPED",
    "LOC_SNOW_STOPPED",
    "LOC_LIGHT_SNOW_PELLETS",
    "LOC_HEAVY_SNOW_PELLETS",
    "LOC_LIGHT_SNOW_STORM",
    "LOC_SNOW_STORM",
    "LOC_HEAVY_SNOW_STORM",
    "LOC_POWDER_SNOW",
    "LOC_WATER_SPOUT",
    "LOC_HAIL",
    "LOC_THUNDERSHOWERS",
    "LOC_THUNDERSHOWERS_HAIL",
    "LOC_THUNDERSHOWERS_RAIN_SNOW",
    "LOC_THUNDERSHOWERS_STOPPED_RAIN",
    "LOC_THUNDERSHOWERS_STOPPED_SNOW",
    "LOC_LIGHTNING",
    "LOC_BOLT_FROM_THE_BLUE",
    "LOC_BOLT_STOPPED",
    "LOC_ICE_PELLETS",
    "LOC_BREEZY",
    "LOC_HUMID",
    "LOC_WINDY",
    "LOC_DRY",
    "LOC_VERY_STRONG_WIND",
    "LOC_SLEET",
    "LOC_RAIN",
    "LOC_SNOW",
];
/// `ControllerWeatherDesc.makeWeatherType` for the English summaries produced by the VC path.
/// Err represents the legacy TypeError on a non-string summary.
pub fn weather_type(summary: &Val) -> Result<f64, UnknownUnit> {
    let text = match summary {
        Val::Str(s) => s.clone(),
        // Objects, numbers and booleans have no own `length`: legacy returns -1.
        Val::Num(_) | Val::Bool(_) | Val::Obj(_) | Val::Date(_) => return Ok(-1.),
        // undefined/null receivers and arrays (no toLowerCase) throw a TypeError.
        Val::Undef | Val::Null | Val::Arr(_) => return Err(UnknownUnit),
    };
    if text.is_empty() {
        return Ok(-1.);
    }
    let mut s = text.to_lowercase();
    if s.find("and") != Some(0) {
        s = s.split(" and ").next().unwrap_or("").to_owned();
    }
    let n = match normalize_kma(&s).as_str() {
        "sunny" | "clear" | "맑음" => 0,
        "partly cloudy" | "구름적음" | "구름조금" => 1,
        "mostly cloudy" | "구름많음" => 2,
        "cloudy" | "overcast" | "흐림" => 3,
        "mist" | "박무" => 4,
        "haze" | "연무" => 5,
        "fog" | "안개변화무" => 6,
        "thin fog" | "안개엷어짐" => 7,
        "dense fog" | "foggy" | "안개강해짐" => 8,
        "fog clear" | "안개끝" => 9,
        "시계내안개" => 10,
        "partly fog" | "부분안개" => 11,
        "yellow dust" | "황사" => 12,
        "시계내강수" => 13,
        "light drizzle" | "약한이슬비" => 14,
        "drizzle" | "비/이슬비" | "보통이슬비" => 15,
        "heavy drizzle" | "강한이슬비" => 16,
        "drizzle clear" | "이슬비끝" => 17,
        "light rain at times" | "약한비단속" => 18,
        "possible light rain" | "light rain" | "약한언비" | "약한비계속" => 19,
        "rain at times" | "보통비단속" => 20,
        "rain" | "보통비계속" => 21,
        "heavy rain at times" | "강한비단속" => 22,
        "heavy rain" | "강한비계속" => 23,
        "light showers" | "약한소나기" => 24,
        "showers" | "보통소나기" => 25,
        "heavy showers" | "강한소나기" => 26,
        "showers clear" | "소나기끝" => 27,
        "rain clear" | "비끝남" => 28,
        "light sleet" | "약진눈깨비" | "진눈깨비약" => 29,
        "heavy sleet" | "강진눈깨비" => 30,
        "sleet clear" | "진눈깨비끝" => 31,
        "light snow at times" | "약한눈단속" => 32,
        "possible light snow" | "light snow" | "약한눈계속" => 33,
        "snow at times" | "보통눈단속" => 34,
        "snow" | "보통눈계속" => 35,
        "heavy snow at times" | "강한눈단속" => 36,
        "heavy snow" | "강한눈계속" => 37,
        "light snow showers" | "소낙눈/약" => 38,
        "heavy snow showers" | "소낙눈/강" => 39,
        "snow showers clear" | "소낙눈끝" => 40,
        "snow clear" | "눈끝남" => 41,
        "light snow pellets" | "싸락눈/약" => 42,
        "heavy snow pellets" | "싸락눈/강" => 43,
        "light snowstorm" | "약한눈보라" => 44,
        "snowstorm" | "보통눈보라" => 45,
        "heavy snowstorm" | "강한눈보라" => 46,
        "flurries" | "가루눈" => 47,
        "waterspout" | "용오름" => 48,
        "hail" | "우박" => 49,
        "thundershowers" | "뇌우" => 50,
        "thundershowers hail" | "뇌우,우박" => 51,
        "thundershowers snow/rain" | "thundershowers rain/snow" | "뇌우,눈/비" | "뇌우,비/눈" => {
            52
        }
        "thundershowers clear, rain" | "뇌우끝,비" => 53,
        "thundershowers clear, snow" | "뇌우끝,눈" => 54,
        "lightning" | "번개" => 55,
        "dry lightning" | "마른뇌전" => 56,
        "thunderstorm clear" | "뇌전끝" => 57,
        "ice pellets" | "얼음싸라기" => 58,
        "breezy" => 59,
        "humid" => 60,
        "windy" => 61,
        "dry" => 62,
        "dangerously windy" => 63,
        "sleet" | "진눈깨비" => 64,
        "비" => 65,
        "눈" => 66,
        _ => -1,
    };
    Ok(f64::from(n))
}
fn normalize_kma(s: &str) -> String {
    // The VC path only emits English summaries; KMA wording normalization is identity for them.
    let mut t = s.to_owned();
    if let Some(stripped) = t.strip_suffix("연속적") {
        t = format!("{stripped}계속");
    } else if let Some(stripped) = t.strip_suffix("단속적") {
        t = format!("{stripped}단속");
    }
    if t == "비끝" || t == "눈끝" {
        return t + "남";
    }
    if t == "안개" {
        return "안개변화무".into();
    }
    let prefixes = ["약한", "보통", "강한", ""];
    for p in prefixes {
        for kind in ["이슬비", "진눈깨비", "소나기"] {
            for suffix in ["계속", "단속", ""] {
                if t == format!("{p}{kind}{suffix}") {
                    if kind == "진눈깨비" {
                        return match p {
                            "약한" => "약진눈깨비".into(),
                            "강한" => "강진눈깨비".into(),
                            _ => "진눈깨비".into(),
                        };
                    }
                    return format!("{}{kind}", if p.is_empty() { "보통" } else { p });
                }
            }
        }
    }
    for p in prefixes {
        for kind in ["비", "눈"] {
            for suffix in ["계속", "단속", ""] {
                if t == format!("{p}{kind}{suffix}") && (!p.is_empty() || !suffix.is_empty()) {
                    let p = if p.is_empty() { "보통" } else { p };
                    let suffix = if suffix.is_empty() { "계속" } else { suffix };
                    return format!("{p}{kind}{suffix}");
                }
            }
        }
    }
    t
}
/// `ControllerWeatherDesc.getWeatherStr`.
pub fn weather_str(weather_type: f64, ts: Locale) -> String {
    if weather_type.is_nan() || weather_type < 0. || weather_type.fract() != 0. {
        return String::new();
    }
    WEATHER_TYPE_KEYS
        .get(weather_type as usize)
        .map_or_else(String::new, |k| ts.tr(k))
}
pub fn ultrv_grade(value: f64) -> f64 {
    if value <= 2. {
        0.
    } else if value <= 5. {
        1.
    } else if value <= 7. {
        2.
    } else if value <= 10. {
        3.
    } else {
        4.
    }
}
pub fn ultrv_str(grade: f64, ts: Locale) -> String {
    let key = match grade {
        0. => "LOC_LOW",
        1. => "LOC_NORMAL",
        2. => "LOC_HIGH",
        3. => "LOC_VERY_HIGH",
        4. => "LOC_HAZARD",
        _ => return String::new(),
    };
    ts.tr(key)
}
fn js_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}
/// `WaqiStationName.shorten`.
pub fn shorten_station(name: &str) -> String {
    let trimmed = name.trim_matches(js_ws);
    if trimmed.encode_utf16().count() <= 20 {
        return trimmed.to_owned();
    }
    let mut without = String::new();
    let mut depth_skip = false;
    let chars: Vec<char> = trimmed.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if (c == '(' || c == '（') && !depth_skip {
            // /[(（][^)）]*[)）]/: only a complete parenthesized group is replaced.
            if let Some(end) = chars[i + 1..].iter().position(|&x| x == ')' || x == '）') {
                without.push(' ');
                i += end + 2;
                continue;
            }
            depth_skip = true;
        }
        without.push(c);
        i += 1;
    }
    let first = without
        .split([',', '，', '、'])
        .next()
        .unwrap_or("")
        .to_owned();
    let mut collapsed = String::new();
    let mut prev_ws = false;
    for c in first.chars() {
        if js_ws(c) {
            if !prev_ws {
                collapsed.push(' ');
            }
            prev_ws = true;
        } else {
            collapsed.push(c);
            prev_ws = false;
        }
    }
    let first = collapsed.trim_matches(js_ws).to_owned();
    if first.is_empty() {
        trimmed.to_owned()
    } else {
        first
    }
}
pub fn humidity_icon(reh: &Val) -> String {
    let r = reh.to_number();
    if r == 100. {
        return "humidity_90".into();
    }
    let tens = (r / 10.).trunc() * 10.;
    format!(
        "humidity_{}",
        num_string(if tens == 0. { 0. } else { tens })
    )
}
pub fn wind_dir_name(dir: &Val) -> Val {
    let d = match dir {
        Val::Num(n) => *n,
        _ => return Val::Undef,
    };
    let name = match d {
        0. | 360. => "N",
        22.5 => "NEN",
        45. => "NE",
        67.5 => "ENE",
        90. => "E",
        112.5 => "ESE",
        135. => "ES",
        157.5 => "SES",
        180. => "S",
        202.5 => "SWS",
        225. => "SW",
        247.5 => "WSW",
        270. => "W",
        292.5 => "WNW",
        315. => "WN",
        337.5 => "NWN",
        _ => return Val::Undef,
    };
    Val::Str(name.into())
}

/// `observations.canCompare` for rows without history-source annotations.
fn can_compare(current: &Obj, yesterday: Option<&Obj>) -> bool {
    let Some(y) = yesterday else { return false };
    if y.get("missing").truthy() || matches!(y.get("comparisonAvailable"), Val::Bool(false)) {
        return false;
    }
    let (Some(a), Some(b)) = (current.get("t1h").num(), y.get("t1h").num()) else {
        return false;
    };
    if !a.is_finite() || !b.is_finite() {
        return false;
    }
    if matches!(y.get("comparisonAvailable"), Val::Bool(true)) {
        return true;
    }
    let valid = |v: f64| (-50. ..=60.).contains(&v) && v > -50.;
    if !valid(a) || !valid(b) {
        return false;
    }
    let source = |o: &Obj| {
        o.get("fieldObservations").get("t1h").truthy()
            || o.get("historyObservation").get("fields").truthy()
    };
    // History-sourced pairs never occur on world rows; keep the legacy outcome for none.
    !source(current) && !source(y)
}
fn diff_today_yesterday(current: &Obj, yesterday: &Obj, ts: Locale) -> (String, f64) {
    let same = ts.tr("LOC_SIMILAR_TO_YESTERDAY");
    let than = ts.tr("LOC_THAN_YESTERDAY");
    let d = current.get("t1h").to_number() - yesterday.get("t1h").to_number();
    let grade = round(d.abs());
    let diff = round(d);
    if diff == 0. {
        return (same, grade);
    }
    let temp = if diff > 0. {
        format!("+{}", num_string(diff))
    } else {
        num_string(diff)
    };
    (than.replacen("%s", &temp, 1), grade)
}
fn has_weather_text(current: &Obj) -> bool {
    current.get("weatherType").to_number() >= 0.
        && current.get("weather").str().is_some_and(|s| !s.is_empty())
}
struct Item {
    text: String,
    grade: f64,
}
fn ordered(mut items: Vec<Item>) -> String {
    js_sort(&mut items, |a, b| {
        if a.grade > b.grade {
            -1
        } else if a.grade < b.grade {
            1
        } else {
            0
        }
    });
    match items.len() {
        0 => String::new(),
        1 => items.remove(0).text,
        _ => format!("{}, {}", items[0].text, items[1].text),
    }
}
fn strict_ne(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Num(x), Val::Num(y)) => x != y || x.is_nan(),
        (Val::Str(x), Val::Str(y)) => x != y,
        (Val::Bool(x), Val::Bool(y)) => x != y,
        (Val::Undef, Val::Undef) | (Val::Null, Val::Null) => false,
        _ => true,
    }
}
fn rain_item(current: &mut Obj, units: &Obj, ts: Locale) -> Option<Item> {
    if !(current.get("rn1").truthy() && current.get("pty").truthy()) {
        return None;
    }
    let pty = current.get("pty").to_number();
    let label = if pty == 1. {
        ts.tr("LOC_RAINFALL")
    } else if pty == 2. {
        ts.tr("LOC_PRECIPITATION")
    } else if pty == 3. {
        ts.tr("LOC_SNOWFALL")
    } else {
        String::new()
    };
    current.set("ptyStr", label.clone());
    let rn1 = current.get("rn1").clone();
    let rn1_str = format!(
        "{}{}",
        js_string(&rn1),
        js_string(units.get("precipitationUnit"))
    );
    current.set("rn1Str", rn1_str.clone());
    Some(Item {
        text: format!("{label} {rn1_str}"),
        grade: rn1.to_number() + 3.,
    })
}
fn feels_item(current: &Obj, ts: Locale) -> Option<Item> {
    let s = current.get("sensorytem");
    if !(s.truthy() && strict_ne(s, current.get("t1h"))) {
        return None;
    }
    let diff = round(s.to_number() - current.get("t1h").to_number());
    Some(Item {
        text: format!("{} {}˚", ts.tr("LOC_FEELS_LIKE"), js_string(s)),
        grade: diff.abs(),
    })
}
/// `ControllerTown24h.makeSummaryWeather`.
pub fn summary_weather(
    current: &mut Obj,
    yesterday: Option<&Obj>,
    units: &Obj,
    ts: Locale,
) -> String {
    let mut items = Vec::new();
    if can_compare(current, yesterday)
        && let Some(y) = yesterday
    {
        let (text, grade) = diff_today_yesterday(current, y, ts);
        items.push(Item {
            text,
            grade: if grade <= 2. { 2.5 } else { grade },
        });
    }
    if has_weather_text(current) {
        items.push(Item {
            text: current.get("weather").str().unwrap_or("").to_owned(),
            grade: if current.get("weatherType").to_number() > 3. {
                3.
            } else {
                2.5
            },
        });
    }
    items.extend(rain_item(current, units, ts));
    items.extend(feels_item(current, ts));
    if current.get("ultrv").truthy() && current.get("time").to_number() <= 15. {
        let mut grade = current.get("ultrvGrade").to_number();
        if current.get("time").to_number() >= 11. {
            grade += 1.;
        }
        items.push(Item {
            text: format!("{} {}", ts.tr("LOC_UV"), js_string(current.get("ultrvStr"))),
            grade,
        });
    }
    ordered(items)
}
fn alias(air: &mut Obj, name: &str) {
    let khai = air.get(&format!("khai{name}")).clone();
    let value = if khai.truthy() {
        khai
    } else {
        air.get(&format!("aqi{name}")).clone()
    };
    air.set(&format!("aqi{name}"), value);
}
/// `ControllerTown24h.makeSummaryAir`; mutates `arpltn` like the legacy code.
pub fn summary_air(current: &mut Obj, ts: Locale) -> String {
    let Some(air) = current.get_mut("arpltn").and_then(Val::obj_mut) else {
        return String::new();
    };
    alias(air, "Value");
    alias(air, "Grade");
    alias(air, "Str");
    let mut max = 0.;
    for (k, v) in air.entries() {
        if k.contains("Grade") && !k.contains("Grade24") && v.to_number() > max {
            max = v.to_number();
        }
    }
    if max <= 0. {
        return String::new();
    }
    if max == 1. {
        return ts.tr("LOC_AIR_QUALITY_IS_GOOD");
    }
    if max == 2. {
        return ts.tr("LOC_AIR_QUALITY_IS_MODERATE");
    }
    let mut items = Vec::new();
    let line = |label: &str, code: &str| Item {
        text: format!(
            "{} {} {}",
            ts.tr(label),
            js_string(air.get(&format!("{code}Value"))),
            js_string(air.get(&format!("{code}Str")))
        ),
        grade: air.get(&format!("{code}Index")).to_number(),
    };
    for (label, code, field) in [
        ("LOC_PM25", "pm25", "Value"),
        ("LOC_PM10", "pm10", "Value"),
        ("LOC_O3", "o3", "Value"),
        ("LOC_NO2", "no2", "Grade"),
        ("LOC_SO2", "so2", "Grade"),
        ("LOC_CO", "co", "Grade"),
    ] {
        if air.get(&format!("{code}{field}")).truthy() {
            items.push(line(label, code));
        }
    }
    js_sort(&mut items, |a, b| {
        if a.grade > b.grade {
            -1
        } else if a.grade < b.grade {
            1
        } else {
            0
        }
    });
    items
        .into_iter()
        .next()
        .map_or_else(String::new, |i| i.text)
}
/// `ControllerTown.makeSummary`; mutates `arpltn` like the legacy code.
pub fn summary(current: &mut Obj, yesterday: Option<&Obj>, units: &Obj, ts: Locale) -> String {
    let mut items = Vec::new();
    if can_compare(current, yesterday)
        && let Some(y) = yesterday
    {
        let (text, grade) = diff_today_yesterday(current, y, ts);
        items.push(Item {
            text,
            grade: if grade <= 2. { 2.5 } else { grade },
        });
    }
    if has_weather_text(current) {
        items.push(Item {
            text: current.get("weather").str().unwrap_or("").to_owned(),
            grade: if current.get("weatherType").to_number() > 3. {
                3.
            } else {
                2.5
            },
        });
    }
    let mut detached = Obj::new();
    let air = match current.get_mut("arpltn").and_then(Val::obj_mut) {
        Some(a) => a,
        None => &mut detached,
    };
    alias(air, "Grade");
    alias(air, "Str");
    let mut grade = 0.;
    let mut text = String::new();
    if air.get("pm25Grade").truthy() {
        grade = air.get("pm25Grade").to_number();
        text = format!("{} {}", ts.tr("LOC_PM25"), js_string(air.get("pm25Str")));
    }
    if air.get("pm10Grade").truthy() && grade < air.get("pm10Grade").to_number() {
        grade = air.get("pm10Grade").to_number();
        text = format!("{} {}", ts.tr("LOC_PM10"), js_string(air.get("pm10Str")));
    }
    if air.get("aqiGrade").truthy() && grade < air.get("aqiGrade").to_number() {
        grade = air.get("aqiGrade").to_number();
        text = format!("{} {}", ts.tr("LOC_AQI"), js_string(air.get("aqiStr")));
    }
    if grade > 0. {
        items.push(Item { text, grade });
    }
    items.extend(rain_item(current, units, ts));
    items.extend(feels_item(current, ts));
    let time = match current.get("time") {
        Val::Str(s) => super::js::string_to_number(s) / 100.,
        other => other.to_number(),
    };
    if current.get("ultrv").truthy() && time <= 15. {
        let mut g = current.get("ultrvGrade").to_number();
        if current.get("time").to_number() >= 11. {
            g += 1.;
        }
        items.push(Item {
            text: format!("{} {}", ts.tr("LOC_UV"), js_string(current.get("ultrvStr"))),
            grade: g,
        });
    }
    ordered(items)
}
