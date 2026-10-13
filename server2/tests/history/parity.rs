//! Differential check: the offline converter and the Rust importer accept or reject the same
//! documents. Each case runs the converter on a one-line export and parses a hand-built seed
//! holding the same document bytes with the Rust parser.
use super::support::*;
use server2::history::legacy::parse_seed;
use server2::storage::sha256;

const EXPORTED: &str = "2026-09-24T02:10:00.000Z";

fn current(pub_date: &str, date: &str, t1h: &str) -> String {
    format!(
        r#"{{"mCoord":{{"mx":60,"my":127}},"pubDate":{pub_date},"fcsDate":{{"$date":"2026-09-24T01:00:00Z"}},"currentData":{{"date":{date},"time":"1000","t1h":{t1h}}}}}"#
    )
}
fn t1h(value: &str) -> String {
    current(
        r#"{"$date":"2026-09-24T01:00:00Z"}"#,
        r#""20260924""#,
        value,
    )
}
fn pub_date(value: &str) -> String {
    current(value, r#""20260924""#, "21.3")
}
fn date(value: &str) -> String {
    current(r#"{"$date":"2026-09-24T01:00:00Z"}"#, value, "21.3")
}
fn station(id: &str) -> String {
    format!(r#"{{"stnId":{id},"date":{{"$date":"2026-09-24T09:03:00Z"}},"t1h":20.5}}"#)
}
/// (collection, Rust seed key, document line)
fn cases() -> Vec<(&'static str, &'static str, String)> {
    let grid = r#"{"type":"grid","nx":60,"ny":127}"#;
    let stn = r#"{"type":"station","id":108}"#;
    let long_zeros = format!(r#"{{"$numberLong":"{}1"}}"#, "0".repeat(4400));
    let huge_int = format!("1{}", "0".repeat(400));
    let mut out: Vec<(&'static str, &'static str, String)> = [
        "21.3",
        "NaN",
        "Infinity",
        "-Infinity",
        "1e400",
        "-1e400",
        "1e-400",
        "1.7976931348623157e308",
        "1.7976931348623158e308",
        "1.7976931348623159e308",
        "4.9e-324",
        "-0",
        "-0.0",
        "0",
        "1e308",
        "123456789012345678901234567890",
        r#""str""#,
        "true",
        "null",
        "[]",
        "{}",
        r#"{"a":1}"#,
        r#"{"$numberLong":"10"}"#,
        r#"{"$numberLong":"+10"}"#,
        r#"{"$numberLong":" 10"}"#,
        r#"{"$numberLong":"1_0"}"#,
        r#"{"$numberLong":"10\n"}"#,
        r#"{"$numberLong":"00010"}"#,
        r#"{"$numberLong":"9223372036854775807"}"#,
        r#"{"$numberLong":"9223372036854775808"}"#,
        r#"{"$numberLong":"-9223372036854775808"}"#,
        r#"{"$numberInt":"-5"}"#,
        r#"{"$numberLong":"1.0"}"#,
        r#"{"$numberLong":10}"#,
        r#"{"$numberDouble":"1.5"}"#,
        r#"{"$numberDouble":"Infinity"}"#,
        r#"{"$numberDouble":"inf"}"#,
        r#"{"$numberDouble":"1e"}"#,
        r#"{"$numberDouble":".5"}"#,
        r#"{"$numberDouble":"5."}"#,
        r#"{"$numberDouble":"1e400"}"#,
        r#"{"$numberDecimal":"2.5"}"#,
        r#"{"$numberDouble":"1.0","x":1}"#,
        r#"{"$date":"2026-09-24T01:00:00Z"}"#,
        r#"{"$oid":"66f2f0a0c0ffee0000000001"}"#,
    ]
    .into_iter()
    .map(|v| ("kma.town.current", grid, t1h(v)))
    .collect();
    out.push(("kma.town.current", grid, t1h(&long_zeros)));
    out.push(("kma.town.current", grid, t1h(&huge_int)));
    for v in [
        r#"{"$date":"2026-09-24T01:00:00Z"}"#,
        r#"{"$date":"2026-09-24T10:00:00+09:00"}"#,
        r#"{"$date":"2026-09-24T01:00:00.123456789Z"}"#,
        r#"{"$date":"2026-09-24T01:00:00Z\n"}"#,
        r#"{"$date":"2026-09-24 01:00:00Z"}"#,
        r#"{"$date":"2026-02-30T01:00:00Z"}"#,
        r#"{"$date":"2026-09-24T24:00:00Z"}"#,
        r#"{"$date":"1969-12-31T23:59:59Z"}"#,
        r#"{"$date":"9999-12-31T14:59:59Z"}"#,
        r#"{"$date":"9999-12-31T15:00:00Z"}"#,
        r#"{"$date":0}"#,
        r#"{"$date":-0}"#,
        r#"{"$date":0.0}"#,
        r#"{"$date":1790211600000}"#,
        r#"{"$date":{"$numberLong":"1790211600000"}}"#,
        r#"{"$date":{"$numberLong":"-0"}}"#,
        r#"{"$date":{"$numberLong":"9223372036854775807"}}"#,
        r#"{"$date":{"$numberInt":"0"}}"#,
        r#""2026-09-24T01:00:00Z""#,
        "\"\u{ff12}\u{ff10}\u{ff12}\u{ff16}-09-24T01:00:00Z\"",
    ] {
        out.push(("kma.town.current", grid, pub_date(v)));
    }
    for v in [
        r#""20260924""#,
        r#""\ud800""#,
        r#""\udc00""#,
        r#""😀""#,
        r#""A""#,
        r#""한글""#,
    ] {
        out.push(("kma.town.current", grid, date(v)));
    }
    for v in [
        "108",
        "108.0",
        "107.9999999999999929",
        "1.08e2",
        r#"{"$numberInt":"108"}"#,
        r#"{"$numberLong":"0108"}"#,
        r#""108""#,
        "0",
        "-108",
        "108.5",
        "4294967296",
    ] {
        out.push(("KmaStnMinute2", stn, station(v)));
    }
    out
}

#[test]
fn legacy_converter_and_importer_agree_on_edge_cases() {
    let mut mismatches = Vec::new();
    let mut accepted = 0;
    for (i, (collection, key, doc)) in cases().iter().enumerate() {
        let input = temp_path(&format!("parity-in-{i}"));
        std::fs::write(&input, format!("{doc}\n")).unwrap();
        let output = temp_path(&format!("parity-out-{i}"));
        let _ = std::fs::remove_file(&output);
        let (code, _, stderr) = convert(&[
            "--collection",
            collection,
            "--db-version",
            "2.0",
            "--exported-at",
            EXPORTED,
            "--input",
            input.to_str().unwrap(),
            "--output",
            output.to_str().unwrap(),
        ]);
        assert!(
            code == 0 || code == 2,
            "converter crashed on {doc}: {stderr}"
        );
        let python = code == 0;
        if python {
            // Whatever the converter writes must import.
            let seed = std::fs::read(&output).unwrap();
            assert!(
                parse_seed(&seed).is_ok(),
                "converter output rejected: {doc}"
            );
        }
        let source = std::fs::read(&input).unwrap();
        let manifest = format!(
            r#"{{"schema":1,"tool":"export_history_seeds","collection":"{collection}","dbVersion":"2.0","exportedAt":"{EXPORTED}","sourceSha256":"{}","documents":1,"groups":1}}"#,
            sha256(&source)
        );
        let seed = format!(
            r#"{manifest}
{{"key":{key},"lines":[1],"documents":[{doc}]}}
"#
        );
        let rust = parse_seed(seed.as_bytes()).is_ok();
        accepted += usize::from(rust);
        if python != rust {
            mismatches.push(format!("python={python} rust={rust}: {doc}"));
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
    assert!(
        accepted >= 25,
        "edge cases must include accepted documents: {accepted}"
    );
}
