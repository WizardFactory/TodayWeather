//! Official Korean almanac (월력요항) archive locator, gazette parser, and HTTP fetcher.

use super::calendar::{
    CalendarError, EditionRecord, NAMES, is_gazette_id, iso_date, sha256_hex, validate_edition,
};
use super::pdf::{self, MAX_PDF_BYTES};
use crate::gateway::BoxFuture;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::Instant;

pub const ARCHIVE_BASE: &str = "https://astro.kasi.re.kr/kor/life/post/almanac?search_year=";
pub const GAZETTE_ORIGIN: &str = "https://www.gwanbo.go.kr";
const GAZETTE_ALT_ORIGIN: &str = "https://gwanbo.go.kr";
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocatedEdition {
    pub source_url: String,
    pub toc_id: String,
}

#[derive(Clone, Debug)]
pub struct FetchedEdition {
    pub edition: EditionRecord,
    pub pdf: Vec<u8>,
}

/// Injectable HTTP transport for official archive/gazette retrieval (offline tests inject doubles).
pub trait HttpFetcher: Send + Sync {
    fn get_bytes(
        &self,
        url: &str,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, CalendarError>>;
    fn post_form(
        &self,
        url: &str,
        form: &str,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, CalendarError>>;
}

/// High-level official edition source (tests may stub this directly or inject `HttpFetcher`).
pub trait OfficialSource: Send + Sync {
    fn fetch_edition(
        &self,
        year: i32,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<FetchedEdition, CalendarError>>;
}

pub struct ReqwestFetcher {
    client: reqwest::Client,
}

impl ReqwestFetcher {
    pub fn new() -> Result<Self, CalendarError> {
        let client = crate::dns::client()
            .timeout(FETCH_TIMEOUT)
            .user_agent("TodayWeather/1.0")
            .build()
            .map_err(|e| CalendarError(format!("HTTP client build failed: {e}")))?;
        Ok(Self { client })
    }

    async fn read_bounded(
        &self,
        request: reqwest::RequestBuilder,
        deadline: Instant,
    ) -> Result<Vec<u8>, CalendarError> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(CalendarError("Official source timeout".into()));
        }
        let mut resp = tokio::time::timeout(remaining, request.send())
            .await
            .map_err(|_| CalendarError("Official source timeout".into()))?
            .map_err(|e| CalendarError(format!("Official source request failed: {e}")))?;
        if resp.status() != reqwest::StatusCode::OK {
            return Err(CalendarError(format!(
                "Official source HTTP {}",
                resp.status().as_u16()
            )));
        }
        let mut buf = Vec::new();
        while let Some(chunk) = tokio::time::timeout_at(deadline, resp.chunk())
            .await
            .map_err(|_| CalendarError("Official source timeout".into()))?
            .map_err(|e| CalendarError(format!("Official source read failed: {e}")))?
        {
            if buf.len() + chunk.len() > MAX_PDF_BYTES {
                return Err(CalendarError("Official document exceeds size limit".into()));
            }
            buf.extend_from_slice(&chunk);
        }
        Ok(buf)
    }
}

impl HttpFetcher for ReqwestFetcher {
    fn get_bytes(
        &self,
        url: &str,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, CalendarError>> {
        let url = url.to_owned();
        Box::pin(async move {
            let req = self.client.get(&url).header("Accept", "*/*");
            self.read_bounded(req, deadline).await
        })
    }

    fn post_form(
        &self,
        url: &str,
        form: &str,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, CalendarError>> {
        let url = url.to_owned();
        let form = form.to_owned();
        Box::pin(async move {
            let req = self
                .client
                .post(&url)
                .header("Accept", "*/*")
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(form);
            self.read_bounded(req, deadline).await
        })
    }
}

pub struct GazetteSource<F> {
    fetcher: F,
    archive_base: String,
    gazette_origin: String,
}

impl<F: HttpFetcher> GazetteSource<F> {
    pub fn new(fetcher: F) -> Self {
        Self {
            fetcher,
            archive_base: ARCHIVE_BASE.to_owned(),
            gazette_origin: GAZETTE_ORIGIN.to_owned(),
        }
    }

    pub fn with_endpoints(fetcher: F, archive_base: String, gazette_origin: String) -> Self {
        Self {
            fetcher,
            archive_base,
            gazette_origin,
        }
    }
}

impl<F: HttpFetcher + 'static> OfficialSource for GazetteSource<F> {
    fn fetch_edition(
        &self,
        year: i32,
        deadline: Instant,
    ) -> BoxFuture<'_, Result<FetchedEdition, CalendarError>> {
        Box::pin(async move {
            let html_bytes = self
                .fetcher
                .get_bytes(&format!("{}{year}", self.archive_base), deadline)
                .await?;
            let html = String::from_utf8_lossy(&html_bytes);
            let located = locate_edition(&html, year)?;
            let pdf = self
                .fetcher
                .post_form(
                    &format!("{}/user/common/ofcttCntntDownload.do", self.gazette_origin),
                    &format!("cntnt_seq_no={}", located.toc_id),
                    deadline,
                )
                .await?;
            let digest = sha256_hex(&pdf);
            let text = pdf::extract_text(&pdf)
                .map_err(|e| CalendarError(format!("Failed to extract almanac table: {e}")))?;
            let edition = parse_edition(year, &located.source_url, &digest, &text)?;
            Ok(FetchedEdition { edition, pdf })
        })
    }
}

/// Locate the canonical electronic gazette viewer URL and download `tocId` in KASI archive HTML.
pub fn locate_edition(html: &str, year: i32) -> Result<LocatedEdition, CalendarError> {
    if !contains_year_heading(html, year) {
        return Err(CalendarError(format!(
            "Official edition unavailable for {year}"
        )));
    }
    let lower = html.to_ascii_lowercase();
    let mut search = 0;
    let button_tag = loop {
        let Some(rel) = lower[search..].find("<button") else {
            return Err(CalendarError("Missing gazette link".into()));
        };
        let start = search + rel;
        let Some(end_rel) = html[start..].find('>') else {
            return Err(CalendarError("Missing gazette link".into()));
        };
        let tag = &html[start..=start + end_rel];
        if tag.contains("id=\"gwanboLink\"") || tag.contains("id='gwanboLink'") {
            break tag;
        }
        search = start + end_rel + 1;
    };

    let marker = "window.open('";
    let Some(pos) = button_tag.find(marker) else {
        return Err(CalendarError("Missing gazette link".into()));
    };
    let rest = &button_tag[pos + marker.len()..];
    let Some(end) = rest.find('\'') else {
        return Err(CalendarError("Missing gazette link".into()));
    };
    let raw_url = rest[..end].replace("&amp;", "&");
    let parsed =
        reqwest::Url::parse(&raw_url).map_err(|_| CalendarError("Invalid gazette link".into()))?;
    let origin = parsed.origin().ascii_serialization();
    if (origin != GAZETTE_ORIGIN && origin != GAZETTE_ALT_ORIGIN)
        || parsed.path() != "/ezpdf/customLayout.jsp"
    {
        return Err(CalendarError("Invalid gazette link".into()));
    }
    let mut content_id = None;
    let mut toc_id = None;
    for (k, v) in parsed.query_pairs() {
        if k == "contentId" {
            content_id = Some(v.into_owned());
        } else if k == "tocId" {
            toc_id = Some(v.into_owned());
        }
    }
    let (Some(content), Some(toc)) = (content_id, toc_id) else {
        return Err(CalendarError("Invalid gazette link".into()));
    };
    if !valid_gwanbo_token(&content) || !valid_gwanbo_token(&toc) {
        return Err(CalendarError("Invalid gazette link".into()));
    }
    Ok(LocatedEdition {
        source_url: format!(
            "{GAZETTE_ORIGIN}/ezpdf/customLayout.jsp?contentId={content}&tocId={toc}&isTocOrder=N"
        ),
        toc_id: toc,
    })
}

fn valid_gwanbo_token(token: &str) -> bool {
    is_gazette_id(token) && (16..=41).contains(&token.len())
}

fn contains_year_heading(html: &str, year: i32) -> bool {
    let needle = format!("{year}년");
    let mut pos = 0;
    while let Some(rel) = html[pos..].find(&needle) {
        let start = pos + rel;
        let before = &html[..start];
        let after_year = &html[start + needle.len()..];
        let trimmed_after = after_year.trim_start();
        if let Some(after_title) = trimmed_after.strip_prefix("월력요항") {
            let left_ok = before.trim_end().is_empty() || before.trim_end().ends_with('>');
            let right_ok =
                after_title.trim_start().is_empty() || after_title.trim_start().starts_with('<');
            if left_ok && right_ok {
                return true;
            }
        }
        pos = start + needle.len();
    }
    false
}

/// Parse an extracted gazette text into a validated [`EditionRecord`].
pub fn parse_edition(
    year: i32,
    source_url: &str,
    source_digest: &str,
    text: &str,
) -> Result<EditionRecord, CalendarError> {
    let header: String = text.chars().take(1200).collect();
    let (notice_year, notice_serial) = parse_notice_id(&header)
        .ok_or_else(|| CalendarError("Missing official almanac identity or table".into()))?;
    let publication_date = parse_korean_date(&header)
        .ok_or_else(|| CalendarError("Missing official almanac identity or table".into()))?;
    if !contains_year_title(&header, year) {
        return Err(CalendarError(
            "Missing official almanac identity or table".into(),
        ));
    }
    let table = extract_solar_table(text)
        .ok_or_else(|| CalendarError("Missing official almanac identity or table".into()))?;

    let mut dates: HashMap<String, String> = HashMap::with_capacity(24);
    for line in table.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((n1, m1, d1, n2, m2, d2)) = parse_table_row(trimmed) {
            for (name, month, day) in [(n1, m1, d1), (n2, m2, d2)] {
                if !NAMES.contains(&name.as_str()) || dates.contains_key(&name) {
                    return Err(CalendarError("Duplicate or unknown term in gazette".into()));
                }
                dates.insert(name, iso_date(year, month, day)?);
            }
        } else if trimmed.bytes().any(|b| b.is_ascii_digit()) {
            return Err(CalendarError("Unexpected almanac table row".into()));
        }
    }

