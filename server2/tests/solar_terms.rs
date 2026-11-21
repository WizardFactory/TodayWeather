//! Offline verification suite for #3086 (server2 Korean 24 solar-term calendar,
//! S3 official almanac reconciliation, and v000903 domestic ranked summary parity).

use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use flate2::Compression;
use flate2::write::ZlibEncoder;
use server2::domestic::kma::{
    AssemblyConfig, DbVersion, KmaRequest, KmaStore, MidModel, Outcome, StoreError, StoreResult,
    TownModel, assemble_with_solar_terms,
};
use server2::gateway::{BoxFuture, OrderedJson};
use server2::history::IndexListing;
use server2::solar_terms::api::{CalendarApi, router};
use server2::solar_terms::calendar::{
    Calendar, CalendarError, NAMES, Status, TermEntry, bundled_seeds, calculate, check_years,
    future_years_from_var, iso_date, kst_midnight_ms, minutes_from_kst_midnight, sha256_hex,
};
use server2::solar_terms::official::{
    FetchedEdition, GazetteSource, HttpFetcher, OfficialSource, locate_edition, parse_edition,
};
use server2::solar_terms::pdf;
use server2::solar_terms::store::{MemoryLookup, Service, Store, StoreError as SolarStoreError};
use server2::solar_terms::summary::{
    CurrentSnapshot, DailyRange, GasItem, ItemKind, Labels, Policy, SummaryItem, WarningItem,
    remaining_seconds, select, summary_cache_age,
};
use server2::storage::{
    CatalogTransport, ControlObject, Error as StorageError, ListPage, Object, ObjectTransport,
    PreparedRecord, WriteCondition,
};
use server2::world::i18n::{self, Locale};
use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::Instant;
use tower::ServiceExt;

const FIXTURE_2024: &str = include_str!("solar_terms/fixtures/2024.txt");
const FIXTURE_2027: &str = include_str!("solar_terms/fixtures/2027.txt");
const PARITY_FIXTURE: &str = include_str!("solar_terms/fixtures/server1-parity.json");
const URL_2024: &str = "https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001687328191439000&tocId=I0000000000000001686831567351000&isTocOrder=N";
const URL_2027: &str = "https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001782374733940000&tocId=I0000000000000001782199865342000&isTocOrder=N";

/// Official 2025 dates from KASA Notice 2024-1 (published 2024-06-20).
const OFFICIAL_2025_DATES: [&str; 24] = [
    "2025-01-05",
    "2025-01-20",
    "2025-02-03",
    "2025-02-18",
    "2025-03-05",
    "2025-03-20",
    "2025-04-04",
    "2025-04-20",
    "2025-05-05",
    "2025-05-21",
    "2025-06-05",
    "2025-06-21",
    "2025-07-07",
    "2025-07-22",
    "2025-08-07",
    "2025-08-23",
    "2025-09-07",
    "2025-09-23",
    "2025-10-08",
    "2025-10-23",
    "2025-11-07",
    "2025-11-22",
    "2025-12-07",
    "2025-12-22",
];

fn utc_ms(iso: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(iso)
        .unwrap()
        .timestamp_millis()
}

fn utc_date(ms: i64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp(ms.div_euclid(1000)).unwrap();
    format!(
        "{:04}-{:02}-{:02}",
        dt.year(),
        u8::from(dt.month()),
        dt.day()
    )
}

#[test]
fn astronomy_matches_all_96_official_dates_2024_to_2027_and_51_year_horizon() {
    // 2024 (leap year + spaced Hangul layout fixture)
    let calc_2024 = calculate(2024).unwrap();
    let ed_2024 = parse_edition(2024, URL_2024, &"1".repeat(64), FIXTURE_2024).unwrap();
    let dates_2024: Vec<String> = calc_2024.iter().map(|t| t.date.clone()).collect();
    assert_eq!(dates_2024, ed_2024.dates);

    // 360° wraparound & UTC-vs-KST date crossing
    let chunbun = calc_2024.iter().find(|t| t.id == "solar-0").unwrap();
    assert_eq!(chunbun.name_ko, "춘분");
    assert_eq!(chunbun.date, "2024-03-20");
    assert!(
        calc_2024.iter().any(|t| utc_date(t.utc_ms) != t.date),
        "expected at least one crossing whose UTC date differs from its KST civil date"
    );

    // 2025 (official KASA Notice 2024-1)
    let calc_2025: Vec<String> = calculate(2025)
        .unwrap()
        .into_iter()
        .map(|t| t.date)
        .collect();
    assert_eq!(
        calc_2025,
        OFFICIAL_2025_DATES
            .iter()
            .map(|s| (*s).to_owned())
            .collect::<Vec<_>>()
    );

    // 2026 & 2027 bundled verified seeds (all 48 dates)
    let seeds = bundled_seeds().unwrap();
    assert_eq!(seeds.len(), 2);
    for seed in &seeds {
        let calc = calculate(seed.year).unwrap();
        let got: Vec<String> = calc.iter().map(|t| t.date.clone()).collect();
        assert_eq!(got, seed.dates, "year {}", seed.year);
    }

    // Near-midnight crossing screening (< 20 minutes from KST midnight) matches official row
    let near = seeds
        .iter()
        .flat_map(|seed| {
            calculate(seed.year)
                .unwrap()
                .into_iter()
                .zip(seed.dates.iter().cloned())
        })
        .find(|(term, _)| minutes_from_kst_midnight(term.utc_ms) < 20.0);
    let (near_term, official_date) = near.expect("expected a near-midnight crossing in 2026-2027");
    assert_eq!(near_term.date, official_date);

    // 51-year rolling horizon (2026..=2076): unique IDs/names, sorted dates within year
    let clock = Arc::new(|| utc_ms("2026-02-01T00:00:00Z"));
    let cal = Calendar::new(clock, 50, &[]).unwrap();
    for year in 2026..=2076 {
        let snap = cal.read_year(year).expect("in-range year");
        assert_eq!(snap.terms.len(), 24);
        assert_eq!(
            snap.terms
                .iter()
                .map(|t| &t.id)
                .collect::<HashSet<_>>()
                .len(),
            24
        );
        assert_eq!(
            snap.terms
                .iter()
                .map(|t| &t.name_ko)
                .collect::<HashSet<_>>()
                .len(),
            24
        );
        let dates: Vec<&str> = snap.terms.iter().map(|t| t.date.as_str()).collect();
        let mut sorted = dates.clone();
        sorted.sort();
        assert_eq!(dates, sorted);
        assert!(dates.iter().all(|d| d.starts_with(&format!("{year}-"))));
    }
    assert!(cal.read_year(2077).is_none());

    // Environment horizon validation
    assert_eq!(future_years_from_var(&|_| Some("51".into())), (20, true));
    assert_eq!(
        future_years_from_var(&|_| Some("invalid".into())),
        (20, true)
    );
    assert_eq!(future_years_from_var(&|_| Some("50".into())), (50, false));
    assert_eq!(future_years_from_var(&|_| None), (20, false));
    assert!(Calendar::new(Arc::new(|| utc_ms("2026-02-01T00:00:00Z")), 51, &[]).is_err());
}

