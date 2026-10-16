//! `req.query` equals the legacy Express 4.13.4 query parser (`qs` 4.0.0, Node.js v16.20.2) on the
//! recorded corpus (`fixtures/qs-parse.json.gz`, generator `fixtures/qs_corpus.js`): the
//! `JSON.stringify` of the result and property reads that see the prototype.
use server2::domestic::kma::js::to_json;
use server2::domestic::kma::qs::parse;
use std::io::Read;

#[test]
fn req_query_equals_express_4_13_4_on_the_recorded_corpus() {
    let gz = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/domestic/fixtures/qs-parse.json.gz"
    ))
    .unwrap();
    let mut raw = String::new();
    flate2::read::GzDecoder::new(&gz[..])
        .read_to_string(&mut raw)
        .unwrap();
    let recorded: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(recorded["runtime"], "v16.20.2");
    assert_eq!(recorded["express"], "4.13.4");
    assert_eq!(recorded["qs"], "4.0.0");
    let probes: Vec<&str> = recorded["probes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    let cases = recorded["cases"].as_array().unwrap();
    assert!(cases.len() > 8_000);
    let mut differ = Vec::new();
    for case in cases {
        let query = case[0].as_str().unwrap();
        let value = parse(query);
        let json = String::from_utf8(to_json(&value).unwrap().to_bytes()).unwrap();
        if json != case[1].as_str().unwrap() {
            differ.push(format!("{query:?}: node {} port {json}", case[1]));
            continue;
        }
        for (i, probe) in probes.iter().enumerate() {
            let got = to_json(&value.get(probe)).map(|j| String::from_utf8(j.to_bytes()).unwrap());
            let want = case[2][i].as_str().map(str::to_owned);
            if got != want {
                differ.push(format!("{query:?} .{probe}: node {want:?} port {got:?}"));
            }
        }
    }
    assert!(
        differ.is_empty(),
        "{} of {} differ:\n{}",
        differ.len(),
        cases.len(),
        differ[..differ.len().min(40)].join("\n")
    );
}

#[test]
fn array_prototypes_preserve_query_coercion_and_unit_defaults() {
    use server2::domestic::kma::js::{V, loose_eq, to_str};
    let query = parse("temperatureUnit[__proto__][]=F");
    assert_eq!(to_str(&query.get("temperatureUnit")), "F");
    assert!(loose_eq(&query.get("temperatureUnit"), &V::s("F")));
    let query = parse("temperatureUnit[__proto__][]=(null)");
    assert!(loose_eq(&query.get("temperatureUnit"), &V::s("(null)")));
    let query = parse("temperatureUnit[__proto__][]=F&temperatureUnit[join]=x");
    assert_eq!(to_str(&query.get("temperatureUnit")), "[object Object]");
    for (raw, expected) in [
        ("u[__proto__][]=F&u[length]=4", "F,,,"),
        ("u[__proto__][2]=F&u[length]=4", ",,F,"),
        ("u[__proto__][]=F&u[0]=C&u[length]=2", "C,"),
    ] {
        assert_eq!(to_str(&parse(raw).get("u")), expected);
    }
    // V8 rejects this string size. The sparse port checks before allocating holes.
    let query = parse("u[__proto__][]=F&u[length]=536870890");
    assert!(server2::domestic::kma::js::catch(|| to_str(&query.get("u"))).is_err());
    for length in ["1e20", "Infinity", "4294967296"] {
        let query = parse(&format!("u[__proto__][]=F&u[length]={length}"));
        assert!(server2::domestic::kma::js::catch(|| to_str(&query.get("u"))).is_err());
    }
}
