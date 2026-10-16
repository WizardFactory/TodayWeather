//! The V8 `Date.parse` port equals the pinned legacy runtime (Node.js v16.20.2, TZ=UTC) on the
//! recorded corpus (`fixtures/v8-date-parse.json.gz`, generator `fixtures/v8_date_corpus.js`).
use server2::domestic::kma::dateparse::date_parse_utf16;
use std::io::Read;

#[test]
fn date_parse_equals_node_16_on_the_recorded_corpus() {
    let gz = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/domestic/fixtures/v8-date-parse.json.gz"
    ))
    .unwrap();
    let mut raw = String::new();
    flate2::read::GzDecoder::new(&gz[..])
        .read_to_string(&mut raw)
        .unwrap();
    let recorded: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(recorded["runtime"], "v16.20.2");
    assert_eq!(recorded["tz"], "UTC");
    let cases = recorded["cases"].as_array().unwrap();
    assert!(cases.len() > 20_000);
    let mut differ = Vec::new();
    let mut numbers = 0;
    for case in cases {
        let units: Vec<u16> = case[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| u.as_u64().unwrap() as u16)
            .collect();
        let got = date_parse_utf16(&units);
        let ok = match case[1].as_f64() {
            None => got.is_nan(),
            Some(want) => {
                numbers += 1;
                got == want
            }
        };
        if !ok {
            differ.push(format!(
                "{:?}: node {} port {got}",
                String::from_utf16_lossy(&units),
                case[1]
            ));
        }
    }
    assert!(numbers > 2_000, "{numbers}");
    assert!(
        differ.is_empty(),
        "{} of {} differ:\n{}",
        differ.len(),
        cases.len(),
        differ[..differ.len().min(40)].join("\n")
    );
}