/// Build a valid synthetic `%PDF-1.4` containing a FlateDecode content stream and `/ToUnicode`
/// CMap representing the given lines (matching the Korean electronic gazette PDF format).
fn build_synthetic_gazette_pdf(text: &str) -> Vec<u8> {
    let mut chars: Vec<char> = text.chars().collect::<HashSet<_>>().into_iter().collect();
    chars.sort();
    let mut char_to_gid = BTreeMap::new();
    let mut bfchar = String::new();
    for (idx, ch) in chars.iter().enumerate() {
        let gid = (idx as u16) + 1;
        char_to_gid.insert(*ch, gid);
        let code = *ch as u32;
        bfchar.push_str(&format!("<{gid:04X}> <{code:04X}>\n"));
    }
    let cmap_lines = [
        "/CIDInit /ProcSet findresource begin".to_owned(),
        "12 dict begin begincmap".to_owned(),
        "1 begincodespacerange".to_owned(),
        "<0000> <FFFF>".to_owned(),
        "endcodespacerange".to_owned(),
        format!("{} beginbfchar", chars.len()),
        bfchar,
        "endbfchar".to_owned(),
        "endcmap".to_owned(),
        "end end".to_owned(),
    ];
    let cmap = cmap_lines.join("\n");
    let mut content = String::new();
    let mut y = 760.0_f64;
    for line in text.lines() {
        let mut x = 40.0_f64;
        content.push_str("BT /F1 10 Tf ");
        for ch in line.chars() {
            if ch == ' ' {
                x += 6.0;
                continue;
            }
            let gid = char_to_gid[&ch];
            content.push_str(&format!("1 0 0 1 {x:.1} {y:.1} Tm <{gid:04X}> Tj "));
            x += if (ch as u32) > 127 { 10.0 } else { 5.5 };
        }
        content.push_str("ET\n");
        y -= 14.0;
    }
    let compress = |raw: &[u8]| {
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(raw).unwrap();
        enc.finish().unwrap()
    };
    let cmap_gz = compress(cmap.as_bytes());
    let content_gz = compress(content.as_bytes());

    let mut pdf = Vec::new();
    let push_line = |buf: &mut Vec<u8>, line: &str| {
        buf.extend_from_slice(line.as_bytes());
        buf.push(b'\n');
    };
    push_line(&mut pdf, "%PDF-1.4");
    push_line(&mut pdf, "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
    push_line(
        &mut pdf,
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    );
    push_line(
        &mut pdf,
        "3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >> endobj",
    );
    push_line(
        &mut pdf,
        "4 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >> endobj",
    );
    push_line(
        &mut pdf,
        &format!(
            "5 0 obj << /Filter /FlateDecode /Length {} >> stream",
            cmap_gz.len()
        ),
    );
    pdf.extend_from_slice(&cmap_gz);
    pdf.push(b'\n');
    push_line(&mut pdf, "endstream endobj");
    push_line(
        &mut pdf,
        &format!(
            "6 0 obj << /Filter /FlateDecode /Length {} >> stream",
            content_gz.len()
        ),
    );
    pdf.extend_from_slice(&content_gz);
    pdf.push(b'\n');
    push_line(&mut pdf, "endstream endobj");
    push_line(&mut pdf, "%%EOF");
    pdf
}

type CallLog = Arc<Mutex<Vec<(String, Option<String>)>>>;

struct StubFetcher {
    html: Vec<u8>,
    pdf: Vec<u8>,
    calls: CallLog,
}

impl HttpFetcher for StubFetcher {
    fn get_bytes(
        &self,
        url: &str,
        _deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, CalendarError>> {
        let url = url.to_owned();
        let html = self.html.clone();
        let calls = Arc::clone(&self.calls);
        Box::pin(async move {
            calls.lock().unwrap().push((url, None));
            Ok(html)
        })
    }

    fn post_form(
        &self,
        url: &str,
        form: &str,
        _deadline: Instant,
    ) -> BoxFuture<'_, Result<Vec<u8>, CalendarError>> {
        let url = url.to_owned();
        let form = form.to_owned();
        let pdf = self.pdf.clone();
        let calls = Arc::clone(&self.calls);
        Box::pin(async move {
            calls.lock().unwrap().push((url, Some(form)));
            Ok(pdf)
        })
    }
}

#[tokio::test]
async fn pure_rust_pdf_extraction_and_official_parser_validation() {
    // Round-trip synthetic %PDF-1.4 with FlateDecode + Korean ToUnicode CMap
    let pdf_bytes = build_synthetic_gazette_pdf(FIXTURE_2027);
    let extracted = pdf::extract_text(&pdf_bytes).unwrap();
    let digest = sha256_hex(&pdf_bytes);
    let edition = parse_edition(2027, URL_2027, &digest, &extracted).unwrap();
    assert_eq!(edition.id, "2026-0078");
    assert_eq!(edition.publication_date, "2026-06-29");
    assert_eq!(edition.dates.len(), 24);
    assert_eq!(edition.dates[2], "2027-02-04");

    // Non-PDF bytes rejected
    assert!(pdf::extract_text(b"not a pdf").is_err());

    // Archive HTML locator checks
    let markup = format!(
        r#"<h3>2027년 월력요항</h3><button id="gwanboLink" onclick="window.open('{URL_2027}')">"#
    );
    let located = locate_edition(&markup, 2027).unwrap();
    assert_eq!(located.source_url, URL_2027);
    assert!(locate_edition(&markup, 2028).is_err());
    assert!(locate_edition(&markup.replace("www.gwanbo.go.kr", "evil.example"), 2027).is_err());

    // Parser rejection cases
    assert!(parse_edition(2028, URL_2027, &"0".repeat(64), FIXTURE_2027).is_err());
    assert!(
        parse_edition(
            2027,
            URL_2027,
            &"0".repeat(64),
            &FIXTURE_2027.replace("대한", "소한")
        )
        .is_err()
    );
    let missing_row: String = FIXTURE_2027
        .lines()
        .filter(|l| !l.contains("처서"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(parse_edition(2027, URL_2027, &"0".repeat(64), &missing_row).is_err());
    assert!(iso_date(2027, 2, 29).is_err());

    // June 1 KST check window boundary
    assert_eq!(check_years(utc_ms("2026-05-31T14:59:59Z")), vec![2026]);
    assert_eq!(
        check_years(utc_ms("2026-05-31T15:00:00Z")),
        vec![2026, 2027]
    );

    // Full GazetteSource fetch_edition via injected HttpFetcher
    let calls = Arc::new(Mutex::new(Vec::new()));
    let source = GazetteSource::new(StubFetcher {
        html: markup.into_bytes(),
        pdf: pdf_bytes.clone(),
        calls: Arc::clone(&calls),
    });
    let fetched = source
        .fetch_edition(2027, Instant::now() + Duration::from_secs(5))
        .await
        .unwrap();
    assert_eq!(fetched.edition.dates, edition.dates);
    assert_eq!(fetched.pdf, pdf_bytes);
    assert_eq!(calls.lock().unwrap().len(), 2);
}

#[derive(Default, Clone)]
struct MemS3(Arc<Mutex<MemS3Data>>);

#[derive(Default)]
struct MemS3Data {
    objects: BTreeMap<String, Object>,
    controls: BTreeMap<String, (Vec<u8>, u64)>,
    revision: u64,
    fail_reads: bool,
}

impl MemS3 {
    fn set_fail_reads(&self, fail: bool) {
        self.0.lock().unwrap().fail_reads = fail;
    }

    fn all_keys(&self) -> Vec<String> {
        let g = self.0.lock().unwrap();
        g.objects.keys().chain(g.controls.keys()).cloned().collect()
    }
}

impl ObjectTransport for MemS3 {
    async fn put(&self, record: &PreparedRecord) -> Result<u16, StorageError> {
        let mut d = self.0.lock().unwrap();
        if d.objects.contains_key(&record.key) {
            return Ok(412);
        }
        d.objects.insert(
            record.key.clone(),
            Object {
                metadata: record.metadata.clone(),
                length: record.body.len(),
                body: record.body.clone(),
            },
        );
        Ok(200)
    }

    async fn head(&self, key: &str) -> Result<Object, StorageError> {
        let d = self.0.lock().unwrap();
        if d.fail_reads {
            return Err(StorageError::Transport);
        }
        let o = d.objects.get(key).ok_or(StorageError::NotFound)?;
        Ok(Object {
            metadata: o.metadata.clone(),
            length: o.length,
            body: Vec::new(),
        })
    }

    async fn get(&self, key: &str, maximum: usize) -> Result<Object, StorageError> {
        let d = self.0.lock().unwrap();
        if d.fail_reads {
            return Err(StorageError::Transport);
        }
        let o = d.objects.get(key).cloned().ok_or(StorageError::NotFound)?;
        if o.length > maximum {
            return Err(StorageError::Capacity);
        }
        Ok(o)
    }
}

impl CatalogTransport for MemS3 {
    async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, StorageError> {
        let d = self.0.lock().unwrap();
        if d.fail_reads {
            return Err(StorageError::Transport);
        }
        let (body, rev) = d.controls.get(key).cloned().ok_or(StorageError::NotFound)?;
        if body.len() > maximum {
            return Err(StorageError::Capacity);
        }
        Ok(ControlObject {
            body,
            etag: format!("\"{rev}\""),
            version: None,
        })
    }

    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, StorageError> {
        let mut d = self.0.lock().unwrap();
        let current = d.controls.get(key).map(|(_, r)| format!("\"{r}\""));
        let allowed = match condition {
            WriteCondition::Absent => current.is_none(),
            WriteCondition::Match(etag) => current.as_deref() == Some(etag.as_str()),
        };
        if !allowed {
            return Ok(412);
        }
        d.revision += 1;
        let rev = d.revision;
        d.controls.insert(key.to_owned(), (body.to_vec(), rev));
        Ok(200)
    }

    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, StorageError> {
        Err(StorageError::Invalid("uses declared index"))
    }
}

impl IndexListing for MemS3 {
    async fn list_index(&self, prefix: &str, _: Option<&str>) -> Result<ListPage, StorageError> {
        let d = self.0.lock().unwrap();
        if d.fail_reads {
            return Err(StorageError::Transport);
        }
        let keys = d
            .controls
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect();
        Ok(ListPage { keys, next: None })
    }
}

struct StubOfficialSource(Mutex<BTreeMap<i32, Result<FetchedEdition, CalendarError>>>);

impl OfficialSource for StubOfficialSource {
    fn fetch_edition(
        &self,
        year: i32,
        _deadline: Instant,
    ) -> BoxFuture<'_, Result<FetchedEdition, CalendarError>> {
        let res = self
            .0
            .lock()
            .unwrap()
            .get(&year)
            .cloned()
            .unwrap_or_else(|| Err(CalendarError("official source offline".into())));
        Box::pin(async move { res })
    }
}

async fn send_req(app: &axum::Router, req: Request<Body>) -> (StatusCode, HeaderMap, Vec<u8>) {
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, headers, body)
}

#[tokio::test]
async fn s3_reconciliation_http_contract_restart_guard_and_outage_resilience() {
    let now_cell = Arc::new(Mutex::new(utc_ms("2026-06-30T00:00:00Z")));
    let clock = {
        let c = Arc::clone(&now_cell);
        Arc::new(move || *c.lock().unwrap())
    };
    let s3 = MemS3::default();
    let pdf_2027 = build_synthetic_gazette_pdf(FIXTURE_2027);
    let digest_2027 = sha256_hex(&pdf_2027);
    let ed_2027 = parse_edition(2027, URL_2027, &digest_2027, FIXTURE_2027).unwrap();

    // Start service with no seeds and no official source yet -> restart guard active
    let service = Arc::new(Service::new(s3.clone(), clock.clone(), 20, &[], None).unwrap());
    let app = router(service.clone() as Arc<dyn CalendarApi>);

    // 400 malformed year, 404 out of range
    let (st, hdrs, body) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/202x")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert_eq!(hdrs["cache-control"], "no-store");
    assert_eq!(body, br#"{"error":"invalid_year"}"#);

    let (st, hdrs, body) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/2099")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(hdrs["cache-control"], "no-store");
    assert_eq!(body, br#"{"error":"year_out_of_range"}"#);

    // Before initial S3 restore: 2026 and 2027 return 503; distant year 2028 returns 200 calculated
    let (st, hdrs, _) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/2027")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(hdrs["cache-control"], "no-store");

    let (st, hdrs, body_2028) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/2028")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(
        hdrs["cache-control"],
        "public, max-age=3600, must-revalidate"
    );
    assert_eq!(hdrs["access-control-allow-origin"], "*");
    let v2028: serde_json::Value = serde_json::from_slice(&body_2028).unwrap();
    assert_eq!(v2028["status"], "calculated");
    assert_eq!(v2028["timeZone"], "Asia/Seoul");
    assert!(v2028["officialEdition"].is_null());
    assert_eq!(v2028["terms"].as_array().unwrap().len(), 24);

    // Conditional GET 304 on ETag
    let etag_2028 = hdrs["etag"].to_str().unwrap().to_owned();
    let (st, _, empty) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/2028")
            .header("if-none-match", &etag_2028)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_MODIFIED);
    assert!(empty.is_empty());

    // Initial restore completes against empty S3 -> 2027 becomes 200 calculated
    service.reconcile_once().await;
    let (st, hdrs_calc, body_calc) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/2027")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let etag_calc = hdrs_calc["etag"].to_str().unwrap().to_owned();
    let v_calc: serde_json::Value = serde_json::from_slice(&body_calc).unwrap();
    assert_eq!(v_calc["status"], "calculated");

    // Publish matching 2027 official edition to S3 -> verified status, new ETag, dates unchanged
    let store = Store::new(s3.clone()).unwrap();
    let item = FetchedEdition {
        edition: ed_2027.clone(),
        pdf: pdf_2027.clone(),
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    store
        .publish(&item, utc_ms("2026-06-30T00:00:00Z"), deadline)
        .await
        .unwrap();
    // Idempotent replay succeeds
    store
        .publish(&item, utc_ms("2026-06-30T00:05:00Z"), deadline)
        .await
        .unwrap();

    // Every S3 key obeys the provisioned tw-server2-runtime IAM prefixes (raw/v2/ or index/v2/)
    let keys = s3.all_keys();
    assert!(!keys.is_empty());
    assert!(
        keys.iter()
            .all(|k| k.starts_with("raw/v2/") || k.starts_with("index/v2/")),
        "unexpected S3 prefix in {keys:?}"
    );

    // Conflicting digest for the same (year, order) fails without overwriting
    let conflict_pdf = b"%PDF-1.4 conflicting".to_vec();
    let mut conflict_ed = ed_2027.clone();
    conflict_ed.source_digest = sha256_hex(&conflict_pdf);
    let conflict = store
        .publish(
            &FetchedEdition {
                edition: conflict_ed,
                pdf: conflict_pdf,
            },
            utc_ms("2026-06-30T00:06:00Z"),
            deadline,
        )
        .await;
    assert!(matches!(conflict, Err(SolarStoreError::Conflict(_))));

    service.reconcile_once().await;
    let (st, hdrs_ver, body_ver) = send_req(
        &app,
        Request::get("/calendar/v1/kr/solar-terms/2027")
            .header("if-none-match", &etag_calc)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_ne!(hdrs_ver["etag"].to_str().unwrap(), etag_calc);
    let v_ver: serde_json::Value = serde_json::from_slice(&body_ver).unwrap();
    assert_eq!(v_ver["status"], "verified");
    assert_eq!(v_ver["terms"], v_calc["terms"]);

    // Amended later gazette corrects ONLY 입춘 (index 2: 2027-02-04 -> 2027-02-05)
    let amended_pdf = b"%PDF-1.4 amended".to_vec();
    let mut amended = ed_2027.clone();
    amended.id = "2026-0090".into();
    amended.publication_date = "2026-07-02".into();
    amended.order = "2026-07-02/000000090".into();
    amended.source_digest = sha256_hex(&amended_pdf);
    amended.dates[2] = "2027-02-05".into();
    store
        .publish(
            &FetchedEdition {
                edition: amended.clone(),
                pdf: amended_pdf,
            },
            utc_ms("2026-07-02T00:00:00Z"),
            deadline,
        )
        .await
        .unwrap();

    // Re-applying older edition cannot downgrade newer correction
    service.reconcile_once().await;
    service.calendar().apply(ed_2027.clone()).unwrap();
    let snap = service.calendar().read_year(2027).unwrap();
    assert_eq!(snap.terms[2].date, "2027-02-05");
    assert!(snap.terms[2].corrected);
    assert_eq!(snap.terms.iter().filter(|t| t.corrected).count(), 1);
    assert_eq!(
        service.calendar().read_year(2026).unwrap().status,
        Status::Calculated
    );

    // Simulated restart with official source offline recovers corrected 2027 from S3
    let offline_source = Arc::new(StubOfficialSource(Mutex::new(BTreeMap::new())));
    let restarted =
        Arc::new(Service::new(s3.clone(), clock.clone(), 20, &[], Some(offline_source)).unwrap());
    // Guard holds before initial S3 restore so bundled 2027 seed never masks S3 correction
    assert!(restarted.calendar().read_year(2027).is_none());
    restarted.reconcile_once().await;
    let recovered = restarted.calendar().read_year(2027).unwrap();
    assert_eq!(recovered.terms[2].date, "2027-02-05");
    assert!(recovered.terms[2].corrected);

    // Post-restore S3 outage keeps last loaded snapshots in memory
    s3.set_fail_reads(true);
    restarted.reconcile_once().await;
    let still_ok = restarted.calendar().read_year(2027).unwrap();
    assert_eq!(still_ok.terms[2].date, "2027-02-05");
    s3.set_fail_reads(false);

    // KST New Year rollover: 2026-12-31T15:00:00Z is 2027-01-01 KST; staged year 2047 becomes in-range
    *now_cell.lock().unwrap() = utc_ms("2026-12-31T15:00:00Z");
    assert!(restarted.in_range(2047));
    assert!(restarted.read_year(2047).is_some());
}

#[test]
fn summary_ranking_policy_validation_and_kst_midnight_cache_parity() {
    let bundled = Policy::bundled().unwrap();
    let labels = Labels {
        temp: "기온".into(),
        today: "오늘".into(),
        lowest: "최저".into(),
        highest: "최고".into(),
    };
    let ipchun = TermEntry {
        id: "solar-315".into(),
        name_ko: "입춘".into(),
        date: "2026-02-04".into(),
        corrected: false,
    };
    let gyeongchip = TermEntry {
        id: "solar-345".into(),
        name_ko: "경칩".into(),
        date: "2026-03-05".into(),
        corrected: false,
    };
    let gogu = TermEntry {
        id: "solar-30".into(),
        name_ko: "곡우".into(),
        date: "2026-04-20".into(),
        corrected: false,
    };
    let base_snap = || CurrentSnapshot {
        weather_type: Some(1),
        pty: Some(0),
        rn1: None,
        ultrv_grade: None,
        wsd_grade: Some(1),
        dspls_grade: None,
        sensorytem: None,
        heat_index_grade: None,
        t1h: Some(2.0),
        t1h_text: Some("2".into()),
        temp_unit_f: false,
        warnings: vec![],
        gases: vec![],
    };
    let clear = SummaryItem {
        kind: ItemKind::Weather,
        text: "맑음".into(),
        grade: 2.5,
    };
    let breeze = SummaryItem {
        kind: ItemKind::Wind,
        text: "약한 바람".into(),
        grade: 2.0,
    };

    // Featured ranks ahead of routine commentary
    assert_eq!(
        select(
            &bundled,
            &[clear.clone(), breeze.clone()],
            &base_snap(),
            Some(&ipchun),
            None,
            &labels
        ),
        "입춘, 맑음"
    );

    // Spare-slot term fills only an empty slot; calendar-only never appears
    assert_eq!(
        select(
            &bundled,
            std::slice::from_ref(&clear),
            &base_snap(),
            Some(&gyeongchip),
            None,
            &labels
        ),
        "맑음, 경칩"
    );
    assert_eq!(
        select(
            &bundled,
            &[clear.clone(), breeze.clone()],
            &base_snap(),
            Some(&gyeongchip),
            None,
            &labels
        ),
        "맑음, 약한 바람"
    );
    assert_eq!(
        select(
            &bundled,
            std::slice::from_ref(&clear),
            &base_snap(),
            Some(&gogu),
            None,
            &labels
        ),
        "맑음"
    );

    // Policy reload validation: invalid mutations fail while valid promotion works
    let bad_missing = r#"{"version":1,"terms":[{"id":"solar-0","group":"featured"}]}"#;
    assert!(Policy::parse_json(bad_missing).is_err());
    let bad_id = server2::solar_terms::summary::BUNDLED_KR_POLICY_JSON
        .replace("\"solar-0\"", "\"solar-500\"");
    assert!(Policy::parse_json(&bad_id).is_err());
    let bad_dup = server2::solar_terms::summary::BUNDLED_KR_POLICY_JSON
        .replace("\"solar-15\"", "\"solar-0\"");
    assert!(Policy::parse_json(&bad_dup).is_err());
    let bad_group =
        server2::solar_terms::summary::BUNDLED_KR_POLICY_JSON.replace("\"featured\"", "\"none\"");
    assert!(Policy::parse_json(&bad_group).is_err());

    let promoted_json = server2::solar_terms::summary::BUNDLED_KR_POLICY_JSON.replace(
        "{\"id\": \"solar-30\", \"group\": \"calendar\"}",
        "{\"id\": \"solar-30\", \"group\": \"featured\"}",
    );
    let promoted = Policy::parse_json(&promoted_json).unwrap();
    assert_eq!(
        select(
            &promoted,
            std::slice::from_ref(&clear),
            &base_snap(),
            Some(&gogu),
            None,
            &labels
        ),
        "곡우, 맑음"
    );

    // Hazardous day: warning + dangerous air displace 입춘
    let mut haz_snap = base_snap();
    haz_snap.warnings = vec![
        WarningItem {
            weather: 9,
            level: 1,
            text: "한파주의보".into(),
        },
        WarningItem {
            weather: 9,
            level: 1,
            text: "한파주의보".into(),
        },
    ];
    haz_snap.sensorytem = Some(-25.0);
    let haz_items = vec![
        SummaryItem {
            kind: ItemKind::Air,
            text: "미세먼지 매우 나쁨".into(),
            grade: 4.0,
        },
        SummaryItem {
            kind: ItemKind::Feels,
            text: "체감온도 -25˚".into(),
            grade: 8.0,
        },
    ];
    assert_eq!(
        select(
            &bundled,
            &haz_items,
            &haz_snap,
            Some(&ipchun),
            None,
            &labels
        ),
        "한파주의보, 미세먼지 매우 나쁨"
    );

    // Actionable UV + featured term
    let mut uv_snap = base_snap();
    uv_snap.ultrv_grade = Some(2);
    assert_eq!(
        select(
            &bundled,
            &[
                clear.clone(),
                SummaryItem {
                    kind: ItemKind::Uv,
                    text: "자외선 높음".into(),
                    grade: 2.0,
                }
            ],
            &uv_snap,
            Some(&ipchun),
            None,
            &labels
        ),
        "자외선 높음, 입춘"
    );

    // Distinct hazards (lightning/hail/waterspout) stay distinct from heavy-rain warning
    let rain_warning = WarningItem {
        weather: 3,
        level: 2,
        text: "호우경보".into(),
    };
    let snow_warning = WarningItem {
        weather: 4,
        level: 2,
        text: "대설경보".into(),
    };
    for (text, code) in [
        ("번개", 50),
        ("뇌우", 55),
        ("우박", 49),
        ("용오름", 48),
        ("얼음싸라기", 58),
    ] {
        let mut s = base_snap();
        s.warnings = vec![rain_warning.clone()];
        s.weather_type = Some(code);
        s.pty = Some(1);
        s.rn1 = Some(1.0);
        let items = vec![
            SummaryItem {
                kind: ItemKind::Weather,
                text: text.into(),
                grade: 3.0,
            },
            SummaryItem {
                kind: ItemKind::Precipitation,
                text: "강수량 1mm".into(),
                grade: 4.0,
            },
        ];
        assert_eq!(
            select(&bundled, &items, &s, Some(&ipchun), None, &labels),
            format!("호우경보, {text}")
        );
    }
    // Same-topic heavy rain + rain warning deduplicate, leaving room for 입춘
    let mut same_rain = base_snap();
    same_rain.warnings = vec![rain_warning.clone(), rain_warning.clone()];
    same_rain.weather_type = Some(22);
    same_rain.pty = Some(1);
    same_rain.rn1 = Some(1.0);
    assert_eq!(
        select(
            &bundled,
            &[
                SummaryItem {
                    kind: ItemKind::Weather,
                    text: "강한비계속".into(),
                    grade: 3.0,
                },
                SummaryItem {
                    kind: ItemKind::Precipitation,
                    text: "강수량 1mm".into(),
                    grade: 4.0,
                },
            ],
            &same_rain,
            Some(&ipchun),
            None,
            &labels
        ),
        "호우경보, 입춘"
    );
    // Two distinct warnings take both slots
    let mut both_warn = same_rain.clone();
    both_warn.warnings = vec![rain_warning, snow_warning];
    assert_eq!(
        select(&bundled, &[], &both_warn, Some(&ipchun), None, &labels),
        "호우경보, 대설경보"
    );

    // Calm day daily temperature range + bare term name
    let range = DailyRange {
        date: "20260204".into(),
        min: "18".into(),
        max: "28".into(),
        extreme: false,
    };
    assert_eq!(
        select(
            &bundled,
            std::slice::from_ref(&clear),
            &base_snap(),
            Some(&ipchun),
            Some(&range),
            &labels
        ),
        "오늘 최저 18℃, 최고 28℃, 입춘"
    );

    // Actionable ozone gas grade enters risk band
    let mut gas_snap = base_snap();
    gas_snap.gases = vec![GasItem {
        grade: 3,
        text: "오존 나쁨".into(),
    }];
    assert_eq!(
        select(&bundled, &[clear], &gas_snap, Some(&ipchun), None, &labels),
        "오존 나쁨, 입춘"
    );

    // KST midnight cache TTL cap
    assert_eq!(
        remaining_seconds("2026-02-04", utc_ms("2026-02-04T14:59:58.900Z")),
        1
    );
    assert_eq!(
        remaining_seconds("2026-02-04", utc_ms("2026-02-04T15:00:00Z")),
        0
    );
    assert_eq!(
        remaining_seconds("2026-02-05", utc_ms("2026-02-04T14:59:59Z")),
        0
    );

    let body = r#"{"current":{"summary":"입춘","summaryForDate":"2026-02-04"}}"#.as_bytes();
    assert_eq!(
        summary_cache_age(body, Some(300), utc_ms("2026-02-04T14:58:00Z")),
        Some(120)
    );
    assert_eq!(
        summary_cache_age(body, Some(300), utc_ms("2026-02-04T06:00:00Z")),
        Some(300)
    );
    assert_eq!(
        summary_cache_age(
            r#"{"current":{"summary":"맑음"}}"#.as_bytes(),
            Some(300),
            utc_ms("2026-02-04T06:00:00Z")
        ),
        None
    );
}

// ---- Full domestic KMA v000903 assembly parity tests ----

#[derive(Clone)]
struct FixtureKmaStore {
    date: String,
    t1h: f64,
    ta_min: f64,
    ta_max: f64,
    pm25_grade: Option<u32>,
    warnings: Result<serde_json::Value, String>,
}

impl FixtureKmaStore {
    fn calm(date: &str) -> Self {
        Self {
            date: date.to_owned(),
            t1h: 22.0,
            ta_min: 18.0,
            ta_max: 28.0,
            pm25_grade: None,
            warnings: Ok(serde_json::json!([])),
        }
    }

    fn ok_json(v: serde_json::Value) -> StoreResult {
        Ok(OrderedJson::from_serde(&v).unwrap())
    }
}

impl KmaStore for FixtureKmaStore {
    fn db_version(&self) -> DbVersion {
        DbVersion::V2
    }

    fn towns(&self) -> StoreResult {
        Self::ok_json(serde_json::json!([{
            "town": {"first": "서울특별시", "second": "종로구", "third": "청운효자동"},
            "mCoord": {"mx": 60, "my": 127},
            "gCoord": {"lat": 37.584, "lon": 126.97},
            "areaNo": "1111051500"
        }]))
    }

    fn town(&self, first: &str, second: &str, third: &str) -> StoreResult {
        Self::ok_json(serde_json::json!([{
            "town": {"first": first, "second": second, "third": third},
            "mCoord": {"mx": 60, "my": 127},
            "gCoord": {"lat": 37.584, "lon": 126.97},
            "areaNo": "1111051500"
        }]))
    }

    fn region_code(&self, _region: &str, _city: &str) -> StoreResult {
        Self::ok_json(serde_json::json!({"pointNumber": "108", "cityCode": "11B10101"}))
    }

    fn town_model(
        &self,
        model: TownModel,
        _mx: &serde_json::Value,
        _my: &serde_json::Value,
    ) -> StoreResult {
        let d = &self.date;
        let iso = format!("{}-{}-{}", &d[0..4], &d[4..6], &d[6..8]);
        let day_ms = kst_midnight_ms(&iso).unwrap();
        let pub_cur = day_ms + 10 * 3_600_000;
        let pub_short = day_ms + 5 * 3_600_000;
        match model {
            TownModel::Current => Self::ok_json(serde_json::json!([{
                "pubDate": {"$date": pub_cur},
                "fcsDate": {"$date": pub_cur},
                "currentData": {
                    "date": d,
                    "time": "1000",
                    "t1h": self.t1h,
                    "sky": 1,
                    "pty": 0,
                    "lgt": 0,
                    "rn1": 0,
                    "reh": 45,
                    "wsd": 1.2,
                    "vec": 180,
                    "uuu": 0,
                    "vvv": 0
                }
            }])),
            TownModel::Short => Self::ok_json(serde_json::json!([
                {
                    "pubDate": {"$date": pub_short},
                    "fcsDate": {"$date": day_ms + 6 * 3_600_000},
                    "shortData": {
                        "date": d,
                        "time": "0600",
                        "t3h": self.ta_min,
                        "tmn": self.ta_min,
                        "tmx": -50,
                        "sky": 1,
                        "pty": 0,
                        "pop": 0,
                        "r06": 0,
                        "s06": 0,
                        "reh": 45,
                        "wsd": 1.2,
                        "vec": 180,
                        "uuu": 0,
                        "vvv": 0,
                        "wav": 0
                    }
                },
                {
                    "pubDate": {"$date": pub_short},
                    "fcsDate": {"$date": day_ms + 15 * 3_600_000},
                    "shortData": {
                        "date": d,
                        "time": "1500",
                        "t3h": self.ta_max,
                        "tmn": self.ta_min,
                        "tmx": self.ta_max,
                        "sky": 1,
                        "pty": 0,
                        "pop": 0,
                        "r06": 0,
                        "s06": 0,
                        "reh": 45,
                        "wsd": 1.2,
                        "vec": 180,
                        "uuu": 0,
                        "vvv": 0,
                        "wav": 0
                    }
                }
            ])),
            TownModel::Shortest => Self::ok_json(serde_json::json!([{
                "pubDate": {"$date": pub_cur},
                "fcsDate": {"$date": pub_cur + 3_600_000},
                "shortestData": {
                    "date": d,
                    "time": "1100",
                    "t1h": self.t1h,
                    "sky": 1,
                    "pty": 0,
                    "lgt": 0,
                    "rn1": 0,
                    "reh": 45,
                    "wsd": 1.2,
                    "vec": 180,
                    "uuu": 0,
                    "vvv": 0,
                    "pop": 0
                }
            }])),
            TownModel::ShortRss => Self::ok_json(serde_json::json!([])),
        }
    }

    fn mid_model(&self, model: MidModel, _reg_id: &serde_json::Value) -> StoreResult {
        let d = &self.date;
        let iso = format!("{}-{}-{}", &d[0..4], &d[4..6], &d[6..8]);
        let pub_ms = kst_midnight_ms(&iso).unwrap() + 6 * 3_600_000;
        match model {
            MidModel::Temp => Self::ok_json(serde_json::json!([{
                "regId": "11B10101",
                "pubDate": {"$date": pub_ms},
                "data": {
                    "date": d,
                    "time": "0600",
                    "taMin3": self.ta_min,
                    "taMax3": self.ta_max,
                    "taMin4": self.ta_min,
                    "taMax4": self.ta_max,
                    "taMin5": self.ta_min,
                    "taMax5": self.ta_max,
                    "taMin6": self.ta_min,
                    "taMax6": self.ta_max,
                    "taMin7": self.ta_min,
                    "taMax7": self.ta_max,
                    "taMin8": self.ta_min,
                    "taMax8": self.ta_max,
                    "taMin9": self.ta_min,
                    "taMax9": self.ta_max,
                    "taMin10": self.ta_min,
                    "taMax10": self.ta_max
                }
            }])),
            MidModel::Land => Self::ok_json(serde_json::json!([{
                "regId": "11B00000",
                "pubDate": {"$date": pub_ms},
                "data": {
                    "date": d,
                    "time": "0600",
                    "wf3Am": "맑음",
                    "wf3Pm": "맑음",
                    "rnSt3Am": 0,
                    "rnSt3Pm": 0,
                    "wf4Am": "맑음",
                    "wf4Pm": "맑음",
                    "rnSt4Am": 0,
                    "rnSt4Pm": 0,
                    "wf5Am": "맑음",
                    "wf5Pm": "맑음",
                    "rnSt5Am": 0,
                    "rnSt5Pm": 0,
                    "wf6Am": "맑음",
                    "wf6Pm": "맑음",
                    "rnSt6Am": 0,
                    "rnSt6Pm": 0,
                    "wf7Am": "맑음",
                    "wf7Pm": "맑음",
                    "rnSt7Am": 0,
                    "rnSt7Pm": 0,
                    "wf8": "맑음",
                    "rnSt8": 0,
                    "wf9": "맑음",
                    "rnSt9": 0,
                    "wf10": "맑음",
                    "rnSt10": 0
                }
            }])),
            MidModel::Forecast => Self::ok_json(serde_json::json!([{
                "regId": "109",
                "pubDate": {"$date": pub_ms},
                "data": {
                    "date": d,
                    "time": "0600",
                    "cnt": 1,
                    "wfsv": "맑음"
                }
            }])),
        }
    }

    fn forecast_zone(&self, _region: &str, _city: &str) -> StoreResult {
        Self::ok_json(serde_json::json!([{"regId": "11B10101"}]))
    }

    fn stn_hourly_and_min_rns(
        &self,
        _town: &serde_json::Value,
        _date_time: &str,
        _current: &serde_json::Value,
    ) -> StoreResult {
        Self::ok_json(serde_json::json!({
            "t1h": self.t1h,
            "vec": 180,
            "wsd": 1.2,
            "stnDateTime": format!(
                "{}-{}-{} 10:00",
                &self.date[0..4],
                &self.date[4..6],
                &self.date[6..8]
            ),
            "rs1h": 0
        }))
    }

    fn city_hourly(&self, _town: &serde_json::Value) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn history(&self, _town: &serde_json::Value) -> StoreResult {
        Self::ok_json(serde_json::json!(null))
    }

    fn area_no(&self, _first: &str, _second: &str, _third: &str) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn area_no_near(&self, _lon_lat: &serde_json::Value) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn life_index(&self, _area_no: f64) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn food_poisoning(&self, _sd: &str, _sgg: &str, _start: &str, _end: &str) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn arpltn(&self, _town: &serde_json::Value, _now_ms: f64) -> StoreResult {
        if let Some(grade) = self.pm25_grade {
            let dt = format!(
                "{}-{}-{} 10:00",
                &self.date[0..4],
                &self.date[4..6],
                &self.date[6..8]
            );
            Self::ok_json(serde_json::json!({
                "arpltn": {
                    "stationName": "종로구",
                    "dataTime": dt,
                    "pm25Value": 95,
                    "pm25Grade": grade,
                    "pm10Value": 40,
                    "pm10Grade": 2,
                    "khaiValue": 180,
                    "khaiGrade": grade
                },
                "list": [],
                "stnList": []
            }))
        } else {
            Self::ok_json(serde_json::json!({
                "arpltn": {},
                "list": [],
                "stnList": []
            }))
        }
    }

    fn dust_forecast(&self, _region: &str, _city: &str, _date: &str) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn air_fallback(&self, _g_coord: &serde_json::Value, _now_ms: f64) -> StoreResult {
        Self::ok_json(serde_json::json!(null))
    }

    fn air_forecast(&self, _source: &str, _station: &serde_json::Value) -> StoreResult {
        Self::ok_json(serde_json::json!(null))
    }

    fn rise_set(&self, _geocode: &serde_json::Value, _dates: &[String]) -> StoreResult {
        Self::ok_json(serde_json::json!([]))
    }

    fn special_zones(&self, area_codes: &[String]) -> StoreResult {
        match &self.warnings {
            Ok(v) => {
                let mut rows = v.clone();
                if let (Some(code), Some(arr)) = (area_codes.first(), rows.as_array_mut()) {
                    for item in arr {
                        if let Some(obj) = item.as_object_mut() {
                            obj.insert("areaCode".into(), serde_json::Value::String(code.clone()));
                        }
                    }
                }
                Self::ok_json(rows)
            }
            Err(msg) => Err(StoreError(msg.clone())),
        }
    }
}

fn kma_req(version: &str, locale: Locale) -> KmaRequest {
    let mount = if version == "v000901" {
        format!("/{version}/kma/addr")
    } else {
        format!("/{version}/kma")
    };
    KmaRequest {
        version: version.to_owned(),
        mount,
        part: None,
        region: Some("서울특별시".into()),
        city: Some("종로구".into()),
        town: Some("청운효자동".into()),
        original_url: format!("/{version}/kma/addr/서울특별시/종로구/청운효자동"),
        query: vec![],
        locale,
        requested_region: None,
    }
}

#[test]
fn domestic_v000903_assembly_matches_server1_solar_term_contract() {
    let ipchun_2027_ms = utc_ms("2027-02-04T01:30:00Z"); // 2027-02-04 10:30 KST
    let cal = Arc::new(
        Calendar::new(
            Arc::new(move || ipchun_2027_ms),
            20,
            &bundled_seeds().unwrap(),
        )
        .unwrap(),
    );
    let lookup = MemoryLookup::new(Arc::clone(&cal), Policy::bundled().unwrap());

    // 1. Calm 입춘 on v000903 (Korean): daily range + bare term name + summaryForDate
    let store = FixtureKmaStore::calm("20270204");
    let outcome = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("ko"))),
        &store,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    );
    let Outcome::Json(body) = outcome else {
        panic!("expected JSON outcome, got {outcome:?}");
    };
    let v: serde_json::Value = serde_json::from_slice(&body.to_bytes()).unwrap();
    assert_eq!(v["current"]["summary"], "오늘 최저 18℃, 최고 28℃, 입춘");
    assert_eq!(v["current"]["summaryForDate"], "2027-02-04");
    assert!(v["current"]["summaryWeather"].as_str().is_some());

    // 2. Hazardous 입춘 (cold-wave advisory + very unhealthy fine dust) displaces 입춘
    let mut haz = FixtureKmaStore::calm("20270204");
    haz.pm25_grade = Some(4);
    haz.warnings = Ok(serde_json::json!([{
        "areaCode": "L1100400",
        "areaName": "서울서북권",
        "warnVar": 3,
        "warnStress": 0,
        "active": true,
        "command": "1",
        "eventTmFc": 202702040900_i64,
        "eventTmSeq": 1,
        "eventRank": 1
    }]));
    let Outcome::Json(haz_body) = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("ko"))),
        &haz,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let vh: serde_json::Value = serde_json::from_slice(&haz_body.to_bytes()).unwrap();
    let s = vh["current"]["summary"].as_str().unwrap();
    assert!(s.contains("한파주의보"), "got {s}");
    assert!(!s.contains("입춘"), "hazards must displace 입춘, got {s}");
    assert_eq!(vh["current"]["summaryForDate"], "2027-02-04");

    // 3. Warning state unavailable -> warnings_covered=false -> 입춘 omitted
    let mut no_warn = FixtureKmaStore::calm("20270204");
    no_warn.warnings = Err("warning store unavailable".into());
    let Outcome::Json(nw_body) = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("ko"))),
        &no_warn,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let vnw: serde_json::Value = serde_json::from_slice(&nw_body.to_bytes()).unwrap();
    assert!(!vnw["current"]["summary"].as_str().unwrap().contains("입춘"));

    // 4. Non-Korean locale omits untranslated term while retaining localized weather
    let Outcome::Json(en_body) = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("en"))),
        &store,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let ven: serde_json::Value = serde_json::from_slice(&en_body.to_bytes()).unwrap();
    let en_summary = ven["current"]["summary"].as_str().unwrap();
    assert!(
        en_summary.contains("Today Lowest 18℃, Highest 28℃"),
        "got {en_summary}"
    );
    assert!(!en_summary.contains("입춘"));

    // 5. Older KMA version (v000901) leaves summaryForDate absent and legacy summary untouched
    let Outcome::Json(v901_body) = assemble_with_solar_terms(
        &kma_req("v000901", i18n::guess(Some("ko"))),
        &store,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let v901: serde_json::Value = serde_json::from_slice(&v901_body.to_bytes()).unwrap();
    assert!(v901["current"].get("summaryForDate").is_none());
    assert!(
        !v901["current"]["summary"]
            .as_str()
            .unwrap()
            .contains("입춘")
    );

    // 6. Direct Express helper headers on dated summary set must-revalidate and Vary: Accept-Language, Cookie
    let direct_resp =
        server2::api::express(&Method::GET, &HeaderMap::new(), Outcome::Json(body.clone()));
    let cc = direct_resp.headers()["cache-control"].to_str().unwrap();
    assert!(cc.contains("must-revalidate"), "got {cc}");
    assert_eq!(direct_resp.headers()["vary"], "Accept-Language, Cookie");

    // Plain Express helper without v000903 mount context or summaryForDate omits Cache-Control and Vary
    let plain_resp = server2::api::express(
        &Method::GET,
        &HeaderMap::new(),
        Outcome::Json(v901_body.clone()),
    );
    assert!(plain_resp.headers().get("cache-control").is_none());
    assert!(plain_resp.headers().get("vary").is_none());

    // Low-level response::send on dated summary adds must-revalidate and Vary: Accept-Language
    // (real Gateway::handle always sets Vary: Accept-Language on JSON replies; verified in
    // cross_implementation_server1_parity_through_gateway_and_direct_routes below).
    let gw_dated = server2::gateway::response::send(
        &Method::GET,
        &HeaderMap::new(),
        StatusCode::OK,
        body.to_bytes(),
        Some(300),
        None,
    );
    let gw_cc = gw_dated.headers()["cache-control"].to_str().unwrap();
    assert!(gw_cc.contains("must-revalidate"), "got {gw_cc}");
    assert_eq!(gw_dated.headers()["vary"], "Accept-Language");

    // Non-gateway callers of response::send (e.g. /v000903/kma/special) keep max-age=300 without Vary
    let gw_plain = server2::gateway::response::send(
        &Method::GET,
        &HeaderMap::new(),
        StatusCode::OK,
        v901_body.to_bytes(),
        Some(300),
        None,
    );
    assert_eq!(gw_plain.headers()["cache-control"], "max-age=300");
    assert!(gw_plain.headers().get("vary").is_none());

    // Invalid daily temperature sentinel (-50) never produces a daily range string
    let mut bad_range = FixtureKmaStore::calm("20270204");
    bad_range.ta_min = -50.0;
    let Outcome::Json(br_body) = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("ko"))),
        &bad_range,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let vbr: serde_json::Value = serde_json::from_slice(&br_body.to_bytes()).unwrap();
    let br_s = vbr["current"]["summary"].as_str().unwrap();
    assert!(
        !br_s.contains("-50"),
        "invalid sentinel must not appear: {br_s}"
    );
    assert!(br_s.contains("입춘"), "got {br_s}");

    // 7. Corrected official date moves term eligibility to the corrected day only
    let mut amended = bundled_seeds().unwrap()[1].clone();
    amended.id = "2026-0091".into();
    amended.publication_date = "2026-07-03".into();
    amended.order = "2026-07-03/000000091".into();
    amended.dates[2] = "2027-02-05".into();
    cal.apply(amended).unwrap();

    // On original date 2027-02-04, 입춘 no longer appears
    let Outcome::Json(orig_day) = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("ko"))),
        &store,
        ipchun_2027_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let vo: serde_json::Value = serde_json::from_slice(&orig_day.to_bytes()).unwrap();
    assert!(!vo["current"]["summary"].as_str().unwrap().contains("입춘"));

    // On corrected date 2027-02-05, 입춘 appears
    let next_day_ms = kst_midnight_ms("2027-02-05").unwrap() + 10 * 3_600_000;
    let next_store = FixtureKmaStore::calm("20270205");
    let Outcome::Json(corr_day) = assemble_with_solar_terms(
        &kma_req("v000903", i18n::guess(Some("ko"))),
        &next_store,
        next_day_ms as f64,
        AssemblyConfig::default(),
        Some(&lookup),
    ) else {
        panic!("expected JSON outcome");
    };
    let vc: serde_json::Value = serde_json::from_slice(&corr_day.to_bytes()).unwrap();
    assert_eq!(vc["current"]["summary"], "오늘 최저 18℃, 최고 28℃, 입춘");
    assert_eq!(vc["current"]["summaryForDate"], "2027-02-05");
    let _ = NAMES;
}

