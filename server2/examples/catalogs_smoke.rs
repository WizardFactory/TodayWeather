//! Distinct real HTTP functional smoke. Only a fresh owned loopback test peer is accepted.
use rusty_s3::Credentials;
use server2::storage::*;
use std::time::Duration;
use tokio::time::Instant;
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}
fn group(fetch: u64, value: u32) -> (GroupDeclaration, Vec<RawRecord>) {
    let mut raw = Vec::new();
    let mut members = Vec::new();
    for page in 1..=2 {
        let record = RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            Period {
                local_date: 20261007,
                slot: "1200".into(),
            },
            fetch,
            200,
            "application/json",
            Some(Pagination {
                page,
                pages: 2,
                complete: true,
            }),
            format!("{{\"value\":{value},\"page\":{page}}}")
                .into_bytes()
                .into(),
            &Limits::default(),
        )
        .unwrap();
        let a = CatalogId::for_record(&record.envelope.identity, "20261007-a").unwrap();
        let b = CatalogId::for_record(&record.envelope.identity, "20261007-b").unwrap();
        members.push(GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![a, b],
        });
        raw.push(record);
    }
    (
        GroupDeclaration::new(members, &CatalogLimits::default()).unwrap(),
        raw,
    )
}
async fn fault(endpoint: &str, mode: &str, key: &str) {
    let mut url: reqwest::Url = format!("{endpoint}__catalog").parse().unwrap();
    url.query_pairs_mut()
        .append_pair("mode", mode)
        .append_pair("key", key);
    assert_eq!(
        reqwest::Client::new()
            .post(url)
            .header("X-Server2-Test-Key", "server2-local")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        204
    );
}
fn store(endpoint: &str) -> CatalogStore<HttpS3Transport> {
    let limits = CatalogLimits {
        list_keys: 1,
        ..CatalogLimits::default()
    };
    CatalogStore::new(
        HttpS3Transport::new(
            endpoint,
            "server2-local",
            "ap-northeast-2",
            Credentials::new("server2-local", "server2-local-secret"),
        )
        .unwrap(),
        limits,
    )
    .unwrap()
}
fn ready(value: LookupOutcome) -> CompleteSet {
    match value {
        LookupOutcome::Ready(set) => set,
        _ => panic!("missing checked complete acquisition"),
    }
}
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let endpoint = std::env::args()
        .nth(1)
        .expect("usage: catalogs_smoke http://127.0.0.1:PORT/");
    let url: reqwest::Url = endpoint.parse().expect("endpoint URL");
    assert_eq!(url.scheme(), "http");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.path(), "/");
    let started = Instant::now();
    let s = store(&endpoint);
    let (d, raw) = group(100, 1);
    let id = d.partitions[0].clone();
    let scope = RepairScope {
        catalog: id.clone(),
        periods: vec![d.members[0].envelope.identity.period.clone()],
    };
    let published = s.publish(d, raw, deadline()).await.unwrap();
    assert_eq!(published.coverage(), RevisionCoverage::PublishedGroup);
    assert!(matches!(
        published.fold(SelectionPolicy::AbsentFields, |_| Ok(serde_json::json!({}))),
        Err(Error::Invalid(_))
    ));
    println!("publish: complete group, 2 ordered raw pages, 2 catalog partitions");
    let fresh = store(&endpoint);
    let set = ready(fresh.lookup(&id, deadline()).await.unwrap());
    assert_eq!(set.acquisitions().len(), 1);
    assert_eq!(set.dependencies().len(), 2);
    println!("cold: 1 checked acquisition, 2 pinned dependencies, providers disabled");
    let (d, raw) = group(200, 2);
    fault(&endpoint, "reject", &d.partitions[1].key()).await;
    assert_eq!(
        s.publish(d, raw, deadline()).await.unwrap_err(),
        Error::Status(403)
    );
    let set = ready(fresh.lookup(&id, deadline()).await.unwrap());
    assert_eq!(set.acquisitions().len(), 1);
    assert_eq!(set.excluded_groups(), 1);
    println!("partial: A/new + B/healthy-old excluded; preceding complete group retained");
    fault(&endpoint, "clear", "unused").await;
    let repaired = fresh.repair(&scope, deadline()).await.unwrap();
    let RepairOutcome::Complete(set) = repaired else {
        panic!("repair incomplete");
    };
    assert_eq!(set.acquisitions().len(), 2);
    println!("repair: healthy catalog + paginated LIST restored every revision");
    let (d, raw) = group(300, 3);
    fault(&endpoint, "drop-commit", &id.key()).await;
    s.publish(d, raw, deadline()).await.unwrap();
    println!("response loss: committed CAS reconciled from exact union");
    let (d, raw) = group(400, 4);
    fault(&endpoint, "late-reject", &id.key()).await;
    assert_eq!(
        s.publish(d, raw, deadline()).await.unwrap_err(),
        Error::Ambiguous
    );
    let obj = HttpS3Transport::new(
        &endpoint,
        "server2-local",
        "ap-northeast-2",
        Credentials::new("server2-local", "server2-local-secret"),
    )
    .unwrap()
    .get_control(&id.key(), 1024 * 1024)
    .await
    .unwrap();
    assert_eq!(
        Catalog::from_bytes(&obj.body, &id, &CatalogLimits::default())
            .unwrap()
            .entries
            .len(),
        8
    );
    println!(
        "late commit: lost first PUT + read404 + retry403 remains Ambiguous; exact catalog exists"
    );
    let (d, raw) = group(500, 5);
    fault(
        &endpoint,
        "reject",
        &d.reference(&CatalogLimits::default())
            .unwrap()
            .descriptor_key()
            .unwrap(),
    )
    .await;
    assert_eq!(
        s.publish(d, raw, deadline()).await.unwrap_err(),
        Error::Status(403)
    );
    println!("direct rejection: first PUT403 retained, no group success");
    fault(&endpoint, "clear", "unused").await;
    let PageOutcome::Ready(page) = fresh
        .lookup_page(&id, ReadOrder::EarliestFirst, None, 1, deadline())
        .await
        .unwrap()
    else {
        panic!("bounded first page")
    };
    assert_eq!(page.coverage(), RevisionCoverage::Paged);
    assert_eq!(page.acquisitions()[0].records().len(), 2);
    assert!(page.next().is_some());
    let identity = page.acquisitions()[0].records()[0]
        .envelope
        .identity
        .clone();
    let PageOutcome::Ready(target) = fresh
        .lookup_acquisition(&id, &identity, deadline())
        .await
        .unwrap()
    else {
        panic!("targeted acquisition")
    };
    assert_eq!(target.coverage(), RevisionCoverage::Targeted);
    assert!(target.next().is_none());
    println!(
        "bounded read: whole 2-page acquisition, opaque continuation and exact targeted scope; scoped publication fold blocked"
    );
    let mut empty_id = id.clone();
    empty_id.partition = "empty".into();
    let empty = RepairScope {
        catalog: empty_id,
        periods: vec![Period {
            local_date: 20260101,
            slot: "0000".into(),
        }],
    };
    for mode in ["chunked-list", "empty-page"] {
        fault(&endpoint, mode, "unused").await;
        assert!(matches!(
            fresh.repair(&empty, deadline()).await.unwrap(),
            RepairOutcome::CompleteEmpty { .. }
        ));
    }
    println!(
        "streamed repair: chunked LIST and empty truncated continuation exhaust only the explicit empty scope"
    );
    println!(
        "PASS local real HTTP smoke ({:.2} ms); not AWS latency/auth or API parity",
        started.elapsed().as_secs_f64() * 1000.0
    );
}