    let ordered_dates: Vec<String> = NAMES
        .iter()
        .map(|name| {
            dates
                .get(*name)
                .cloned()
                .ok_or_else(|| CalendarError("Incomplete official almanac".into()))
        })
        .collect::<Result<_, _>>()?;

    let padded_serial = format!("{notice_serial:0>9}");
    let edition = EditionRecord {
        year,
        id: format!("{notice_year}-{notice_serial}"),
        order: format!("{publication_date}/{padded_serial}"),
        publication_date,
        source_url: source_url.to_owned(),
        source_digest: source_digest.to_owned(),
        dates: ordered_dates,
    };
    validate_edition(&edition)?;
    Ok(edition)
}

fn contains_year_title(header: &str, year: i32) -> bool {
    let needle = format!("{year}년");
    let mut pos = 0;
    while let Some(rel) = header[pos..].find(&needle) {
        let after = header[pos + rel + needle.len()..].trim_start();
        if after.starts_with("월력요항") {
            return true;
        }
        pos += rel + needle.len();
    }
    false
}

fn parse_notice_id(header: &str) -> Option<(String, String)> {
    for publisher in ["우주항공청", "과학기술정보통신부"] {
        let mut pos = 0;
        while let Some(rel) = header[pos..].find(publisher) {
            let after_pub = header[pos + rel + publisher.len()..].trim_start();
            if let Some(after_gonggo) = after_pub.strip_prefix("공고") {
                let after_je = after_gonggo.trim_start();
                if let Some(rest) = after_je.strip_prefix('제') {
                    let rest = rest.trim_start();
                    let year_digits: String =
                        rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if year_digits.len() == 4 {
                        let after_y = rest[year_digits.len()..].trim_start();
                        let dash_len = if after_y.starts_with('-') {
                            1
                        } else if after_y.starts_with('–') {
                            '–'.len_utf8()
                        } else {
                            0
                        };
                        if dash_len > 0 {
                            let after_d = after_y[dash_len..].trim_start();
                            let serial: String =
                                after_d.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if !serial.is_empty() && serial.len() <= 8 {
                                let after_s = after_d[serial.len()..].trim_start();
                                if after_s.starts_with('호') {
                                    return Some((year_digits, serial));
                                }
                            }
                        }
                    }
                }
            }
            pos += rel + publisher.len();
        }
    }
    None
}

