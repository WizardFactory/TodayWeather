//! Non-writing operator verification CLI for Korea's 24 solar terms (월력요항).
//!
//! Usage:
//!   cargo run --example solar_term_almanac -- 2027
//!   cargo run --example solar_term_almanac -- 2027 /path/to/2027.pdf 'https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?...'

use server2::solar_terms::calendar::{
    calculate, format_utc_iso, minutes_from_kst_midnight, sha256_hex,
};
use server2::solar_terms::official::{
    GazetteSource, OfficialSource, ReqwestFetcher, parse_edition,
};
use server2::solar_terms::pdf;
use std::time::Duration;
use tokio::time::Instant;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("Usage: solar_term_almanac <year> [pdf_path canonical_url]");
        std::process::exit(2);
    }
    let year: i32 = match args[0].parse() {
        Ok(y) if (1900..=3000).contains(&y) => y,
        _ => {
            eprintln!("Invalid year: {}", args[0]);
            std::process::exit(2);
        }
    };

    let edition = if args.len() >= 3 {
        let pdf_bytes = match std::fs::read(&args[1]) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("Failed to read PDF {}: {e}", args[1]);
                std::process::exit(1);
            }
        };
        let digest = sha256_hex(&pdf_bytes);
        let text = match pdf::extract_text(&pdf_bytes) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("Failed to extract PDF text: {e}");
                std::process::exit(1);
            }
        };
        match parse_edition(year, &args[2], &digest, &text) {
            Ok(ed) => ed,
            Err(e) => {
                eprintln!("Failed to parse official edition: {e}");
                std::process::exit(1);
            }
        }
    } else if args.len() == 1 {
        let fetcher = match ReqwestFetcher::new() {
            Ok(f) => f,
            Err(e) => {
                eprintln!("HTTP client error: {e}");
                std::process::exit(1);
            }
        };
        let source = GazetteSource::new(fetcher);
        let deadline = Instant::now() + Duration::from_secs(60);
        match source.fetch_edition(year, deadline).await {
            Ok(fetched) => fetched.edition,
            Err(e) => {
                eprintln!("Failed to fetch official edition for {year}: {e}");
                std::process::exit(1);
            }
        }
    } else {
        eprintln!("Usage: solar_term_almanac <year> [pdf_path canonical_url]");
        std::process::exit(2);
    };

    let calculated = match calculate(year) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Calculation failed: {e}");
            std::process::exit(1);
        }
    };

    println!(
        "edition={} published={} digest={}",
        edition.id, edition.publication_date, edition.source_digest
    );
    let mut diffs = 0usize;
    for (calc, official_date) in calculated.iter().zip(edition.dates.iter()) {
        let near = minutes_from_kst_midnight(calc.utc_ms) <= 30.0;
        let corrected = &calc.date != official_date;
        if corrected {
            diffs += 1;
        }
        println!(
            "{:<9} {} utc={} calc={} official={} corrected={} near_midnight={}",
            calc.id,
            calc.name_ko,
            format_utc_iso(calc.utc_ms),
            calc.date,
            official_date,
            corrected,
            near
        );
    }
    println!("summary: total=24 corrections={diffs}");
}