#[test]
fn astronomy_utc_instants_match_server1_boundary_and_midnight_adjacent_terms() {
    let parity: serde_json::Value = serde_json::from_str(PARITY_FIXTURE).unwrap();
    for year_str in ["2026", "2027", "2076"] {
        let year: i32 = year_str.parse().unwrap();
        let computed = calculate(year).unwrap();
        let expected = parity["astroYears"][year_str].as_array().unwrap();
        assert_eq!(computed.len(), expected.len());
        for (got, exp) in computed.iter().zip(expected.iter()) {
            assert_eq!(got.id, exp["id"].as_str().unwrap());
            assert_eq!(got.name_ko, exp["nameKo"].as_str().unwrap());
            assert_eq!(got.date, exp["date"].as_str().unwrap());
            let exp_ms = exp["utcMs"].as_i64().unwrap();
            let diff_ms = (got.utc_ms - exp_ms).abs();
            assert!(
                diff_ms <= 2_000,
                "year {year} {} UTC drift {diff_ms}ms (got {}, exp {exp_ms})",
                got.id,
                got.utc_ms
            );
        }
    }

    let midnight = parity["midnightAdjacent"].as_array().unwrap();
    assert!(!midnight.is_empty());
    let mut cache: BTreeMap<i32, Vec<server2::solar_terms::calendar::CalculatedTerm>> =
        BTreeMap::new();
    for entry in midnight {
        let year = entry["year"].as_i64().unwrap() as i32;
        let rows = cache
            .entry(year)
            .or_insert_with(|| calculate(year).unwrap());
        let id = entry["id"].as_str().unwrap();
        let got = rows.iter().find(|r| r.id == id).unwrap();
        assert_eq!(got.date, entry["date"].as_str().unwrap());
        let exp_ms = entry["utcMs"].as_i64().unwrap();
        let diff_ms = (got.utc_ms - exp_ms).abs();
        assert!(
            diff_ms <= 2_000,
            "midnight-adjacent {year} {id} UTC drift {diff_ms}ms"
        );
    }
}

