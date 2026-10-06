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
