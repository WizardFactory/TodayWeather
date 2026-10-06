#[test]
fn full_hash_identity_keeps_prefix_collision_bodies() {
    assert_ne!(
        server2::storage::sha256(br#"{"value":37626}"#),
        server2::storage::sha256(br#"{"value":59662}"#)
    );
    assert_eq!(
        server2::storage::sha256(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
use server2::storage::*;
fn record(bytes: &[u8]) -> RawRecord {
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
        "text/html; charset=euc-kr",
        None,
        bytes.into(),
        &Limits::default(),
    )
    .unwrap()
}
fn object(p: &PreparedRecord) -> Object {
    Object {
        metadata: p.metadata.clone(),
        length: p.body.len(),
        body: p.body.clone(),
    }
}
#[test]
fn exact_binary_roundtrip_deterministic_and_empty() {
    for bytes in [&[0xb0, 0xa1, 0xff, 0], &b""[..], &b"<rss><item/></rss>"[..]] {
        let r = record(bytes);
        let p = r.prepare(&Limits::default()).unwrap();
        let p2 = r.prepare(&Limits::default()).unwrap();
        assert_eq!(p.body, p2.body);
        assert_eq!(&p.body[4..8], &[0, 0, 0, 0]);
        let restored =
            decode(&p.key, object(&p), &r.envelope.identity, &Limits::default()).unwrap();
        assert_eq!(&*restored.bytes, bytes);
        assert_eq!(restored.envelope, r.envelope);
    }
}
#[test]
fn collision_keys_and_every_revision_are_distinct() {
    let a = record(br#"{"value":37626}"#);
    let mut b = record(br#"{"value":59662}"#);
    assert_ne!(
        a.envelope.identity.object_key().unwrap(),
        b.envelope.identity.object_key().unwrap()
    );
    let first = b.envelope.identity.object_key().unwrap();
    b.envelope.identity.fetched_at_ms += 1;
    assert_ne!(first, b.envelope.identity.object_key().unwrap());
}
#[test]
fn rejects_truncated_extra_members_trailing_bytes_and_hash_disagreement() {
    let r = record(b"raw");
    let p = r.prepare(&Limits::default()).unwrap();
    for body in [
        p.body[..p.body.len() - 1].to_vec(),
        [p.body.clone(), p.body.clone()].concat(),
        [p.body.clone(), vec![0]].concat(),
        vec![0; 20],
    ] {
        let mut o = object(&p);
        o.body = body;
        o.length = o.body.len();
        o.metadata.insert("s2-gzip-sha256".into(), sha256(&o.body));
        assert!(decode(&p.key, o, &r.envelope.identity, &Limits::default()).is_err());
    }
    let mut id = r.envelope.identity.clone();
    id.raw_sha256 = sha256(b"different");
    assert!(decode(&p.key, object(&p), &id, &Limits::default()).is_err());
    let mut o = object(&p);
    o.metadata.insert("s2-record".into(), "%%%%".into());
    assert!(decode(&p.key, o, &r.envelope.identity, &Limits::default()).is_err());
}
#[test]
fn rejects_raw_and_compressed_limits_and_noncanonical_metadata() {
    let r = record(&[0; 1024]);
    let p = r.prepare(&Limits::default()).unwrap();
    let raw = Limits {
        raw_bytes: 128,
        ..Limits::default()
    };
    assert!(r.prepare(&raw).is_err());
    assert!(decode(&p.key, object(&p), &r.envelope.identity, &raw).is_err());
    let gz = Limits {
        gzip_bytes: 8,
        ..Limits::default()
    };
    assert!(r.prepare(&gz).is_err());
    assert!(decode(&p.key, object(&p), &r.envelope.identity, &gz).is_err());
    let mut o = object(&p);
    o.metadata.insert("extra".into(), "field".into());
    assert!(decode(&p.key, o, &r.envelope.identity, &Limits::default()).is_err());
}
#[test]
fn validates_keys_dates_envelope_pages_and_group_reference() {
    for key in [
        ProviderKey::Named {
            id: "../../escape".into(),
        },
        ProviderKey::WorldCell {
            lat_hundredths: 0,
            lon_hundredths: 12700,
        },
        ProviderKey::Grid { nx: 0, ny: 127 },
    ] {
        assert!(key.canonical_bytes().is_err());
    }
    let mut r = record(b"raw");
    r.envelope.identity.period.local_date = 20260230;
    assert!(r.prepare(&Limits::default()).is_err());
    let mut r = record(b"raw");
    r.envelope.identity.kind = "current/escape".into();
    assert!(r.prepare(&Limits::default()).is_err());
    let mut r = record(b"raw");
    r.envelope.status = 429;
    assert!(r.prepare(&Limits::default()).is_err());
    let mut r = record(b"raw");
    r.envelope.pagination = Some(Pagination {
        page: 2,
        pages: 1,
        complete: true,
    });
    assert!(r.prepare(&Limits::default()).is_err());
    let mut r = record(b"raw");
    r.envelope.fetch_group = Some(FetchGroupRef {
        group_sha256: sha256(b"group"),
        member_sha256: sha256(b"members"),
        partitions_sha256: sha256(b"partitions"),
        members: 3,
    });
    let p = r.prepare(&Limits::default()).unwrap();
    assert_eq!(
        decode(&p.key, object(&p), &r.envelope.identity, &Limits::default())
            .unwrap()
            .envelope,
        r.envelope
    );
    r.envelope.fetch_group.as_mut().unwrap().group_sha256 = "short".into();
    assert!(r.prepare(&Limits::default()).is_err());
}

#[test]
fn rejects_exact_limit_plus_one_bytes() {
    let r = record(&[0; 129]);
    let limits = Limits {
        raw_bytes: 128,
        ..Limits::default()
    };
    assert!(r.prepare(&limits).is_err());
    let r = record(&[0; 128]);
    let p = r.prepare(&limits).unwrap();
    assert_eq!(
        decode(&p.key, object(&p), &r.envelope.identity, &limits)
            .unwrap()
            .bytes
            .len(),
        128
    );
    let limits = Limits {
        gzip_bytes: p.body.len() - 1,
        ..limits
    };
    assert!(decode(&p.key, object(&p), &r.envelope.identity, &limits).is_err());
}
#[test]
fn valid_gzip_with_same_prefix_raw_hash_but_wrong_full_identity_is_rejected() {
    let a = record(br#"{"value":37626}"#);
    let b = record(br#"{"value":59662}"#);
    assert_eq!(
        &a.envelope.identity.raw_sha256[..8],
        &b.envelope.identity.raw_sha256[..8]
    );
    assert_eq!(a.bytes.len(), b.bytes.len());
    let pa = a.prepare(&Limits::default()).unwrap();
    let pb = b.prepare(&Limits::default()).unwrap();
    let mut tampered = object(&pa);
    tampered.body = pb.body;
    tampered.length = tampered.body.len();
    tampered
        .metadata
        .insert("s2-gzip-sha256".into(), sha256(&tampered.body));
    assert!(matches!(
        decode(&pa.key, tampered, &a.envelope.identity, &Limits::default()),
        Err(Error::Corrupt("raw/member limit/hash"))
    ));
}