#[tokio::test]
async fn malformed_pdf_bounds_shared_streams_and_worker_continuation() {
    fn raw_pdf(objs: &[&[u8]]) -> Vec<u8> {
        let mut out = b"%PDF-1.4\n".to_vec();
        for (i, body) in objs.iter().enumerate() {
            out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        }
        out.extend_from_slice(b"%%EOF\n");
        out
    }

    fn stream_obj(dict: &[u8], body: &[u8]) -> Vec<u8> {
        let mut out = dict.to_vec();
        out.extend_from_slice(b"\nstream\n");
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendstream");
        out
    }

    // 1. Stray closing delimiters (']', ')', '>') must not loop forever or panic
    let stray_obj = stream_obj(b"<< /Length 12 >>", b"BT ] ) > >> ET");
    let stray = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"#,
        &stray_obj,
    ]);
    assert!(pdf::extract_text(&stray).is_err());

    // 2. Unterminated '[' at EOF must return Err instead of panicking on slice bounds
    let unclosed_obj = stream_obj(b"<< /Length 4 >>", b"BT [");
    let unclosed_arr = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"#,
        &unclosed_obj,
    ]);
    assert!(pdf::extract_text(&unclosed_arr).is_err());

    // 3. Deeply nested arrays exceeding depth limit return Err
    let deep_stream = format!("{} {} {}", "[".repeat(40), "1", "]".repeat(40));
    let mut deep_obj = format!("<< /Length {} >>", deep_stream.len()).into_bytes();
    deep_obj.extend_from_slice(b"\nstream\n");
    deep_obj.extend_from_slice(deep_stream.as_bytes());
    deep_obj.extend_from_slice(b"\nendstream");
    let deep_arr = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"#,
        &deep_obj,
    ]);
    assert!(pdf::extract_text(&deep_arr).is_err());

    // 4. Deeply nested /Pages tree exceeding depth limit returns Err
    let mut tree_objs: Vec<Vec<u8>> = vec![br#"<< /Type /Catalog /Pages 2 0 R >>"#.to_vec()];
    for idx in 2..=40 {
        let s = format!("<< /Type /Pages /Kids [{} 0 R] /Count 1 >>", idx + 1);
        tree_objs.push(s.into_bytes());
    }
    tree_objs.push(br#"<< /Type /Page /Parent 40 0 R >>"#.to_vec());
    let tree_refs: Vec<&[u8]> = tree_objs.iter().map(Vec::as_slice).collect();
    assert!(pdf::extract_text(&raw_pdf(&tree_refs)).is_err());

    // 5. Malformed CMap bfrange (inverted bounds / array overflow / huge span) returns Err
    let bad_cmap = b"begincodespacerange <0000> <FFFF> endcodespacerange beginbfrange <0010> <0005> <0041> endbfrange";
    let mut bad_cmap_obj = format!("<< /Length {} >>", bad_cmap.len()).into_bytes();
    bad_cmap_obj.extend_from_slice(b"\nstream\n");
    bad_cmap_obj.extend_from_slice(bad_cmap);
    bad_cmap_obj.extend_from_slice(b"\nendstream");
    let tj_obj = stream_obj(b"<< /Length 22 >>", b"BT /F1 10 Tf <0010> Tj ET");
    let bad_cmap_pdf = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>"#,
        br#"<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>"#,
        &bad_cmap_obj,
        &tj_obj,
    ]);
    assert!(pdf::extract_text(&bad_cmap_pdf).is_err());

    let overflow_bfrange = b"begincodespacerange <0000> <FFFF> endcodespacerange beginbfrange <FFFFFFFF> <FFFFFFFF> [<0041> <0042>] endbfrange";
    let mut ov_obj = format!("<< /Length {} >>", overflow_bfrange.len()).into_bytes();
    ov_obj.extend_from_slice(b"\nstream\n");
    ov_obj.extend_from_slice(overflow_bfrange);
    ov_obj.extend_from_slice(b"\nendstream");
    let tj_obj2 = stream_obj(b"<< /Length 22 >>", b"BT /F1 10 Tf <0001> Tj ET");
    let ov_pdf = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>"#,
        br#"<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>"#,
        &ov_obj,
        &tj_obj2,
    ]);
    assert!(pdf::extract_text(&ov_pdf).is_err());

    // Overlapping bfrange entries exceeding document-wide CMap work budget fail promptly (CODEX-11)
    let mut overlap_cmap = String::from("begincodespacerange <0000> <FFFF> endcodespacerange\n");
    for _ in 0..35 {
        overlap_cmap.push_str("beginbfrange <0000> <0FFF> <0041> endbfrange\n");
    }
    let overlap_obj = stream_obj(
        format!("<< /Length {} >>", overlap_cmap.len()).as_bytes(),
        overlap_cmap.as_bytes(),
    );
    let overlap_pdf = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>"#,
        br#"<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>"#,
        &overlap_obj,
        &tj_obj2,
    ]);
    let overlap_err = pdf::extract_text(&overlap_pdf).unwrap_err();
    assert!(
        overlap_err.0.contains("CMap entry count exceeds limit"),
        "got {overlap_err}"
    );

    // Invalid Unicode scalar bfrange targets (e.g., UTF-16 surrogates 0xD800..) still charge the CMap work budget (CODEX-13)
    let mut invalid_scalar_cmap =
        String::from("begincodespacerange <0000> <FFFF> endcodespacerange\n");
    for _ in 0..35 {
        invalid_scalar_cmap.push_str("beginbfrange <0000> <0FFF> <D800> endbfrange\n");
    }
    let invalid_scalar_obj = stream_obj(
        format!("<< /Length {} >>", invalid_scalar_cmap.len()).as_bytes(),
        invalid_scalar_cmap.as_bytes(),
    );
    let invalid_scalar_pdf = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>"#,
        br#"<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R >>"#,
        &invalid_scalar_obj,
        &tj_obj2,
    ]);
    let invalid_scalar_err = pdf::extract_text(&invalid_scalar_pdf).unwrap_err();
    assert!(
        invalid_scalar_err
            .0
            .contains("CMap entry count exceeds limit"),
        "got {invalid_scalar_err}"
    );

    // 6. Shared content stream referenced by multiple pages decodes cleanly via StreamCache
    let shared_stream = b"BT /F1 10 Tf 1 0 0 1 72 720 Tm (HelloShared) Tj ET";
    let mut shared_enc = ZlibEncoder::new(Vec::new(), Compression::default());
    shared_enc.write_all(shared_stream).unwrap();
    let shared_z = shared_enc.finish().unwrap();
    let mut shared_obj =
        format!("<< /Filter /FlateDecode /Length {} >>", shared_z.len()).into_bytes();
    shared_obj.extend_from_slice(b"\nstream\n");
    shared_obj.extend_from_slice(&shared_z);
    shared_obj.extend_from_slice(b"\nendstream");
    let shared_pdf = raw_pdf(&[
        br#"<< /Type /Catalog /Pages 2 0 R >>"#,
        br#"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>"#,
        br#"<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>"#,
        &shared_obj,
    ]);
    let shared_text = pdf::extract_text(&shared_pdf).unwrap();
    assert_eq!(shared_text.matches("HelloShared").count(), 2);

    // 7. Worker continues to next KST day tick cleanly after malformed PDF error from official source
    struct MalformedThenValid {
        attempt: Mutex<u32>,
        bad_pdf: Vec<u8>,
        good: FetchedEdition,
    }
    impl OfficialSource for MalformedThenValid {
        fn fetch_edition(
            &self,
            year: i32,
            _deadline: Instant,
        ) -> BoxFuture<'_, Result<FetchedEdition, CalendarError>> {
            if year != 2027 {
                return Box::pin(async { Err(CalendarError("not target year".into())) });
            }
            let n = {
                let mut g = self.attempt.lock().unwrap();
                *g += 1;
                *g
            };
            let bad = self.bad_pdf.clone();
            let good = self.good.clone();
            Box::pin(async move {
                if n == 1 {
                    pdf::extract_text(&bad).map_err(|e| CalendarError(e.0))?;
                    unreachable!()
                }
                Ok(good)
            })
        }
    }

    let pdf_2027 = build_synthetic_gazette_pdf(FIXTURE_2027);
    let mut ed_2027 = parse_edition(2027, URL_2027, &sha256_hex(&pdf_2027), FIXTURE_2027).unwrap();
    ed_2027.id = "2026-0095".into();
    ed_2027.publication_date = "2026-07-05".into();
    ed_2027.order = "2026-07-05/000000095".into();
    ed_2027.dates[2] = "2027-02-05".into();
    let s3 = MemS3::default();
    let now_cell = Arc::new(Mutex::new(utc_ms("2026-07-05T02:00:00Z")));
    let clock_cell = Arc::clone(&now_cell);
    let source = Arc::new(MalformedThenValid {
        attempt: Mutex::new(0),
        bad_pdf: stray,
        good: FetchedEdition {
            edition: ed_2027,
            pdf: pdf_2027,
        },
    });
    let svc = Service::new(
        s3,
        Arc::new(move || *clock_cell.lock().unwrap()),
        20,
        &[],
        Some(source),
    )
    .unwrap();
    svc.reconcile_once().await;
    assert_eq!(
        svc.calendar().read_year(2027).unwrap().status,
        Status::Calculated
    );
    // Next KST day succeeds cleanly
    *now_cell.lock().unwrap() = utc_ms("2026-07-06T02:00:00Z");
    svc.reconcile_once().await;
    let recovered = svc.calendar().read_year(2027).unwrap();
    assert_eq!(recovered.status, Status::Verified);
    assert_eq!(recovered.terms[2].date, "2027-02-05");
}