fn parse_korean_date(header: &str) -> Option<String> {
    let bytes = header.as_bytes();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if bytes[i..i + 4].iter().all(u8::is_ascii_digit) {
            let before_digit = i > 0 && bytes[i - 1].is_ascii_digit();
            if !before_digit && let Some(after_year) = header[i + 4..].strip_prefix('년') {
                let rest = after_year.trim_start();
                let m_digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if (1..=2).contains(&m_digits.len())
                    && let Some(after_m) = rest[m_digits.len()..].strip_prefix('월')
                {
                    let rest2 = after_m.trim_start();
                    let d_digits: String =
                        rest2.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if (1..=2).contains(&d_digits.len())
                        && rest2[d_digits.len()..].starts_with('일')
                    {
                        let y: i32 = header[i..i + 4].parse().ok()?;
                        let m: u8 = m_digits.parse().ok()?;
                        let d: u8 = d_digits.parse().ok()?;
                        return iso_date(y, m, d).ok();
                    }
                }
            }
        }
        i += 1;
    }
    None
}

fn extract_solar_table(text: &str) -> Option<&str> {
    let mut pos = 0;
    while let Some(rel) = text[pos..].find('□') {
        let start = pos + rel + '□'.len_utf8();
        let after = text[start..].trim_start();
        if let Some(after_24) = after.strip_prefix("24") {
            let after_24 = after_24.trim_start();
            if let Some(rest) = after_24.strip_prefix("절기") {
                let end = rest.find('□').unwrap_or(rest.len());
                return Some(&rest[..end]);
            }
        }
        pos = start;
    }
    None
}

