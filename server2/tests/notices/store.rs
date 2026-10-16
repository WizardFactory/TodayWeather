use super::common::Memory;
use serde_json::json;
use server2::notice::{
    Error,
    store::{Mutation, NoticeStore},
};
fn input() -> serde_json::Value {
    json!({"texts":{"en":{"title":"Outage","body":"Service restored soon"}}})
}
fn op(c: char) -> String {
    c.to_string().repeat(64)
}
#[tokio::test]
async fn two_writers_keep_distinct_ids_and_restart_restores_all_notices() {
    let m = Memory::default();
    m.0.lock().unwrap().first_read_barrier =
        Some(std::sync::Arc::new(tokio::sync::Barrier::new(2)));
    let a = NoticeStore::new(m.clone());
    let b = NoticeStore::new(m.clone());
    let oa = op('a');
    let ob = op('b');
    let (x, y) = tokio::join!(
        a.apply(&oa, Mutation::Add(input()), 0),
        b.apply(&ob, Mutation::Add(input()), 0)
    );
    let (x, y) = (x.unwrap(), y.unwrap());
    assert_ne!(x, y);
    assert_eq!(
        m.0.lock().unwrap().writes,
        3,
        "one forced CAS loser must retry"
    );
    assert_eq!(NoticeStore::new(m).view().await.unwrap().records.len(), 2);
}
#[tokio::test]
async fn unknown_committed_write_is_read_back_and_same_operation_never_adds_twice() {
    let m = Memory::default();
    m.0.lock().unwrap().lost = true;
    let s = NoticeStore::new(m.clone());
    assert_eq!(
        s.apply(&op('a'), Mutation::Add(input()), 0).await.unwrap(),
        1
    );
    assert_eq!(
        s.apply(&op('a'), Mutation::Add(input()), 0).await.unwrap(),
        1
    );
    assert_eq!(s.view().await.unwrap().records.len(), 1);
    assert_eq!(m.0.lock().unwrap().writes, 1);
}
#[tokio::test]
async fn missing_is_empty_but_cold_failure_is_error_and_verified_copy_survives_corrupt_or_unavailable()
 {
    let m = Memory::default();
    let s = NoticeStore::new(m.clone());
    assert!(s.view().await.unwrap().records.is_empty());
    s.apply(&op('a'), Mutation::Add(input()), 0).await.unwrap();
    m.0.lock().unwrap().read_error = true;
    assert_eq!(s.view().await.unwrap().records.len(), 1);
    assert_eq!(
        NoticeStore::new(m.clone()).view().await.unwrap_err(),
        Error::Unavailable
    );
    {
        let mut d = m.0.lock().unwrap();
        d.read_error = false;
        d.corrupt = true;
    }
    assert_eq!(s.view().await.unwrap().records.len(), 1);
    assert_eq!(
        NoticeStore::new(m).view().await.unwrap_err(),
        Error::Corrupt
    );
}
#[tokio::test]
async fn invalid_or_refused_write_never_acknowledges_or_changes_original_bytes() {
    let m = Memory::default();
    let s = NoticeStore::new(m.clone());
    s.apply(&op('a'), Mutation::Add(input()), 0).await.unwrap();
    let before = m.0.lock().unwrap().object.clone();
    assert!(
        s.apply(&op('b'), Mutation::Add(json!({})), 0)
            .await
            .is_err()
    );
    assert_eq!(m.0.lock().unwrap().object, before);
    m.0.lock().unwrap().refuse = true;
    assert!(s.apply(&op('c'), Mutation::Withdraw(1), 1).await.is_err());
    assert_eq!(m.0.lock().unwrap().object, before);
}

#[tokio::test]
async fn unreadable_unknown_commit_is_uncertain_never_false_success_and_later_same_operation_recovers()
 {
    let m = Memory::default();
    {
        let mut d = m.0.lock().unwrap();
        d.lost = true;
        d.unreadable_after_commit = true;
    }
    let s = NoticeStore::new(m.clone());
    assert_eq!(
        s.apply(&op('a'), Mutation::Add(input()), 0)
            .await
            .unwrap_err(),
        Error::Uncertain
    );
    {
        let mut d = m.0.lock().unwrap();
        d.read_error = false;
        d.unreadable_after_commit = false;
    }
    assert_eq!(
        NoticeStore::new(m.clone())
            .apply(&op('a'), Mutation::Add(input()), 0)
            .await
            .unwrap(),
        1
    );
    assert_eq!(m.0.lock().unwrap().writes, 1);
}
#[tokio::test]
async fn cancellation_after_durable_commit_does_not_duplicate_an_operation() {
    let m = Memory::default();
    let entered = std::sync::Arc::new(tokio::sync::Notify::new());
    let release = std::sync::Arc::new(tokio::sync::Notify::new());
    m.0.lock().unwrap().held_commit = Some((entered.clone(), release));
    let s = std::sync::Arc::new(NoticeStore::new(m.clone()));
    let worker = s.clone();
    let job = tokio::spawn(async move { worker.apply(&op('a'), Mutation::Add(input()), 0).await });
    entered.notified().await;
    job.abort();
    assert!(job.await.unwrap_err().is_cancelled());
    assert_eq!(
        NoticeStore::new(m.clone())
            .apply(&op('a'), Mutation::Add(input()), 0)
            .await
            .unwrap(),
        1
    );
    assert_eq!(m.0.lock().unwrap().writes, 1);
}
#[tokio::test]
async fn stale_generated_source_is_rejected_and_concurrent_manual_language_is_preserved() {
    use server2::notice::{Provenance, Text, store::source_fingerprint};
    use std::collections::BTreeMap;
    let m = Memory::default();
    let s = NoticeStore::new(m.clone());
    s.apply(&op('a'), Mutation::Add(input()), 0).await.unwrap();
    let old = s.canonical().await.unwrap().records[0].clone();
    let fp = source_fingerprint(&old);
    let manual = json!({"texts":{"en":{"title":"Outage","body":"Service restored soon"},"fr":{"title":"Manual","body":"Keep me"}}});
    s.apply(
        &op('b'),
        Mutation::Update {
            id: 1,
            input: manual,
            expected_source: None,
        },
        1,
    )
    .await
    .unwrap();
    let generated = Text {
        title: "Generated".into(),
        body: "Translated".into(),
        translated: Some(Provenance {
            from: "en".into(),
            model: "synthetic".into(),
        }),
    };
    s.apply(
        &op('c'),
        Mutation::Fill {
            id: 1,
            source: fp.clone(),
            texts: BTreeMap::from([
                ("fr".into(), generated.clone()),
                ("ja".into(), generated.clone()),
            ]),
        },
        2,
    )
    .await
    .unwrap();
    assert_eq!(
        s.canonical().await.unwrap().records[0].texts["fr"].title,
        "Manual"
    );
    s.apply(
        &op('d'),
        Mutation::Update {
            id: 1,
            input: json!({"texts":{"en":{"title":"Changed","body":"New source"}}}),
            expected_source: None,
        },
        3,
    )
    .await
    .unwrap();
    let before = m.0.lock().unwrap().object.clone();
    assert_eq!(
        s.apply(
            &op('e'),
            Mutation::Fill {
                id: 1,
                source: fp,
                texts: BTreeMap::from([("fr".into(), generated)])
            },
            4
        )
        .await
        .unwrap_err(),
        Error::Conflict
    );
    assert_eq!(m.0.lock().unwrap().object, before);
}