#[tokio::test]
async fn official_fetcher_rejects_cross_origin_redirects() {
    use axum::routing::get;
    let target_app = axum::Router::new().route("/ok", get(|| async { "should not follow" }));
    let target_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_addr = target_listener.local_addr().unwrap();
    let target_handle = tokio::spawn(async move {
        let _ = axum::serve(target_listener, target_app).await;
    });

    let redirect_to = format!("http://{target_addr}/ok");
    let redir_app = axum::Router::new().route(
        "/almanac",
        get(move || {
            let loc = redirect_to.clone();
            async move {
                axum::response::Response::builder()
                    .status(StatusCode::FOUND)
                    .header("location", loc)
                    .body(Body::empty())
                    .unwrap()
            }
        }),
    );
    let redir_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let redir_addr = redir_listener.local_addr().unwrap();
    let redir_handle = tokio::spawn(async move {
        let _ = axum::serve(redir_listener, redir_app).await;
    });

    let fetcher = server2::solar_terms::official::ReqwestFetcher::new().unwrap();
    let err = fetcher
        .get_bytes(
            &format!("http://{redir_addr}/almanac"),
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("302"),
        "expected HTTP 302 rejection, got: {err}"
    );
    redir_handle.abort();
    target_handle.abort();
}

#[tokio::test]
async fn seed_conflict_rejected_before_s3_write_and_cors_preflight_works() {
    // 1. Empty S3 + conflicting edition at bundled 2027 seed's exact (year, order)
    let seeds = bundled_seeds().unwrap();
    let s3 = MemS3::default();
    let now_cell = Arc::new(Mutex::new(utc_ms("2026-07-01T02:00:00Z")));
    let clock_cell = Arc::clone(&now_cell);

    let bad_pdf = b"%PDF-1.4 tampered".to_vec();
    let mut bad_ed = seeds[1].clone(); // 2027 bundled seed order: 2026-06-29/000000078
    bad_ed.source_digest = sha256_hex(&bad_pdf);
    bad_ed.dates[2] = "2027-02-05".into();

    let good_pdf = build_synthetic_gazette_pdf(FIXTURE_2027);
    let mut good_ed = seeds[1].clone();
    good_ed.source_digest = sha256_hex(&good_pdf);
    // Use custom seeds whose 2027 seed matches good_pdf digest so valid retry converges cleanly
    let custom_seeds = vec![seeds[0].clone(), good_ed.clone()];

    let stub = Arc::new(StubOfficialSource(Mutex::new(BTreeMap::from([(
        2027,
        Ok(FetchedEdition {
            edition: bad_ed.clone(),
            pdf: bad_pdf.clone(),
        }),
    )]))));

    let svc = Arc::new(
        Service::new(
            s3.clone(),
            Arc::new(move || *clock_cell.lock().unwrap()),
            20,
            &custom_seeds,
            Some(stub.clone()),
        )
        .unwrap(),
    );

    // First attempt: conflicting edition at bundled seed order is rejected BEFORE writing to S3
    svc.reconcile_once().await;
    assert!(
        s3.all_keys().is_empty(),
        "conflicting edition must NOT be persisted to S3; keys={:?}",
        s3.all_keys()
    );

    // Next KST day: valid original succeeds and publishes cleanly to S3
    stub.0.lock().unwrap().insert(
        2027,
        Ok(FetchedEdition {
            edition: good_ed.clone(),
            pdf: good_pdf.clone(),
        }),
    );
    *now_cell.lock().unwrap() = utc_ms("2026-07-02T02:00:00Z");
    svc.reconcile_once().await;
    assert!(!s3.all_keys().is_empty());

    // Restart recovers cleanly from S3
    let clock_cell2 = Arc::clone(&now_cell);
    let restarted = Arc::new(
        Service::new(
            s3.clone(),
            Arc::new(move || *clock_cell2.lock().unwrap()),
            20,
            &custom_seeds,
            None,
        )
        .unwrap(),
    );
    restarted.reconcile_once().await;
    assert_eq!(restarted.read_year(2027).unwrap().status, Status::Verified);

    // If S3 already holds a conflicting edition at bundled seed's order, refresh fails and keeps 503 guard active
    let poisoned_s3 = MemS3::default();
    let poisoned_store = Store::new(poisoned_s3.clone()).unwrap();
    poisoned_store
        .publish(
            &FetchedEdition {
                edition: bad_ed,
                pdf: bad_pdf,
            },
            utc_ms("2026-07-01T00:00:00Z"),
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .unwrap();
    let clock_cell3 = Arc::clone(&now_cell);
    let guarded = Arc::new(
        Service::new(
            poisoned_s3,
            Arc::new(move || *clock_cell3.lock().unwrap()),
            20,
            &custom_seeds,
            None,
        )
        .unwrap(),
    );
    guarded.reconcile_once().await;
    assert!(
        guarded.read_year(2027).is_none(),
        "503 restore guard must stay active when S3 conflicts with bundled seed"
    );

    // 2. Public router CORS OPTIONS preflight + conditional GET 304 (CODEX-5)
    let state = Arc::new(server2::SharedState::new(&server2::Config::default()));
    let public = server2::public_router_with_routes(state, router(restarted.clone()));

    let (st, hdrs, body) = send_req(
        &public,
        Request::builder()
            .method(Method::OPTIONS)
            .uri("/calendar/v1/kr/solar-terms/2027")
            .header("origin", "https://app.todayweather.ai")
            .header("access-control-request-method", "GET")
            .header("access-control-request-headers", "if-none-match")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    assert!(body.is_empty());
    assert_eq!(hdrs["access-control-allow-origin"], "*");
    assert_eq!(hdrs["access-control-allow-methods"], "GET,HEAD,OPTIONS");
    assert_eq!(hdrs["access-control-allow-headers"], "if-none-match");
    assert_eq!(hdrs["vary"], "Access-Control-Request-Headers");

    let (st, hdrs, _) = send_req(
        &public,
        Request::get("/calendar/v1/kr/solar-terms/2027")
            .header("origin", "https://app.todayweather.ai")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let etag = hdrs["etag"].to_str().unwrap().to_owned();

    let (st, _, empty) = send_req(
        &public,
        Request::get("/calendar/v1/kr/solar-terms/2027")
            .header("origin", "https://app.todayweather.ai")
            .header("if-none-match", &etag)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_MODIFIED);
    assert!(empty.is_empty());
}

#[tokio::test]
async fn cross_implementation_server1_parity_through_gateway_and_direct_routes() {
    use server2::api::{DirectFamilies, DirectRoutes};
    use server2::domestic::kma::backend::{KmaBackend, KmaSource, SourceAnswer};
    use server2::gateway::{
        BackendDispatcher, BackendHandler, BackendMode, Family, Gateway, GatewayError, Geocoder,
        Version,
    };
    use server2::geocode::{GeoClient, KmaAddress, Location};

    let parity: serde_json::Value = serde_json::from_str(PARITY_FIXTURE).unwrap();
    let cases = &parity["cases"];
    let fixed_now_ms = cases["fixedNowMs"].as_i64().unwrap();
    assert_eq!(
        remaining_seconds("2027-02-04", fixed_now_ms),
        cases["remainingSecondsAtFixedNow"].as_u64().unwrap() as u32
    );
    assert_eq!(
        remaining_seconds("2027-02-04", utc_ms("2027-02-04T14:59:15Z")),
        cases["remainingSecondsNearMidnight"].as_u64().unwrap() as u32
    );

    struct FixedKmaSource(FixtureKmaStore);
    impl KmaSource for FixedKmaSource {
        fn snapshot(
            &self,
            _request: &KmaRequest,
            _deadline: Instant,
        ) -> BoxFuture<'_, SourceAnswer> {
            let s: Box<dyn KmaStore + Send> = Box::new(self.0.clone());
            Box::pin(async move { SourceAnswer::Snapshot(s) })
        }
    }

    struct StubGeocoder;
    impl Geocoder for StubGeocoder {
        fn coord(
            &self,
            loc: [f64; 2],
            _lang: String,
        ) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
            Box::pin(async move {
                if loc[0] > 35.0 && loc[1] > 120.0 {
                    Ok(GeoClient {
                        name: Some("청운효자동".into()),
                        country: Some("KR".into()),
                        address: Some("서울특별시 종로구 청운효자동".into()),
                        location: Some(Location {
                            lat: loc[0],
                            long: loc[1],
                        }),
                        kma_address: Some(KmaAddress {
                            name1: "서울특별시".into(),
                            name2: Some("종로구".into()),
                            name3: Some("청운효자동".into()),
                        }),
                    })
                } else {
                    Ok(GeoClient {
                        name: Some("San Francisco".into()),
                        country: Some("US".into()),
                        address: Some("San Francisco, CA, USA".into()),
                        location: Some(Location {
                            lat: loc[0],
                            long: loc[1],
                        }),
                        kma_address: None,
                    })
                }
            })
        }
        fn addr(
            &self,
            _address: String,
            _lang: String,
        ) -> BoxFuture<'_, Result<GeoClient, GatewayError>> {
            Box::pin(async { Err(GatewayError::NotFound) })
        }
    }

    struct StubWorldBackend;
    impl BackendHandler for StubWorldBackend {
        fn fetch(
            &self,
            _path: String,
            _lang: String,
            _deadline: Instant,
        ) -> BoxFuture<'_, Result<OrderedJson, GatewayError>> {
            Box::pin(async {
                Ok(OrderedJson::parse(
                    br#"{"source":"DSF","thisTime":[{"dateObj":"2027.02.04 10:30","summary":"Clear"}]}"#,
                )
                .unwrap())
            })
        }
    }

    let cal = Arc::new(
        Calendar::new(
            Arc::new(move || fixed_now_ms),
            20,
            &bundled_seeds().unwrap(),
        )
        .unwrap(),
    );
    let lookup: Arc<dyn server2::solar_terms::TermLookup> =
        Arc::new(MemoryLookup::new(cal, Policy::bundled().unwrap()));

    let build_pair_at = |store: FixtureKmaStore, now_ms: i64| {
        let kma = Arc::new(
            KmaBackend::new(
                Arc::new(FixedKmaSource(store)),
                Arc::new(move || now_ms as f64),
                AssemblyConfig::default(),
            )
            .with_solar_terms(Some(lookup.clone())),
        );
        let dispatcher = BackendDispatcher::native_only();
        for v in [Version::V000903, Version::V000901] {
            kma.register_version(&dispatcher, v);
            KmaBackend::select_version(&dispatcher, v, BackendMode::Native).unwrap();
        }
        dispatcher.register_native(Version::V000903, Family::Dsf, Arc::new(StubWorldBackend));
        dispatcher
            .set_backend(Version::V000903, Family::Dsf, BackendMode::Native)
            .unwrap();
        let gw = Arc::new(
            Gateway::with_limits(
                Arc::new(StubGeocoder),
                dispatcher.clone(),
                16,
                Duration::from_secs(5),
            )
            .unwrap()
            .with_clock(Arc::new(move || now_ms)),
        );
        let direct = Arc::new(DirectRoutes::new(
            kma,
            DirectFamilies {
                kma_v000903: true,
                kma_v000901: true,
                town: false,
            },
            dispatcher,
        ));
        (gw, direct)
    };
    let build_pair = |store: FixtureKmaStore| build_pair_at(store, fixed_now_ms);

    // 1. Calm 입춘 through real Gateway and real DirectRoutes
    let (gw, direct) = build_pair(FixtureKmaStore::calm("20270204"));
    let gw_resp = gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(gw_resp.status(), StatusCode::OK);
    let gw_cc = gw_resp.headers()["cache-control"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(gw_cc.contains("must-revalidate"), "got {gw_cc}");
    assert_eq!(gw_resp.headers()["vary"], "Accept-Language");
    let gw_etag = gw_resp.headers()["etag"].to_str().unwrap().to_owned();
    let gw_bytes = axum::body::to_bytes(gw_resp.into_body(), 1_000_000)
        .await
        .unwrap();
    let gw_json: serde_json::Value = serde_json::from_slice(&gw_bytes).unwrap();
    assert_eq!(
        gw_json["current"]["summary"],
        cases["calmIpchunKo"]["summary"]
    );
    assert_eq!(
        gw_json["current"]["summaryForDate"],
        cases["calmIpchunKo"]["summaryForDate"]
    );

    // Gateway ETag 304 revalidation
    let gw_304 = gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .header("if-none-match", &gw_etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(gw_304.status(), StatusCode::NOT_MODIFIED);

    // Direct v000903 route matches server1-parity + Vary: Accept-Language, Cookie + ETag 304
    let direct_path = "/v000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99";
    let dir_resp = direct
        .handle(
            Request::get(direct_path)
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(dir_resp.status(), StatusCode::OK);
    let dir_cc = dir_resp.headers()["cache-control"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(dir_cc.contains("must-revalidate"), "got {dir_cc}");
    assert_eq!(dir_resp.headers()["vary"], "Accept-Language, Cookie");
    let dir_etag = dir_resp.headers()["etag"].to_str().unwrap().to_owned();
    let dir_bytes = axum::body::to_bytes(dir_resp.into_body(), 1_000_000)
        .await
        .unwrap();
    let dir_json: serde_json::Value = serde_json::from_slice(&dir_bytes).unwrap();
    assert_eq!(
        dir_json["current"]["summary"],
        cases["calmIpchunKo"]["summary"]
    );
    assert_eq!(
        dir_json["current"]["summaryForDate"],
        cases["calmIpchunKo"]["summaryForDate"]
    );

    let dir_304 = direct
        .handle(
            Request::get(direct_path)
                .header("accept-language", "ko-KR")
                .header("if-none-match", &dir_etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(dir_304.status(), StatusCode::NOT_MODIFIED);

    // Non-Korean locale through real Gateway and DirectRoutes still carries summaryForDate
    // (ranked KR summary without solar-term name) and emits Vary on both paths.
    let en_resp = gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "en-US")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(en_resp.status(), StatusCode::OK);
    assert!(
        en_resp.headers()["cache-control"]
            .to_str()
            .unwrap()
            .contains("must-revalidate")
    );
    assert_eq!(en_resp.headers()["vary"], "Accept-Language");
    let en_bytes = axum::body::to_bytes(en_resp.into_body(), 1_000_000)
        .await
        .unwrap();
    let en_json: serde_json::Value = serde_json::from_slice(&en_bytes).unwrap();
    assert_eq!(
        en_json["current"]["summary"],
        cases["nonKoreanEn"]["summary"]
    );
    assert_eq!(
        en_json["current"]["summaryForDate"],
        cases["nonKoreanEn"]["summaryForDate"]
    );

    // Older KMA version (v000901) & default unversioned gateway routes emit Vary: Accept-Language
    // (matching server/routes/gateway.js::sendJson) while omitting must-revalidate and summaryForDate.
    for path in [
        "/weather/v000901/coord/37.566,126.978",
        "/weather/coord/37.566,126.978",
    ] {
        let v901_gw = gw
            .handle(
                Request::get(path)
                    .header("accept-language", "ko-KR")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        assert_eq!(v901_gw.status(), StatusCode::OK, "{path}");
        assert_eq!(v901_gw.headers()["cache-control"], "max-age=300", "{path}");
        assert_eq!(v901_gw.headers()["vary"], "Accept-Language", "{path}");
        let v901_bytes = axum::body::to_bytes(v901_gw.into_body(), 1_000_000)
            .await
            .unwrap();
        let v901_json: serde_json::Value = serde_json::from_slice(&v901_bytes).unwrap();
        assert!(
            v901_json["current"].get("summaryForDate").is_none(),
            "{path}"
        );
    }

    // Geocode JSON responses through Gateway also emit Vary: Accept-Language without must-revalidate.
    let geo_gw = gw
        .handle(
            Request::get("/geocode/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(geo_gw.status(), StatusCode::OK);
    assert_eq!(geo_gw.headers()["cache-control"], "max-age=2592000");
    assert_eq!(geo_gw.headers()["vary"], "Accept-Language");

    // Gateway error responses (sendError) keep Cache-Control: no-store without Vary.
    let bad_gw = gw
        .handle(
            Request::get("/weather/coord/not-a-coordinate")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(bad_gw.status(), StatusCode::BAD_REQUEST);
    assert_eq!(bad_gw.headers()["cache-control"], "no-store");
    assert!(bad_gw.headers().get("vary").is_none());

    // Direct v000901 omits Vary, while direct v000903 ALWAYS emits Vary: Accept-Language, Cookie
    // even when solar_terms is absent (undated v000903 response, 200 and 304).
    let v901_dir = direct
        .handle(
            Request::get("/v000901/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(v901_dir.status(), StatusCode::OK);
    assert!(v901_dir.headers().get("vary").is_none());

    let plain_kma = Arc::new(KmaBackend::new(
        Arc::new(FixedKmaSource(FixtureKmaStore::calm("20270204"))),
        Arc::new(move || fixed_now_ms as f64),
        AssemblyConfig::default(),
    ));
    let plain_dispatcher = BackendDispatcher::native_only();
    plain_kma.register_version(&plain_dispatcher, Version::V000903);
    KmaBackend::select_version(&plain_dispatcher, Version::V000903, BackendMode::Native).unwrap();
    let plain_gw = Arc::new(
        Gateway::with_limits(
            Arc::new(StubGeocoder),
            plain_dispatcher.clone(),
            16,
            Duration::from_secs(5),
        )
        .unwrap()
        .with_clock(Arc::new(move || fixed_now_ms)),
    );
    let plain_direct = Arc::new(DirectRoutes::new(
        plain_kma,
        DirectFamilies {
            kma_v000903: true,
            kma_v000901: true,
            town: false,
        },
        plain_dispatcher,
    ));

    let plain_gw_resp = plain_gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(plain_gw_resp.status(), StatusCode::OK);
    assert_eq!(plain_gw_resp.headers()["cache-control"], "max-age=300");
    assert_eq!(plain_gw_resp.headers()["vary"], "Accept-Language");

    let plain_dir_200 = plain_direct
        .handle(
            Request::get(direct_path)
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(plain_dir_200.status(), StatusCode::OK);
    assert!(plain_dir_200.headers().get("cache-control").is_none());
    assert_eq!(plain_dir_200.headers()["vary"], "Accept-Language, Cookie");
    let plain_dir_etag = plain_dir_200.headers()["etag"].to_str().unwrap().to_owned();
    let plain_dir_bytes = axum::body::to_bytes(plain_dir_200.into_body(), 1_000_000)
        .await
        .unwrap();
    let plain_dir_json: serde_json::Value = serde_json::from_slice(&plain_dir_bytes).unwrap();
    assert!(plain_dir_json["current"].get("summaryForDate").is_none());

    let plain_dir_304 = plain_direct
        .handle(
            Request::get(direct_path)
                .header("accept-language", "ko-KR")
                .header("if-none-match", &plain_dir_etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(plain_dir_304.status(), StatusCode::NOT_MODIFIED);
    assert!(plain_dir_304.headers().get("cache-control").is_none());
    assert_eq!(plain_dir_304.headers()["vary"], "Accept-Language, Cookie");

    // Uppercase /V000903/ drops req.version in controllerTown24h.js and omits Vary; 404 omits Vary.
    let upper_dir = plain_direct
        .handle(
            Request::get("/V000903/kma/addr/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C/%EC%A2%85%EB%A1%9C%EA%B5%AC/%EC%B2%AD%EC%9A%B4%ED%9A%A8%EC%9E%90%EB%8F%99")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(upper_dir.status(), StatusCode::OK);
    assert!(upper_dir.headers().get("vary").is_none());

    let err_dir = plain_direct
        .handle(
            Request::get("/v000903/kma/addr/a/b/c/d")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(err_dir.status(), StatusCode::NOT_FOUND);
    assert!(err_dir.headers().get("vary").is_none());

    // Overseas (US / DSF) control through real Gateway: Vary: Accept-Language, max-age=300 without must-revalidate.
    let us_resp = gw
        .handle(
            Request::get("/weather/v000903/coord/37.77,-122.42")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(us_resp.status(), StatusCode::OK);
    assert_eq!(us_resp.headers()["cache-control"], "max-age=300");
    assert_eq!(us_resp.headers()["vary"], "Accept-Language");

    // 2. Hazardous 입춘 through real Gateway matches server1-parity
    let mut haz_store = FixtureKmaStore::calm("20270204");
    haz_store.pm25_grade = Some(4);
    haz_store.warnings = Ok(serde_json::json!([{
        "areaCode": "L1100400",
        "areaName": "서울서북권",
        "warnVar": 3,
        "warnStress": 0,
        "active": true,
        "command": "1",
        "eventTmFc": 202702040900_i64,
        "eventTmSeq": 1,
        "eventRank": 1
    }]));
    let (haz_gw, _) = build_pair(haz_store);
    let haz_resp = haz_gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(haz_resp.status(), StatusCode::OK);
    let haz_bytes = axum::body::to_bytes(haz_resp.into_body(), 1_000_000)
        .await
        .unwrap();
    let haz_json: serde_json::Value = serde_json::from_slice(&haz_bytes).unwrap();
    assert_eq!(
        haz_json["current"]["summary"],
        cases["hazardousIpchunKo"]["summary"]
    );
    assert_eq!(
        haz_json["current"]["summaryForDate"],
        cases["hazardousIpchunKo"]["summaryForDate"]
    );

    // 3. Exact KST-midnight max-age=45 on BOTH 200 and 304 through real Gateway and DirectRoutes (CODEX-10)
    let near_midnight_ms = cases["nearMidnightMs"].as_i64().unwrap();
    let (nm_gw, nm_direct) = build_pair_at(FixtureKmaStore::calm("20270204"), near_midnight_ms);

    let nm_gw_200 = nm_gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(nm_gw_200.status(), StatusCode::OK);
    assert_eq!(
        nm_gw_200.headers()["cache-control"],
        "max-age=45, must-revalidate"
    );
    assert_eq!(nm_gw_200.headers()["vary"], "Accept-Language");
    let nm_gw_etag = nm_gw_200.headers()["etag"].to_str().unwrap().to_owned();

    let nm_gw_304 = nm_gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .header("if-none-match", &nm_gw_etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(nm_gw_304.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        nm_gw_304.headers()["cache-control"],
        "max-age=45, must-revalidate"
    );
    assert_eq!(nm_gw_304.headers()["vary"], "Accept-Language");

    let nm_dir_200 = nm_direct
        .handle(
            Request::get(direct_path)
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(nm_dir_200.status(), StatusCode::OK);
    assert_eq!(
        nm_dir_200.headers()["cache-control"],
        "max-age=45, must-revalidate"
    );
    assert_eq!(nm_dir_200.headers()["vary"], "Accept-Language, Cookie");
    let nm_dir_etag = nm_dir_200.headers()["etag"].to_str().unwrap().to_owned();

    let nm_dir_304 = nm_direct
        .handle(
            Request::get(direct_path)
                .header("accept-language", "ko-KR")
                .header("if-none-match", &nm_dir_etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(nm_dir_304.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        nm_dir_304.headers()["cache-control"],
        "max-age=45, must-revalidate"
    );
    assert_eq!(nm_dir_304.headers()["vary"], "Accept-Language, Cookie");

    // 4. Spare (경칩), calendar-only (곡우), and heavy-rain warning + thunderstorm/hail parity (CODEX-10)
    let policy = Policy::bundled().unwrap();
    let labels = Labels {
        temp: "기온".into(),
        today: "오늘".into(),
        lowest: "최저".into(),
        highest: "최고".into(),
    };
    let gyeongchip = lookup.term_for_date("2027-03-06").unwrap();
    let gogu = lookup.term_for_date("2027-04-20").unwrap();
    let ipchun = lookup.term_for_date("2027-02-04").unwrap();

    // Spare without daily range enters slot 2; with daily range, range + weather beat spare
    let calm_no_air_items = vec![SummaryItem {
        kind: ItemKind::Weather,
        text: "맑음".into(),
        grade: 1.0,
    }];
    let calm_snap = CurrentSnapshot {
        weather_type: Some(1),
        pty: Some(0),
        rn1: Some(0.0),
        ultrv_grade: None,
        wsd_grade: Some(0),
        dspls_grade: None,
        sensorytem: None,
        heat_index_grade: None,
        t1h: Some(12.0),
        t1h_text: Some("12".into()),
        temp_unit_f: false,
        warnings: vec![],
        gases: vec![],
    };
    assert_eq!(
        select(
            &policy,
            &calm_no_air_items,
            &calm_snap,
            Some(&gyeongchip),
            None,
            &labels
        ),
        cases["spareGyeongchipCalmNoRangeKo"]["summary"]
            .as_str()
            .unwrap()
    );
    let gyeongchip_range = DailyRange {
        date: "20270306".into(),
        min: "18".into(),
        max: "28".into(),
        extreme: false,
    };
    assert_eq!(
        select(
            &policy,
            &calm_no_air_items,
            &calm_snap,
            Some(&gyeongchip),
            Some(&gyeongchip_range),
            &labels
        ),
        cases["spareGyeongchipWithRangeKo"]["summary"]
            .as_str()
            .unwrap()
    );
    // Calendar-only (곡우) never enters summary even on calm day without daily range
    assert_eq!(
        select(
            &policy,
            &calm_no_air_items,
            &calm_snap,
            Some(&gogu),
            None,
            &labels
        ),
        cases["calendarOnlyGoguKo"]["summary"].as_str().unwrap()
    );

    // Real Gateway check on spare (경칩 with range -> range wins) and calendar-only (곡우 -> omitted)
    let gyeongchip_ms = utc_ms("2027-03-06T01:30:00Z");
    let (sp_gw, _) = build_pair_at(FixtureKmaStore::calm("20270306"), gyeongchip_ms);
    let sp_resp = sp_gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(sp_resp.status(), StatusCode::OK);
    let sp_json: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(sp_resp.into_body(), 1_000_000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        sp_json["current"]["summary"],
        cases["spareGyeongchipWithRangeKo"]["summary"]
    );
    assert_eq!(sp_json["current"]["summaryForDate"], "2027-03-06");

    let gogu_ms = utc_ms("2027-04-20T01:30:00Z");
    let (go_gw, _) = build_pair_at(FixtureKmaStore::calm("20270420"), gogu_ms);
    let go_resp = go_gw
        .handle(
            Request::get("/weather/v000903/coord/37.566,126.978")
                .header("accept-language", "ko-KR")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(go_resp.status(), StatusCode::OK);
    let go_json: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(go_resp.into_body(), 1_000_000)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        !go_json["current"]["summary"]
            .as_str()
            .unwrap()
            .contains("곡우")
    );
    assert_eq!(go_json["current"]["summaryForDate"], "2027-04-20");

    // Heavy-rain warning + thunderstorm (weatherType=50) and heavy-rain warning + hail (weatherType=49)
    let rain_warning = WarningItem {
        weather: 3,
        level: 1,
        text: "호우주의보".into(),
    };
    let ipchun_range = DailyRange {
        date: "20270204".into(),
        min: "18".into(),
        max: "28".into(),
        extreme: false,
    };
    let mut thunder_snap = calm_snap.clone();
    thunder_snap.weather_type = Some(50);
    thunder_snap.pty = Some(1);
    thunder_snap.rn1 = Some(12.0);
    thunder_snap.warnings = vec![rain_warning.clone()];
    let thunder_items = vec![
        SummaryItem {
            kind: ItemKind::Weather,
            text: "천둥번개".into(),
            grade: 1.0,
        },
        SummaryItem {
            kind: ItemKind::Wind,
            text: "약한 바람".into(),
            grade: 1.0,
        },
    ];
    assert_eq!(
        select(
            &policy,
            &thunder_items,
            &thunder_snap,
            Some(&ipchun),
            Some(&ipchun_range),
            &labels
        ),
        cases["heavyRainWarningPlusThunderstormKo"]["summary"]
            .as_str()
            .unwrap()
    );

    let mut hail_snap = thunder_snap;
    hail_snap.weather_type = Some(49);
    let hail_items = vec![
        SummaryItem {
            kind: ItemKind::Weather,
            text: "우박".into(),
            grade: 1.0,
        },
        SummaryItem {
            kind: ItemKind::Wind,
            text: "약한 바람".into(),
            grade: 1.0,
        },
    ];
    assert_eq!(
        select(
            &policy,
            &hail_items,
            &hail_snap,
            Some(&ipchun),
            Some(&ipchun_range),
            &labels
        ),
        cases["heavyRainWarningPlusHailKo"]["summary"]
            .as_str()
            .unwrap()
    );
}