fn is_hangul_syllable(ch: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&ch)
}

fn parse_table_row(line: &str) -> Option<(String, u8, u8, String, u8, u8)> {
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let (name1, idx) = consume_two_hangul(&tokens, 0)?;
    let (m1, d1) = parse_md(tokens.get(idx)?, tokens.get(idx + 1)?)?;
    let (name2, idx2) = consume_two_hangul(&tokens, idx + 2)?;
    let (m2, d2) = parse_md(tokens.get(idx2)?, tokens.get(idx2 + 1)?)?;
    if idx2 + 2 != tokens.len() {
        return None;
    }
    Some((name1, m1, d1, name2, m2, d2))
}

fn consume_two_hangul(tokens: &[&str], idx: usize) -> Option<(String, usize)> {
    let first = *tokens.get(idx)?;
    let chars: Vec<char> = first.chars().collect();
    if chars.len() == 2 && chars.iter().all(|&c| is_hangul_syllable(c)) {
        return Some((first.to_owned(), idx + 1));
    }
    if chars.len() == 1 && is_hangul_syllable(chars[0]) {
        let second = *tokens.get(idx + 1)?;
        let chars2: Vec<char> = second.chars().collect();
        if chars2.len() == 1 && is_hangul_syllable(chars2[0]) {
            return Some((format!("{}{}", chars[0], chars2[0]), idx + 2));
        }
    }
    None
}

fn parse_md(m_tok: &str, d_tok: &str) -> Option<(u8, u8)> {
    if !(1..=2).contains(&m_tok.len())
        || !m_tok.bytes().all(|b| b.is_ascii_digit())
        || !(1..=2).contains(&d_tok.len())
        || !d_tok.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    Some((m_tok.parse().ok()?, d_tok.parse().ok()?))
}
