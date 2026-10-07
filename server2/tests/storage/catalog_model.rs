use server2::storage::{
    CatalogId, CatalogLimits, GroupDeclaration, GroupMember, Limits, Pagination, Period,
    ProviderKey, RawRecord,
};
fn record(page: Option<Pagination>) -> RawRecord {
    RawRecord::new(
        "kma",
        "current",
        &ProviderKey::Grid { nx: 60, ny: 127 },
        Period {
            local_date: 20261007,
            slot: "1200".into(),
        },
        1791324000000,
        200,
        "application/json",
        page,
        br#"{"value":37626}"#.to_vec().into(),
        &Limits::default(),
    )
    .unwrap()
}
#[test]
fn full_ordered_pages_are_required_before_publication() {
    let one = record(Some(Pagination {
        page: 1,
        pages: 2,
        complete: true,
    }));
    let id = CatalogId::for_record(&one.envelope.identity, "20261007").unwrap();
    assert!(
        GroupDeclaration::new(
            vec![GroupMember {
                envelope: one.envelope.clone(),
                catalogs: vec![id]
            }],
            &CatalogLimits::default()
        )
        .is_err(),
        "missing page2 cannot be complete"
    );
}
#[test]
fn descriptor_hash_is_non_self_referential_and_all_partitions_are_exact() {
    let raw = record(None);
    let id = CatalogId::for_record(&raw.envelope.identity, "20261007").unwrap();
    let d = GroupDeclaration::new(
        vec![GroupMember {
            envelope: raw.envelope.clone(),
            catalogs: vec![id],
        }],
        &CatalogLimits::default(),
    )
    .unwrap();
    let reference = d.reference(&CatalogLimits::default()).unwrap();
    assert_eq!(
        reference.group_sha256,
        server2::storage::sha256(&d.bytes(&CatalogLimits::default()).unwrap())
    );
    let attached = d.attach(vec![raw], &CatalogLimits::default()).unwrap();
    assert_eq!(attached[0].envelope.fetch_group, Some(reference.clone()));
    assert!(
        GroupDeclaration::new(
            vec![GroupMember {
                envelope: attached[0].envelope.clone(),
                catalogs: d.partitions.clone()
            }],
            &CatalogLimits::default()
        )
        .is_err()
    );
    let mut broken = d.clone();
    broken.partitions.clear();
    assert!(broken.validate(&CatalogLimits::default()).is_err());
    assert_eq!(
        GroupDeclaration::from_bytes(
            &d.bytes(&CatalogLimits::default()).unwrap(),
            &reference,
            &CatalogLimits::default()
        )
        .unwrap(),
        d
    );
}
#[test]
fn absent_merge_never_replaces_present_null_zero_or_false_and_lists_replace() {
    use serde_json::json;
    use server2::storage::{SelectionPolicy, fold_values};
    let values = vec![
        json!({"t":null,"zero":0,"false":false}),
        json!({"t":2,"zero":8,"false":true,"new":3}),
    ];
    assert_eq!(
        fold_values(&values, SelectionPolicy::AbsentFields).unwrap(),
        Some(json!({"t":null,"zero":0,"false":false,"new":3}))
    );
    assert_eq!(
        fold_values(&[json!([1]), json!([2, 3])], SelectionPolicy::ListReplace).unwrap(),
        Some(json!([2, 3]))
    );
}
#[test]
fn list_xml_requires_one_complete_document_and_consistent_flags() {
    use server2::storage::decode_list;
    let good = r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>"#;
    assert!(decode_list(good.as_bytes(), 1).is_ok());
    for bad in [
        format!("{good}<extra/>"),
        format!("{good}garbage"),
        good.replace("<IsTruncated>false</IsTruncated>", ""),
        good.replace(
            "<IsTruncated>false</IsTruncated>",
            "<IsTruncated>false</IsTruncated><IsTruncated>true</IsTruncated>",
        ),
        good.replace("<KeyCount>0</KeyCount>", "<KeyCount>1</KeyCount>"),
        good.replace("http://s3.amazonaws.com/doc/2006-03-01/", "wrong"),
        good.replace(
            "<KeyCount>0</KeyCount>",
            "<KeyCount>0</KeyCount><NextContinuationToken>bad</NextContinuationToken>",
        ),
    ] {
        assert!(decode_list(bad.as_bytes(), 1).is_err(), "must reject {bad}");
    }
}
#[test]
fn catalog_union_is_order_independent_and_full_hash_collision_stays_distinct() {
    use server2::storage::Catalog;
    let a = record(None);
    let mut b = record(None);
    let bytes = br#"{"value":59662}"#.to_vec();
    b.bytes = bytes.into();
    b.envelope.raw_length = b.bytes.len();
    b.envelope.identity.raw_sha256 = server2::storage::sha256(&b.bytes);
    assert_ne!(
        a.envelope.identity.raw_sha256,
        b.envelope.identity.raw_sha256
    );
    let id = CatalogId::for_record(&a.envelope.identity, "20261007").unwrap();
    let empty = Catalog::empty(id);
    let x = empty
        .union(
            &[a.envelope.clone(), b.envelope.clone()],
            &CatalogLimits::default(),
        )
        .unwrap();
    let y = empty
        .union(&[b.envelope, a.envelope], &CatalogLimits::default())
        .unwrap();
    assert_eq!(x, y);
    assert_eq!(x.entries.len(), 2);
}
