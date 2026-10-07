//! Local operator smoke only; caller supplies a loopback S3-compatible peer.
use rusty_s3::Credentials;
use server2::storage::*;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let endpoint = std::env::args()
        .nth(1)
        .ok_or("usage: raw_records_smoke http://127.0.0.1:PORT")?;
    let url: reqwest::Url = endpoint.parse()?;
    let ip: std::net::IpAddr = url
        .host_str()
        .ok_or("loopback IP required")?
        .trim_matches(['[', ']'])
        .parse()?;
    if !ip.is_loopback() || url.scheme() != "http" {
        return Err("smoke requires plaintext loopback peer".into());
    }
    if std::env::args().nth(2).as_deref() == Some("--uncertainty-smoke") {
        return uncertainty_smoke(&endpoint).await;
    }
    let store = RawRecordStore::new(
        HttpS3Transport::new(
            &endpoint,
            "server2-local",
            "us-east-1",
            Credentials::new("server2-local", "server2-local-secret"),
        )?,
        Limits::default(),
    )?;
    let bodies: [&[u8]; 3] = [
        &[0xb0, 0xa1, 0xff, 0],
        br#"{"value":37626}"#,
        br#"{"value":59662}"#,
    ];
    let mut ids = Vec::new();
    for bytes in bodies {
        let record = RawRecord::new(
            "kma",
            "current",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            Period {
                local_date: 20260131,
                slot: "2300".into(),
            },
            1769871600123,
            200,
            "text/html; charset=euc-kr",
            None,
            bytes.into(),
            &Limits::default(),
        )?;
        let id = record.envelope.identity.clone();
        let first = store.publish(record.clone()).await?;
        assert_eq!(store.publish(record).await?, PublishOutcome::AlreadyPresent);
        println!(
            "PUT {first:?}; repeat verified; raw_sha256={} bytes={}",
            id.raw_sha256,
            bytes.len()
        );
        ids.push(id);
    }
    drop(store);
    let cold = RawRecordStore::new(
        HttpS3Transport::new(
            &endpoint,
            "server2-local",
            "us-east-1",
            Credentials::new("server2-local", "server2-local-secret"),
        )?,
        Limits::default(),
    )?;
    for (id, bytes) in ids.iter().zip(bodies) {
        assert_eq!(&*cold.load(id).await?.bytes, bytes);
        println!("RESTORE verified {}", id.raw_sha256);
    }
    assert_ne!(ids[1].object_key()?, ids[2].object_key()?);
    println!(
        "PASS: exact binary, both collision bodies, conditional repeat and empty-client restore; no catalog/client publication"
    );
    Ok(())
}

/// Scripted local peer only: first PUT waits for an explicit test commit barrier.
async fn uncertainty_smoke(endpoint: &str) -> Result<(), Box<dyn std::error::Error>> {
    let store = RawRecordStore::new(
        HttpS3Transport::new(
            endpoint,
            "server2-local",
            "us-east-1",
            Credentials::new("server2-local", "server2-local-secret"),
        )?,
        Limits::default(),
    )?;
    let admin = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(3))
        .build()?;
    for status in [401, 403, 400, 202] {
        let bytes = format!("uncertainty-smoke-{status}").into_bytes();
        let record = smoke_record(&bytes)?;
        let id = record.envelope.identity.clone();
        assert_eq!(store.publish(record).await, Err(Error::Ambiguous));
        let response = admin
            .post(format!("{endpoint}/__test/commit"))
            .send()
            .await?;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(&*store.load(&id).await?.bytes, bytes.as_slice());
        println!(
            "lost first PUT + HEAD404 + retry{status}: Ambiguous; delayed commit restored exact bytes"
        );
    }
    assert_eq!(
        store.publish(smoke_record(b"direct-rejected")?).await,
        Err(Error::Status(403))
    );
    println!("direct first403: Status403, no prior uncertainty");
    println!("PASS: cumulative PUT uncertainty; local scripted HTTP only, no S06 publication");
    Ok(())
}
fn smoke_record(bytes: &[u8]) -> Result<RawRecord, Error> {
    RawRecord::new(
        "kma",
        "current",
        &ProviderKey::Grid { nx: 60, ny: 127 },
        Period {
            local_date: 20260131,
            slot: "2300".into(),
        },
        1769871600123,
        200,
        "application/json",
        None,
        bytes.into(),
        &Limits::default(),
    )
}
