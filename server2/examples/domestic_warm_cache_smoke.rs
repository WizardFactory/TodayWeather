//! Full-window synthetic S06 baseline. Loopback only; no dotenv or live providers.
//! seed publishes exact raw formats; diagnostic uses public source answers with60s,
//! native uses KmaBackend's unchanged3s ceiling; http serves the normal direct route.
//! Neither diagnostic nor this owned HTTP harness is a capacity qualification.
use rusty_s3::Credentials;
use serde_json::{Value, json};
use server2::{
    domestic::{
        Acquired, DomesticError,
        asos::AsosRequest,
        family::WebRequest,
        kma::{
            AssemblyConfig, MidModel, Outcome,
            backend::{KmaBackend, parse_path},
            source::{
                self, Coord, Doc, Family, Fetched, Organized, S3Source, Slot,
                observe::{Acquire, Locate},
            },
        },
        publication::{self, Publication},
    },
    gateway::{BoxFuture, OrderedJson},
    history::{Grid, schedule},
    storage::{
        CatalogId, CatalogLimits, CatalogStore, GroupDeclaration, GroupMember, HttpS3Transport,
        Pagination, ProviderKey, RawRecord, sha256,
    },
    world::BoundedS3,
};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::time::Instant;
const NOW: i64 = 1_790_214_600_000; // 2026-09-24 10:50 KST.
const HOUR: i64 = 3_600_000;
type Transport = BoundedS3<HttpS3Transport>;
fn transport(endpoint: &str) -> Transport {
    BoundedS3::new(
        HttpS3Transport::new(
            endpoint,
            "server2-local",
            "ap-northeast-2",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap(),
        4,
    )
}
fn disk_transport(endpoint: &str, directory: &Path) -> Transport {
    let settings = server2::storage::S3Settings::from_vars_at(
        &|name| match name {
            "AWS_ACCESS_KEY" => Some("server2-local".into()),
            "AWS_SECRET_KEY" => Some("server2-local-secret".into()),
            "SERVER2_S3_BUCKET" => Some("server2-local".into()),
            "SERVER2_LOCAL_CACHE_DIR" => Some(directory.to_str().unwrap().into()),
            _ => None,
        },
        Some(endpoint),
    )
    .unwrap();
    BoundedS3::new(settings.transport().unwrap(), 4)
}

#[derive(Default)]
// Aggregate, web and ASOS denied adapter invocations. These methods have no HTTP client;
// they cannot make external provider requests. Counts are observations, never194/2 assumptions.
struct Off(AtomicUsize, AtomicUsize, AtomicUsize);
impl Acquire for Off {
    fn web(&self, _: WebRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        self.1.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(DomesticError::Transport) })
    }
    fn asos(&self, _: AsosRequest, _: Instant) -> BoxFuture<'_, Result<Acquired, DomesticError>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        self.2.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(DomesticError::Transport) })
    }
}
impl Locate for Off {
    fn locate(&self, _: String) -> BoxFuture<'_, Option<(f64, f64)>> {
        Box::pin(async { None })
    }
}
struct Input {
    label: String,
    source: &'static str,
    kind: &'static str,
    key: ProviderKey,
    p: Publication,
    fetched: u64,
    bytes: Vec<u8>,
    content_type: &'static str,
}
fn envelope(items: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
        "body":{"dataType":"JSON","items":{"item":items},"pageNo":1,"numOfRows":999,"totalCount":items.len()}}})).unwrap()
}
fn grid_page(family: Family, p: Publication) -> Vec<u8> {
    let base = if family == Family::Shortest {
        schedule::from_ms(schedule::to_ms(p) + 30 * 60_000)
    } else {
        p
    };
    let base_values = [
        ("PTY", "0"),
        ("REH", "60"),
        ("RN1", "0"),
        ("T1H", "21.5"),
        ("UUU", "1.2"),
        ("VEC", "200"),
        ("VVV", "-0.5"),
        ("WSD", "2.1"),
    ];
    if family == Family::Current {
        return envelope(base_values.iter().map(|(c,v)| json!({"baseDate":p.base_date(),"baseTime":p.base_time(),"category":c,"nx":60,"ny":127,"obsrValue":v})).collect());
    }
    let mut at = vec![];
    if family == Family::Shortest {
        at.extend((1..=30).map(|h| p.add_hours(h).unwrap()));
    } else {
        let midnight = Publication::new(p.date(), 0).unwrap();
        let extension = midnight
            .add_hours(if p.hour() >= 17 { 96 } else { 72 })
            .unwrap();
        let mut t = p.add_hours(1).unwrap();
        while t < extension {
            at.push(t);
            t = t.add_hours(1).unwrap();
        }
        for h in (0..24).step_by(3) {
            at.push(extension.add_hours(h).unwrap());
        }
        let tail = *at.last().unwrap();
        at.extend((1..=24).map(|h| tail.add_hours(h).unwrap()));
    }
    let values = if family == Family::Shortest {
        vec![
            ("LGT", "0"),
            ("PTY", "0"),
            ("RN1", "강수없음"),
            ("SKY", "3"),
            ("T1H", "19"),
            ("REH", "65"),
            ("UUU", "0.4"),
            ("VVV", "-1.1"),
            ("VEC", "250"),
            ("WSD", "3"),
            ("POP", "20"),
        ]
    } else {
        vec![
            ("TMP", "17"),
            ("UUU", "1.1"),
            ("VVV", "-0.4"),
            ("VEC", "180"),
            ("WSD", "2.5"),
            ("SKY", "1"),
            ("PTY", "0"),
            ("POP", "10"),
            ("PCP", "강수없음"),
            ("REH", "70"),
            ("SNO", "적설없음"),
            ("TMN", "12"),
            ("TMX", "24"),
        ]
    };
    let items:Vec<_>=at.iter().flat_map(|t| values.iter().map(move |(c,v)|json!({"baseDate":base.base_date(),"baseTime":base.base_time(),"category":c,"fcstDate":t.base_date(),"fcstTime":t.base_time(),"fcstValue":v,"nx":60,"ny":127}))).collect();
    let bytes = envelope(items);
    let parsed = source::items(&[&bytes]).unwrap();
    let compact = base.compact();
    match source::collect(
        family,
        &parsed,
        &Slot::new(&compact[..8], &compact[8..]),
        Coord { mx: 60., my: 127. },
    ) {
        Organized::Rows(rows) => assert_eq!(
            rows.len(),
            at.len(),
            "all horizon/trailing rows must be admitted"
        ),
        other => panic!("invalid synthetic forecast {family:?} {p:?}: {other:?}"),
    }
    bytes
}
fn rss_page(p: Publication) -> Vec<u8> {
    let mut rows = String::new();
    for (seq, h) in ((i64::from(p.hour()) + 3)..72).step_by(3).enumerate() {
        rows.push_str(&format!(r#"<data seq="{seq}"><hour>{}</hour><day>{}</day><temp>18.0</temp><tmx>24.0</tmx><tmn>12.0</tmn><sky>1</sky><pty>0</pty><wfKor>맑음</wfKor><wfEn>Clear</wfEn><pop>0</pop><r12>0.0</r12><s12>0.0</s12><ws>1.8</ws><wd>6</wd><wdKor>서</wdKor><wdEn>W</wdEn><reh>55</reh><r06>0.0</r06><s06>0.0</s06></data>"#,h%24,h/24));
    }
    format!(r#"<?xml version="1.0" encoding="UTF-8"?><wid><header><tm>{}</tm><ts>3</ts><x>60</x><y>127</y></header><body>{rows}</body></wid>"#,p.compact()).into_bytes()
}
fn mids() -> Vec<(MidModel, &'static str, &'static str, &'static str)> {
    vec![
        (MidModel::Forecast, "109", "mid-fcst", "stn-109"),
        (MidModel::Land, "11B00000", "mid-land-fcst", "reg-11b00000"),
        (MidModel::Temp, "11B10101", "mid-ta", "reg-11b10101"),
        (MidModel::Forecast, "159", "mid-fcst", "stn-159"),
        (MidModel::Land, "11H20000", "mid-land-fcst", "reg-11h20000"),
        (MidModel::Temp, "11H20201", "mid-ta", "reg-11h20201"),
        (MidModel::Forecast, "156", "mid-fcst", "stn-156"),
        (MidModel::Land, "11F20000", "mid-land-fcst", "reg-11f20000"),
        (MidModel::Temp, "11F20501", "mid-ta", "reg-11f20501"),
    ]
}
fn mid_page(model: MidModel, id: &str, p: Publication, invalid: bool) -> Vec<u8> {
    let mut item = serde_json::Map::new();
    item.insert("regId".into(), json!(id));
    if model == MidModel::Forecast {
        item.insert("wfSv".into(), json!(format!("맑겠습니다. {}", p.compact())));
    }
    for d in 3..=10 {
        if model == MidModel::Land {
            for suffix in if d <= 7 { vec!["Am", "Pm"] } else { vec![""] } {
                item.insert(format!("rnSt{d}{suffix}"), json!(20));
                item.insert(format!("wf{d}{suffix}"), json!("구름많음"));
            }
        }
        if model == MidModel::Temp {
            item.insert(format!("taMin{d}"), json!(if invalid { 999 } else { 12 }));
            item.insert(format!("taMax{d}"), json!(if invalid { 999 } else { 24 }));
        }
    }
    envelope(vec![Value::Object(item)])
}
fn inputs() -> Vec<Input> {
    let mut inputs = vec![];
    for (family, label, hours, cadence, delay) in [
        (Family::Current, "current", 217, 1, 42),
        (Family::Shortest, "shortest", 247, 1, 46),
        (Family::Short, "short", 361, 3, 12),
    ] {
        let sf = match family {
            Family::Current => schedule::Family::Current,
            Family::Shortest => schedule::Family::Shortest,
            Family::Short => schedule::Family::Short,
        };
        let mut p = sf.latest(NOW).unwrap();
        loop {
            inputs.push(Input {
                label: label.into(),
                source: sf.source(),
                kind: sf.kind(),
                key: ProviderKey::Grid { nx: 60, ny: 127 },
                p,
                fetched: (schedule::to_ms(p) + delay * 60_000) as u64,
                bytes: grid_page(family, p),
                content_type: "application/json",
            });
            if schedule::to_ms(p) < NOW - hours * HOUR {
                break;
            }
            p = p.add_hours(-cadence).unwrap();
        }
    }
    let mut p = publication::rss_latest(NOW).unwrap();
    loop {
        inputs.push(Input {
            label: "rss".into(),
            source: "kma-web",
            kind: "town-rss",
            key: ProviderKey::Grid { nx: 60, ny: 127 },
            p,
            fetched: (schedule::to_ms(p) + 2 * 60_000) as u64,
            bytes: rss_page(p),
            content_type: "application/xml",
        });
        if schedule::to_ms(p) < NOW - 312 * HOUR {
            break;
        }
        p = p.add_hours(-3).unwrap();
    }
    for (model, id, kind, key) in mids() {
        let latest = publication::mid_tm_fc(NOW).unwrap();
        for h in [0, -12, -24, -36] {
            let p = latest.add_hours(h).unwrap();
            inputs.push(Input {
                label: format!("{kind}/{id}"),
                source: "data-go-kr",
                kind,
                key: ProviderKey::Named { id: key.into() },
                p,
                fetched: (schedule::to_ms(p) + 2 * 60_000) as u64,
                bytes: mid_page(model, id, p, id == "11F20501"),
                content_type: "application/json",
            });
        }
        if id == "11F20501" {
            let p = Publication::new(20260831, 1800).unwrap();
            inputs.push(Input {
                label: format!("{kind}/{id}"),
                source: "data-go-kr",
                kind,
                key: ProviderKey::Named { id: key.into() },
                p,
                fetched: (schedule::to_ms(p) + 2 * 60_000) as u64,
                bytes: mid_page(model, id, p, false),
                content_type: "application/json",
            });
        }
    }
    let p = Publication::new(20260924, 600).unwrap();
    let zone = |id: &str, name: &str, sp: &str| json!({"regId":id,"tmSt":"201601010000","tmEd":"210012310000","regSp":sp,"regName":name,"regEn":name,"regUp":"11B10000","lat":"37.57","lon":"126.97"});
    inputs.push(Input {
        label: "zone-support".into(),
        source: "data-go-kr",
        kind: "forecast-zone",
        key: ProviderKey::Named {
            id: "forecast-zones".into(),
        },
        p,
        fetched: schedule::to_ms(p) as u64,
        bytes: envelope(vec![
            zone("11B10101", "서울", "C"),
            zone("11B20201", "인천", "C"),
            zone("11B00000", "서울.인천.경기도", "A"),
        ]),
        content_type: "application/json",
    });
    inputs.sort_by_key(|i| i.fetched);
    inputs
}
fn raw_pages(input: &Input) -> Vec<Vec<u8>> {
    if input.content_type != "application/json" {
        return vec![input.bytes.clone()];
    }
    let body: Value = serde_json::from_slice(&input.bytes).unwrap();
    let items = body["response"]["body"]["items"]["item"]
        .as_array()
        .unwrap();
    items
        .chunks(999)
        .enumerate()
        .map(|(index, page)| {
            let mut v: Value = serde_json::from_slice(&envelope(page.to_vec())).unwrap();
            v["response"]["body"]["totalCount"] = json!(items.len());
            v["response"]["body"]["pageNo"] = json!(index + 1);
            serde_json::to_vec(&v).unwrap()
        })
        .collect()
}
fn input_bytes(input: &Input) -> usize {
    raw_pages(input).iter().map(Vec::len).sum()
}
fn doc_summary(docs: &[Doc]) -> Value {
    let bytes = OrderedJson::Array(docs.iter().map(Doc::json).collect()).to_bytes();
    let dates: Vec<_> = docs
        .iter()
        .filter_map(|d| match d.get("fcsDate") {
            Some(source::Val::Date(ms)) => Some(*ms as i64),
            _ => None,
        })
        .collect();
    json!({"documents":docs.len(),"json_bytes":bytes.len(),"sha256":sha256(&bytes),"fcsDate_min_ms":dates.iter().min(),"fcsDate_max_ms":dates.iter().max()})
}
async fn seed(endpoint: &str, path: &Path) {
    let inputs = inputs();
    let store = CatalogStore::new(transport(endpoint), CatalogLimits::default()).unwrap();
    let mut metadata = BTreeMap::<String, Value>::new();
    let mut keys = BTreeMap::<String, String>::new();
    let mut identities = vec![];
    for (index, i) in inputs.iter().enumerate() {
        let limits = CatalogLimits::default();
        let partition = if i.label == "zone-support" {
            i.p.base_date()
        } else {
            i.p.partition()
        };
        let pages = raw_pages(i);
        let records: Vec<_> = pages
            .iter()
            .enumerate()
            .map(|(page, bytes)| {
                RawRecord::new(
                    i.source,
                    i.kind,
                    &i.key,
                    i.p.period(),
                    i.fetched,
                    200,
                    i.content_type,
                    Some(Pagination {
                        page: page as u32 + 1,
                        pages: pages.len() as u32,
                        complete: true,
                    }),
                    bytes.clone().into(),
                    &limits.raw,
                )
                .unwrap()
            })
            .collect();
        let catalog = CatalogId::for_record(&records[0].envelope.identity, &partition).unwrap();
        let declaration = GroupDeclaration::new(
            records
                .iter()
                .map(|raw| GroupMember {
                    envelope: raw.envelope.clone(),
                    catalogs: vec![catalog.clone()],
                })
                .collect(),
            &limits,
        )
        .unwrap();
        for raw in &records {
            keys.insert(raw.envelope.identity.object_key().unwrap(), i.label.clone());
        }
        keys.insert(catalog.key(), i.label.clone());
        keys.insert(
            declaration
                .reference(&limits)
                .unwrap()
                .descriptor_key()
                .unwrap(),
            i.label.clone(),
        );
        identities.push(json!({"label":i.label,"partition":partition,"fetched_at_ms":i.fetched,
            "pages": records.iter().map(|r|json!({"raw_sha256":r.envelope.identity.raw_sha256,"bytes":r.bytes.len()})).collect::<Vec<_>>(),
            "bytes":pages.iter().map(Vec::len).sum::<usize>()}));
        store
            .publish(
                declaration,
                records,
                Instant::now() + Duration::from_secs(20),
            )
            .await
            .unwrap();
        if index % 100 == 0 {
            eprintln!("seeded {}/{}", index + 1, inputs.len());
        }
    }
    let mut expected = BTreeMap::new();
    for (label, family, hours) in [
        ("current", Family::Current, 217),
        ("shortest", Family::Shortest, 247),
        ("short", Family::Short, 361),
    ] {
        let selected: Vec<_> = inputs
            .iter()
            .filter(|i| {
                i.label == label
                    && i.p.partition() >= schedule::from_ms(NOW - hours * HOUR).partition()
            })
            .collect();
        let fetched: Vec<_> = selected
            .iter()
            .map(|i| Fetched {
                fetched_at_ms: i.fetched,
                partition: i.p.partition(),
                pages: raw_pages(i).into_iter().map(Arc::from).collect(),
            })
            .collect();
        let docs =
            source::grid_documents(family, Coord { mx: 60., my: 127. }, &fetched, NOW as f64);
        assert!(!docs.is_empty());
        expected.insert(label.to_owned(), doc_summary(&docs));
        let all: Vec<_> = inputs.iter().filter(|i| i.label == label).collect();
        metadata.insert(label.into(),json!({"lookback_hours":hours,"cutoff_partition":schedule::from_ms(NOW-hours*HOUR).partition(),"generated_acquisitions":all.len(),"generated_raw_pages":all.iter().map(|i|raw_pages(i).len()).sum::<usize>(),"selected_acquisitions":selected.len(),"selected_raw_pages":selected.iter().map(|i|raw_pages(i).len()).sum::<usize>(),"raw_bytes":all.iter().map(|i|input_bytes(i)).sum::<usize>(),"selected_raw_bytes":selected.iter().map(|i|input_bytes(i)).sum::<usize>(),"first_publication":all.first().unwrap().p.partition(),"last_publication":all.last().unwrap().p.partition(),"extra_older_cutoff_sentinel":true}));
    }
    for label in inputs
        .iter()
        .filter(|i| i.label != "zone-support")
        .map(|i| i.label.clone())
        .collect::<std::collections::BTreeSet<_>>()
    {
        if expected.contains_key(&label) {
            continue;
        }
        let all: Vec<_> = inputs.iter().filter(|i| i.label == label).collect();
        let selected: Vec<_> = all
            .iter()
            .filter(|i| {
                label != "rss" || i.p.partition() >= schedule::from_ms(NOW - 312 * HOUR).partition()
            })
            .collect();
        let fetched: Vec<_> = selected
            .iter()
            .map(|i| Fetched {
                fetched_at_ms: i.fetched,
                partition: i.p.partition(),
                pages: raw_pages(i).into_iter().map(Arc::from).collect(),
            })
            .collect();
        let docs = if label == "rss" {
            source::rss_documents(Coord { mx: 60., my: 127. }, &fetched, NOW as f64)
        } else {
            let (model, id, _, _) = mids()
                .into_iter()
                .find(|(_, id, kind, _)| format!("{kind}/{id}") == label)
                .unwrap();
            source::mid_documents(model, id, &fetched, NOW as f64)
        };
        assert!(!docs.is_empty(), "{label}");
        expected.insert(label.clone(), doc_summary(&docs));
        metadata.insert(label,json!({"generated_acquisitions":all.len(),"generated_raw_pages":all.iter().map(|i|raw_pages(i).len()).sum::<usize>(),"selected_acquisitions":selected.len(),"selected_raw_pages":selected.iter().map(|i|raw_pages(i).len()).sum::<usize>(),"raw_bytes":all.iter().map(|i|input_bytes(i)).sum::<usize>(),"first_publication":all.first().unwrap().p.partition(),"last_publication":all.last().unwrap().p.partition()}));
    }
    let manifest = json!({"scope":"synthetic full source windows plus one older sentinel each; three mid regions x three models, four current-month revisions; third temp falls back to previous month","now_ms":NOW,"source_acquirers":"disabled; no ForecastAcquire installed","s3_admission":4,"datasets":metadata,"expected_source_documents":expected,"input_manifest_sha256":sha256(&serde_json::to_vec(&identities).unwrap()),"input_identities":identities,"io_object_labels":keys,"parse_count":"NOT_MEASURED","fold_count":"NOT_MEASURED","Doc_weights":"NOT_MEASURED"});
    std::fs::write(path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    println!(
        "{}",
        json!({"seeded":inputs.len(),"manifest_sha256":sha256(&std::fs::read(path).unwrap())})
    );
}
async fn status(endpoint: &str) -> Value {
    let bytes = reqwest::get(format!("{endpoint}__catalog/status"))
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
async fn diagnostic(endpoint: &str, manifest: &Value) {
    let off = Arc::new(Off::default());
    let source = S3Source::new(
        transport(endpoint),
        Arc::new(|| NOW as f64),
        off.clone(),
        off.clone(),
    )
    .unwrap();
    for phase in ["cold", "warm1", "warm2"] {
        let before: Value = status(endpoint).await;
        let cache_before = source.forecast_cache_stats();
        let start = Instant::now();
        let deadline = start + Duration::from_secs(60);
        let grid = Grid::new(60, 127).unwrap();
        let mut result = BTreeMap::<String, Value>::new();
        for (label, family) in [
            ("current", Family::Current),
            ("shortest", Family::Shortest),
            ("short", Family::Short),
        ] {
            match source.grid_answer(family, grid, NOW as f64, deadline).await {
                Ok(docs) => {
                    result.insert(label.into(), doc_summary(&docs));
                }
                Err(e) => {
                    result.insert(label.into(), json!({"error":e}));
                }
            }
        }
        match source.rss_answer(grid, NOW as f64, deadline).await {
            Ok(docs) => {
                result.insert("rss".into(), doc_summary(&docs));
            }
            Err(e) => {
                result.insert("rss".into(), json!({"error":e}));
            }
        }
        for (model, id, kind, _) in mids() {
            let label = format!("{kind}/{id}");
            match source
                .mid_answer(model, id, true, NOW as f64, deadline)
                .await
            {
                Ok(docs) => {
                    result.insert(label, doc_summary(&docs));
                }
                Err(e) => {
                    result.insert(label, json!({"error":e}));
                }
            }
        }
        let elapsed = start.elapsed().as_secs_f64() * 1000.;
        let after: Value = status(endpoint).await;
        let cache_after = source.forecast_cache_stats();
        let actual = serde_json::to_value(&result).unwrap();
        let matches = actual == manifest["expected_source_documents"];
        println!(
            "{}",
            json!({"mode":"diagnostic-public-source-answers","phase":phase,"deadline_seconds":60,"elapsed_ms":elapsed,"exact_expected_documents":matches,"documents":actual,"status_before":before,"status_after":after,"provider_stub_invocations":off.0.load(Ordering::SeqCst),"parse_acquisition_invocations":cache_after.parse_acquisitions-cache_before.parse_acquisitions,"fold_invocations":cache_after.folds-cache_before.folds,"forecast_cache_before":cache_before,"forecast_cache_after":cache_after,"Doc_weights":cache_after.last_built,"weight_scope":"fixed D2 logical capacities and allocator allowance; not heap/RSS or wholeprocess","native_latency_pass":false})
        );
        assert_eq!(
            cache_after.mapped_entries, 13,
            "complete default corpus must map all13 family views"
        );
        assert_eq!(
            cache_after.last_built.len(),
            13,
            "actual charges required for every full family"
        );
        if phase != "cold" {
            assert_eq!(
                cache_after.parse_acquisitions, cache_before.parse_acquisitions,
                "idle warm forecast cannot parse"
            );
            assert_eq!(
                cache_after.folds, cache_before.folds,
                "idle warm forecast cannot refold"
            );
        }
        assert!(
            matches,
            "complete source answers must match complete S3 input replay"
        );
    }
    assert_eq!(off.0.load(Ordering::SeqCst), 0);
}
async fn native(endpoint: &str) {
    let off = Arc::new(Off::default());
    let source = Arc::new(
        S3Source::new(
            transport(endpoint),
            Arc::new(|| NOW as f64),
            off.clone(),
            off.clone(),
        )
        .unwrap(),
    );
    let backend = KmaBackend::new(source, Arc::new(|| NOW as f64), AssemblyConfig::default());
    for phase in ["cold", "warm1"] {
        let before: Value = status(endpoint).await;
        let start = Instant::now();
        let request = parse_path("/v000903/kma/addr/서울특별시/종로구/청운효자동", "ko").unwrap();
        let result = backend
            .outcome(request, Instant::now() + Duration::from_secs(60))
            .await;
        let outcome = match result {
            Ok(Outcome::Json(body)) => {
                json!({"kind":"json","bytes":body.to_bytes().len(),"sha256":sha256(&body.to_bytes())})
            }
            Ok(other) => json!({"kind":"other","debug":format!("{other:?}")}),
            Err(e) => json!({"kind":"dependency-error","debug":format!("{e:?}")}),
        };
        let elapsed = start.elapsed().as_secs_f64() * 1000.;
        let after: Value = status(endpoint).await;
        println!(
            "{}",
            json!({"mode":"native-KmaBackend-outcome","phase":phase,"deadline_seconds":3,"caller_deadline_seconds":60,"elapsed_ms":elapsed,"outcome":outcome,"status_before":before,"status_after":after,"provider_stub_invocations":off.0.load(Ordering::SeqCst),"provider_external_calls":0,"native_latency_pass":false})
        );
    }
}
/// Denies any geocoding in the normal direct-route HTTP workflow. This is separate from
/// the existing denied weather providers, so an accidental gateway routing change is visible.
#[derive(Default)]
struct NoGeo(AtomicUsize);
impl server2::gateway::Geocoder for NoGeo {
    fn coord(
        &self,
        _: [f64; 2],
        _: String,
    ) -> BoxFuture<'_, Result<server2::geocode::GeoClient, server2::gateway::GatewayError>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(server2::gateway::GatewayError::Provider) })
    }
    fn addr(
        &self,
        _: String,
        _: String,
    ) -> BoxFuture<'_, Result<server2::geocode::GeoClient, server2::gateway::GatewayError>> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Err(server2::gateway::GatewayError::Provider) })
    }
}
async fn http(endpoint: &str, manifest: &Path, disk_enabled: bool) {
    use server2::{
        api::{DirectFamilies, DirectRoutes},
        gateway::{BackendDispatcher, Gateway},
    };
    let off = Arc::new(Off::default());
    let geo = Arc::new(NoGeo::default());
    let source = Arc::new(
        S3Source::new(
            if disk_enabled {
                disk_transport(endpoint, &manifest.parent().unwrap().join("folded-cache"))
            } else {
                transport(endpoint)
            },
            Arc::new(|| NOW as f64),
            off.clone(),
            off.clone(),
        )
        .unwrap(),
    );
    let backend = Arc::new(KmaBackend::new(
        source.clone(),
        Arc::new(|| NOW as f64),
        AssemblyConfig::default(),
    ));
    let dispatcher = BackendDispatcher::native_only();
    let direct = Arc::new(DirectRoutes::new(
        backend,
        DirectFamilies {
            kma_v000903: true,
            ..Default::default()
        },
        dispatcher.clone(),
    ));
    let gateway = Gateway::new(geo.clone(), dispatcher).with_direct(direct);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let mut server = tokio::spawn(async move {
        axum::serve(listener, gateway.router())
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let mut url = reqwest::Url::parse(&format!("http://{address}/")).unwrap();
    url.path_segments_mut().unwrap().extend([
        "v000903",
        "kma",
        "addr",
        "서울특별시",
        "종로구",
        "청운효자동",
    ]);
    let body_prefix = if disk_enabled { "http-disk" } else { "http" };
    let mut complete = true;
    let mut first_warm_success: Option<Vec<u8>> = None;
    for phase in ["cold", "warm1", "warm2"] {
        let before = status(endpoint).await;
        let cache_before = source.forecast_cache_stats();
        let denied_before = [
            off.0.load(Ordering::SeqCst),
            off.1.load(Ordering::SeqCst),
            off.2.load(Ordering::SeqCst),
        ];
        let start = Instant::now();
        let result = async {
            let response = client
                .get(url.clone())
                .header("accept-language", "ko")
                .header("accept", "application/json")
                .send()
                .await?;
            let status = response.status().as_u16();
            let headers = ["content-type", "etag", "cache-control", "x-powered-by"]
                .into_iter()
                .map(|name| {
                    (
                        name.to_owned(),
                        response
                            .headers()
                            .get(name)
                            .and_then(|h| h.to_str().ok())
                            .map(str::to_owned),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            let bytes = response.bytes().await?.to_vec();
            Ok::<_, reqwest::Error>((status, headers, bytes))
        }
        .await;
        let elapsed = start.elapsed().as_secs_f64() * 1000.;
        let after = status(endpoint).await;
        let cache_after = source.forecast_cache_stats();
        let outcome = match result {
            Ok((status, headers, bytes)) => {
                std::fs::write(
                    manifest
                        .parent()
                        .unwrap()
                        .join(format!("{body_prefix}-{phase}.body")),
                    &bytes,
                )
                .unwrap();
                let valid_json = serde_json::from_slice::<Value>(&bytes).is_ok();
                let same = phase == "cold"
                    || first_warm_success
                        .as_ref()
                        .is_none_or(|first| *first == bytes);
                let reference = bytes.len() == 42_549
                    && sha256(&bytes)
                        == "a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283";
                let success = status == 200 && valid_json && same && reference;
                if phase != "cold" && status == 200 && valid_json && first_warm_success.is_none() {
                    first_warm_success = Some(bytes.clone());
                }
                complete &= success;
                json!({"http_status":status,"headers":headers,"bytes":bytes.len(),"body_file":format!("{body_prefix}-{phase}.body"),"sha256":sha256(&bytes),"valid_json":valid_json,"same_as_first_warm_success":if phase=="cold" { None } else {Some(same)},"successful_json":success})
            }
            Err(error) => {
                complete = false;
                json!({"transport_error":error.to_string()})
            }
        };
        let denied_after = [
            off.0.load(Ordering::SeqCst),
            off.1.load(Ordering::SeqCst),
            off.2.load(Ordering::SeqCst),
        ];
        let denied_delta = [
            denied_after[0] - denied_before[0],
            denied_after[1] - denied_before[1],
            denied_after[2] - denied_before[2],
        ];
        if phase != "cold" {
            complete &= denied_delta[0] == 0;
        }
        println!(
            "{}",
            json!({"mode":"normal-native-direct-HTTP","phase":phase,"deadline_seconds":3,"client_timeout_seconds":10,"elapsed_ms":elapsed,"outcome":outcome,"status_before":before,"status_after":after,"forecast_cache_before":cache_before,"forecast_cache_after":cache_after,"provider_stub_invocations":denied_after[0],"denied_observation_web_total":denied_after[1],"denied_observation_asos_total":denied_after[2],"denied_observation_delta":{"aggregate":denied_delta[0],"web":denied_delta[1],"asos":denied_delta[2]},"provider_external_calls":0,"external_provider_guard":"injected Off methods return Transport without an HTTP client","geocoder_stub_invocations":geo.0.load(Ordering::SeqCst),"source_prewarmed":false,"folded_disk_configured":disk_enabled,"native_latency_pass":false,"baseline_context":"original native baseline aggregate cold196/warm additional0; family split previously not measured"})
        );
        if disk_enabled && phase == "cold" {
            complete &= cache_after.parse_acquisitions == 0
                && cache_after.folds == 0
                && cache_after.disk_restores == 7;
        }
        // Stop after the first actual failure; preserve it and retire owned work before root
        // diagnosis. No later warm success can turn a failed cold request into acceptance.
        if !complete {
            break;
        }
    }

    drop(client);
    let _ = stop.send(());
    let retired = match tokio::time::timeout(Duration::from_secs(2), &mut server).await {
        Ok(Ok(Ok(()))) => true,
        Ok(_) => false,
        Err(_) => {
            server.abort();
            let _ = server.await;
            false
        }
    };
    // This wait is outside all request timings. It observes retained owned continuations;
    // it never extends a request or converts a failed cold request into a success.
    let drain = Instant::now() + Duration::from_secs(10);
    while source.forecast_cache_stats().active_workspace_logical_bytes != 0
        && Instant::now() < drain
    {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let final_stats = source.forecast_cache_stats();
    eprintln!(
        "{}",
        json!({"http_listener_retired":retired,"final_cache":final_stats,"provider_stub_invocations":off.0.load(Ordering::SeqCst),"geocoder_stub_invocations":geo.0.load(Ordering::SeqCst)})
    );
    assert!(retired, "owned HTTP listener must retire");
    assert_eq!(
        final_stats.active_workspace_logical_bytes, 0,
        "owned workspaces must drain"
    );
    assert_eq!(
        geo.0.load(Ordering::SeqCst),
        0,
        "direct HTTP must not geocode"
    );
    assert!(
        complete,
        "retain all actual cold/warm HTTP failures; no failed response is a native success"
    );
}
/// Independent pure replay at another clock, outside measured Source counters.
fn expected_at(now: i64) -> BTreeMap<String, Value> {
    let all = inputs();
    let mut expected = BTreeMap::new();
    for (label, family, hours) in [
        ("current", Family::Current, 217),
        ("shortest", Family::Shortest, 247),
        ("short", Family::Short, 361),
    ] {
        let oldest = schedule::from_ms(now - hours * HOUR).partition();
        let raw: Vec<_> = all
            .iter()
            .filter(|i| i.label == label && i.p.partition() >= oldest)
            .map(|i| Fetched {
                fetched_at_ms: i.fetched,
                partition: i.p.partition(),
                pages: raw_pages(i).into_iter().map(Arc::from).collect(),
            })
            .collect();
        expected.insert(
            label.into(),
            doc_summary(&source::grid_documents(
                family,
                Coord { mx: 60., my: 127. },
                &raw,
                now as f64,
            )),
        );
    }
    let oldest = schedule::from_ms(now - 312 * HOUR).partition();
    let raw: Vec<_> = all
        .iter()
        .filter(|i| i.label == "rss" && i.p.partition() >= oldest)
        .map(|i| Fetched {
            fetched_at_ms: i.fetched,
            partition: i.p.partition(),
            pages: raw_pages(i).into_iter().map(Arc::from).collect(),
        })
        .collect();
    expected.insert(
        "rss".into(),
        doc_summary(&source::rss_documents(
            Coord { mx: 60., my: 127. },
            &raw,
            now as f64,
        )),
    );
    for (model, id, kind, _) in mids() {
        let label = format!("{kind}/{id}");
        let raw: Vec<_> = all
            .iter()
            .filter(|i| i.label == label)
            .map(|i| Fetched {
                fetched_at_ms: i.fetched,
                partition: i.p.partition(),
                pages: raw_pages(i).into_iter().map(Arc::from).collect(),
            })
            .collect();
        expected.insert(
            label,
            doc_summary(&source::mid_documents(model, id, &raw, now as f64)),
        );
    }
    expected
}
async fn disk_diagnostic(endpoint: &str, manifest_path: &Path, boundaries: bool) {
    use server2::storage::ObjectTransport;
    let manifest: Value = serde_json::from_slice(&std::fs::read(manifest_path).unwrap()).unwrap();
    let root = manifest_path.parent().unwrap().join("folded-cache");
    assert_eq!(
        root.exists(),
        boundaries,
        "fill owns a new root; boundary check reuses it"
    );
    let off = Arc::new(Off::default());
    let mut held = None;
    let phases = if boundaries {
        vec![("boundary-prime", NOW), ("boundary", NOW + 3 * HOUR)]
    } else {
        vec![("fill", NOW), ("restore", NOW), ("renew", NOW + 60_000)]
    };
    for (phase, now) in phases {
        if matches!(phase, "fill" | "restore" | "boundary-prime") {
            let t = disk_transport(endpoint, &root);
            let disk = t.raw_cache().unwrap();
            let source =
                S3Source::new(t, Arc::new(|| NOW as f64), off.clone(), off.clone()).unwrap();
            held = Some((source, disk));
        }
        let (source, disk) = held.as_ref().unwrap();
        let expected = if phase == "boundary" {
            serde_json::to_value(expected_at(now)).unwrap()
        } else {
            manifest["expected_source_documents"].clone()
        };
        let mut selections = vec![
            ("current".into(), Some(Family::Current), None),
            ("shortest".into(), Some(Family::Shortest), None),
            ("short".into(), Some(Family::Short), None),
            ("rss".into(), None, None),
        ];
        selections.extend(
            mids()
                .into_iter()
                .map(|(m, id, kind, _)| (format!("{kind}/{id}"), None, Some((m, id)))),
        );
        for (label, family, mid) in selections {
            let before = status(endpoint).await;
            let cache_before = source.forecast_cache_stats();
            let start = Instant::now();
            let deadline = start + Duration::from_secs(60);
            let grid = Grid::new(60, 127).unwrap();
            let docs = if let Some(f) = family {
                source.grid_answer(f, grid, now as f64, deadline).await
            } else if let Some((m, id)) = mid {
                source.mid_answer(m, id, true, now as f64, deadline).await
            } else {
                source.rss_answer(grid, now as f64, deadline).await
            }
            .unwrap();
            let elapsed = start.elapsed().as_secs_f64() * 1000.;
            let actual = doc_summary(&docs);
            assert_eq!(actual, expected[&label], "{phase}/{label}");
            assert!(disk.idle(Instant::now() + Duration::from_secs(5)).await);
            let cache_after = source.forecast_cache_stats();
            if matches!(phase, "restore" | "renew") {
                assert_eq!(
                    cache_after.parse_acquisitions,
                    cache_before.parse_acquisitions
                );
                assert_eq!(cache_after.folds, cache_before.folds);
            }
            println!(
                "{}",
                json!({"mode":"folded-view-disk","phase":phase,"dataset":label,"elapsed_ms":elapsed,
                "exact_expected_documents":true,"documents":actual,"status_before":before,"status_after":status(endpoint).await,
                "forecast_cache_before":cache_before,"forecast_cache_after":cache_after,"disk_cache":disk.metrics(),
                "parse_acquisition_invocations":cache_after.parse_acquisitions-cache_before.parse_acquisitions,
                "fold_invocations":cache_after.folds-cache_before.folds,"provider_external_calls":0,"native_latency_pass":false})
            );
        }
        if phase == "fill" {
            held = None;
        } else if phase == "restore" {
            assert_eq!(source.forecast_cache_stats().disk_restores, 13);
        } else if phase == "renew" {
            assert_eq!(source.forecast_cache_stats().identity_renewals, 13);
        }
    }
    assert_eq!(off.0.load(Ordering::SeqCst), 0);
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(
        args.len(),
        3,
        "ENDPOINT seed|diagnostic|native|http MANIFEST"
    );
    assert!(args[0].starts_with("http://127.0.0.1:"));
    match args[1].as_str() {
        "seed" => seed(&args[0], Path::new(&args[2])).await,
        "diagnostic" => {
            diagnostic(
                &args[0],
                &serde_json::from_slice::<Value>(&std::fs::read(&args[2]).unwrap()).unwrap(),
            )
            .await
        }
        "native" => native(&args[0]).await,
        "http" => http(&args[0], Path::new(&args[2]), false).await,
        "http-disk" => http(&args[0], Path::new(&args[2]), true).await,
        "disk" => disk_diagnostic(&args[0], Path::new(&args[2]), false).await,
        "disk-boundary" => disk_diagnostic(&args[0], Path::new(&args[2]), true).await,
        _ => panic!("unknown mode"),
    }
}
