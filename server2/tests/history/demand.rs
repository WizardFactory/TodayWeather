//! Durable demand under state/demand/grid/: exact privacy-safe bytes, expiry, CAS and rebuild.
use super::support::*;
use server2::history::Grid;
use server2::history::demand::{
    DEMAND_WINDOW_MS, DemandChange, DemandConfig, DemandError, DemandStore, PUSH_KEY, PushOutcome,
    request_key,
};
use std::collections::BTreeSet;
use std::sync::{Arc, atomic::Ordering};

const T0: i64 = 1_790_000_000_000;

fn store(t: &Arc<MemoryDemand>) -> DemandStore<MemoryDemand> {
    DemandStore::new(t.clone(), DemandConfig::default()).unwrap()
}

#[tokio::test]
async fn demand_touch_writes_only_grid_last_demand_and_expiry() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    assert_eq!(s.touch(g(60, 127), T0).await.unwrap(), DemandChange::New);
    assert_eq!(
        request_key(g(60, 127)),
        "state/demand/grid/request/060-127.json"
    );
    let body = t.raw("state/demand/grid/request/060-127.json").unwrap();
    assert_eq!(
        String::from_utf8(body).unwrap(),
        format!(
            r#"{{"schema":1,"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{}}}"#,
            T0 + DEMAND_WINDOW_MS
        )
    );
    assert_eq!(DEMAND_WINDOW_MS, 8 * DAY);
    // Every stored key stays under the demand prefix.
    for key in t.objects.lock().unwrap().keys() {
        assert!(key.starts_with("state/demand/grid/"), "{key}");
    }
}

#[tokio::test]
async fn demand_refresh_is_coalesced_and_keeps_the_latest_demand() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    s.touch(g(60, 127), T0).await.unwrap();
    // Within the 10-minute refresh interval no durable write happens, but memory advances.
    assert_eq!(
        s.touch(g(60, 127), T0 + 60_000).await.unwrap(),
        DemandChange::Unchanged
    );
    assert_eq!(t.puts.load(Ordering::SeqCst), 1);
    assert!(
        s.active(T0 + 60_000 + DEMAND_WINDOW_MS - 1)
            .contains(&g(60, 127))
    );
    // After the refresh interval the durable record advances.
    assert_eq!(
        s.touch(g(60, 127), T0 + 11 * 60_000).await.unwrap(),
        DemandChange::Refreshed
    );
    assert_eq!(t.puts.load(Ordering::SeqCst), 2);
    let fresh = store(&t);
    fresh.rebuild().await.unwrap();
    assert!(
        fresh
            .active(T0 + 11 * 60_000 + DEMAND_WINDOW_MS - 1)
            .contains(&g(60, 127))
    );
    assert!(
        !fresh
            .active(T0 + 11 * 60_000 + DEMAND_WINDOW_MS)
            .contains(&g(60, 127))
    );
}

#[tokio::test]
async fn demand_expires_after_eight_days_and_resumes() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    s.touch(g(60, 127), T0).await.unwrap();
    assert!(s.active(T0 + DEMAND_WINDOW_MS - 1).contains(&g(60, 127)));
    assert!(s.active(T0 + DEMAND_WINDOW_MS).is_empty());
    let later = T0 + DEMAND_WINDOW_MS + DAY;
    assert_eq!(
        s.touch(g(60, 127), later).await.unwrap(),
        DemandChange::Resumed
    );
    // A replacement process also sees the expired record as resumed.
    let t2 = Arc::new(MemoryDemand::default());
    t2.plant(
        &request_key(g(61, 127)),
        format!(
            r#"{{"schema":1,"grid":{{"nx":61,"ny":127}},"lastDemandMs":{T0},"expiresMs":{}}}"#,
            T0 + DEMAND_WINDOW_MS
        )
        .as_bytes(),
    );
    assert_eq!(
        store(&t2).touch(g(61, 127), later).await.unwrap(),
        DemandChange::Resumed
    );
}

#[tokio::test]
async fn demand_conditional_write_retries_after_a_conflict() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    s.touch(g(60, 127), T0).await.unwrap();
    t.conflicts.store(1, Ordering::SeqCst);
    let other = store(&t);
    assert_eq!(
        other.touch(g(60, 127), T0 + 20 * 60_000).await.unwrap(),
        DemandChange::Refreshed
    );
    let fresh = store(&t);
    fresh.rebuild().await.unwrap();
    assert!(
        fresh
            .active(T0 + 20 * 60_000 + DEMAND_WINDOW_MS - 1)
            .contains(&g(60, 127))
    );
    // A persistent conflict is an error, not a silent success.
    t.conflicts.store(10, Ordering::SeqCst);
    let stuck = store(&t);
    assert_eq!(
        stuck.touch(g(60, 127), T0 + 40 * 60_000).await,
        Err(DemandError::Conflict)
    );
}

#[tokio::test]
async fn demand_rejects_personal_identifiers_and_foreign_shapes() {
    let t = Arc::new(MemoryDemand::default());
    let good = request_key(g(60, 127));
    let expires = T0 + DEMAND_WINDOW_MS;
    let base = format!(
        r#""schema":1,"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{expires}"#
    );
    for extra in [
        r#""lat":37.5663,"lon":126.9779"#,
        r#""ip":"203.0.113.7""#,
        r#""deviceId":"d-1""#,
        r#""userId":"u-1""#,
        r#""subscriberId":"s-1""#,
        r#""token":"t""#,
        r#""requests":[{"path":"/weather/coord/37.5,127"}]"#,
    ] {
        t.objects.lock().unwrap().clear();
        t.plant(&good, format!("{{{base},{extra}}}").as_bytes());
        let s = store(&t);
        let report = s.rebuild().await.unwrap();
        assert_eq!(report.invalid, 1, "{extra}");
        assert!(s.active(T0).is_empty(), "{extra}");
    }
    // Key/body grid mismatch, wrong expiry and bad schema are rejected too.
    for (key, body) in [
        (request_key(g(61, 127)), format!("{{{base}}}")),
        (
            good.clone(),
            format!(
                r#"{{"schema":1,"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{}}}"#,
                expires + 1
            ),
        ),
        (
            good.clone(),
            format!(
                r#"{{"schema":2,"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{expires}}}"#
            ),
        ),
        (
            good.clone(),
            format!(
                r#"{{"schema":1,"grid":{{"nx":0,"ny":127}},"lastDemandMs":{T0},"expiresMs":{expires}}}"#
            ),
        ),
        (
            "state/demand/grid/request/37.5663-126.9779.json".to_owned(),
            format!("{{{base}}}"),
        ),
    ] {
        t.objects.lock().unwrap().clear();
        t.plant(&key, body.as_bytes());
        let s = store(&t);
        let report = s.rebuild().await.unwrap();
        assert_eq!(report.invalid, 1, "{key} {body}");
        assert!(s.active(T0).is_empty());
    }
    // Overwriting a tampered record replaces it with the exact allowed shape.
    t.objects.lock().unwrap().clear();
    t.plant(&good, format!(r#"{{{base},"token":"t"}}"#).as_bytes());
    let s = store(&t);
    assert_eq!(s.touch(g(60, 127), T0).await.unwrap(), DemandChange::New);
    assert!(
        !String::from_utf8(t.raw(&good).unwrap())
            .unwrap()
            .contains("token")
    );
}

#[tokio::test]
async fn demand_push_aggregate_holds_only_grid_cells() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    s.replace_push(&[g(98, 76), g(60, 127), g(98, 76)], T0, 25 * HOUR)
        .await
        .unwrap();
    assert_eq!(PUSH_KEY, "state/demand/grid/push.json");
    let body = String::from_utf8(t.raw(PUSH_KEY).unwrap()).unwrap();
    let e = T0 + 25 * HOUR;
    assert_eq!(
        body,
        format!(
            r#"{{"schema":1,"lastDemandMs":{T0},"cells":[{{"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{e}}},{{"grid":{{"nx":98,"ny":76}},"lastDemandMs":{T0},"expiresMs":{e}}}]}}"#
        )
    );
    assert_eq!(
        s.active(T0 + HOUR).into_iter().collect::<Vec<_>>(),
        vec![g(60, 127), g(98, 76)]
    );
    assert!(s.active(e).is_empty());
    // TTL is bounded by the 8-day demand window; a replacement drops removed cells.
    assert!(matches!(
        s.replace_push(&[g(60, 127)], T0, DEMAND_WINDOW_MS + 1)
            .await,
        Err(DemandError::Invalid(_))
    ));
    s.replace_push(&[g(98, 76)], T0 + HOUR, 25 * HOUR)
        .await
        .unwrap();
    assert_eq!(
        s.active(T0 + 2 * HOUR).into_iter().collect::<Vec<Grid>>(),
        vec![g(98, 76)]
    );
    // A push aggregate with subscriber details is rejected as a whole.
    t.plant(
        PUSH_KEY,
        format!(r#"{{"schema":1,"lastDemandMs":{T0},"cells":[{{"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{e},"subscribers":2}}]}}"#).as_bytes(),
    );
    let fresh = store(&t);
    assert_eq!(fresh.rebuild().await.unwrap().invalid, 1);
    assert!(fresh.active(T0).is_empty());
}

#[tokio::test]
async fn demand_push_snapshots_never_move_backwards() {
    let t = Arc::new(MemoryDemand::default());
    let newer = store(&t);
    let older = store(&t);
    assert_eq!(
        newer
            .replace_push(&[g(98, 76)], T0 + HOUR, 25 * HOUR)
            .await
            .unwrap(),
        PushOutcome::Replaced
    );
    // A reconciler holding an older snapshot (or retrying after a conflict) does not overwrite.
    assert_eq!(
        older
            .replace_push(&[g(60, 127)], T0, 25 * HOUR)
            .await
            .unwrap(),
        PushOutcome::Superseded
    );
    assert!(
        String::from_utf8(t.raw(PUSH_KEY).unwrap())
            .unwrap()
            .contains(r#""nx":98"#)
    );
    assert_eq!(older.active(T0 + 2 * HOUR), BTreeSet::from([g(98, 76)]));
    // Memory keeps the newest snapshot regardless of completion order.
    assert_eq!(
        newer
            .replace_push(&[g(60, 127)], T0, 25 * HOUR)
            .await
            .unwrap(),
        PushOutcome::Superseded
    );
    assert_eq!(newer.active(T0 + 2 * HOUR), BTreeSet::from([g(98, 76)]));
    // A conflict retry re-reads and still refuses to go backwards.
    t.conflicts.store(1, Ordering::SeqCst);
    assert_eq!(
        older
            .replace_push(&[g(61, 127)], T0 + 2 * HOUR, 25 * HOUR)
            .await
            .unwrap(),
        PushOutcome::Replaced
    );
    assert_eq!(older.active(T0 + 3 * HOUR), BTreeSet::from([g(61, 127)]));
}

#[tokio::test]
async fn demand_rebuild_never_rolls_push_memory_back() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    s.replace_push(&[g(98, 76)], T0 + HOUR, 25 * HOUR)
        .await
        .unwrap();
    // A rebuild that reads an older aggregate (a stale read racing a newer replace) keeps memory.
    let e = T0 + 25 * HOUR;
    t.plant(
        PUSH_KEY,
        format!(r#"{{"schema":1,"lastDemandMs":{T0},"cells":[{{"grid":{{"nx":60,"ny":127}},"lastDemandMs":{T0},"expiresMs":{e}}}]}}"#).as_bytes(),
    );
    s.rebuild().await.unwrap();
    assert_eq!(s.active(T0 + 2 * HOUR), BTreeSet::from([g(98, 76)]));
    // An equal-time aggregate read during a rebuild never replaces the one this store wrote.
    s.replace_push(&[g(61, 127)], T0 + 2 * HOUR, 25 * HOUR)
        .await
        .unwrap();
    let e2 = T0 + 27 * HOUR;
    let t2 = T0 + 2 * HOUR;
    t.plant(
        PUSH_KEY,
        format!(r#"{{"schema":1,"lastDemandMs":{t2},"cells":[{{"grid":{{"nx":60,"ny":127}},"lastDemandMs":{t2},"expiresMs":{e2}}}]}}"#).as_bytes(),
    );
    s.rebuild().await.unwrap();
    assert_eq!(s.active(T0 + 3 * HOUR), BTreeSet::from([g(61, 127)]));
    // A missing object never clears push demand already held.
    t.objects.lock().unwrap().remove(PUSH_KEY);
    s.rebuild().await.unwrap();
    assert_eq!(s.active(T0 + 3 * HOUR), BTreeSet::from([g(61, 127)]));
    // A fresh process adopts whatever aggregate is durable.
    t.plant(
        PUSH_KEY,
        format!(r#"{{"schema":1,"lastDemandMs":{t2},"cells":[{{"grid":{{"nx":60,"ny":127}},"lastDemandMs":{t2},"expiresMs":{e2}}}]}}"#).as_bytes(),
    );
    let fresh = store(&t);
    fresh.rebuild().await.unwrap();
    assert_eq!(fresh.active(T0 + 3 * HOUR), BTreeSet::from([g(60, 127)]));
}

#[tokio::test]
async fn demand_push_aggregate_at_the_cell_limit_round_trips() {
    let t = Arc::new(MemoryDemand::default());
    let s = store(&t);
    let cells: Vec<Grid> = (1..=149u16)
        .flat_map(|nx| (1..=253u16).map(move |ny| g(nx, ny)))
        .take(8192)
        .collect();
    let big = 253_402_268_000_000 - DEMAND_WINDOW_MS;
    s.replace_push(&cells, big, DEMAND_WINDOW_MS).await.unwrap();
    assert!(t.raw(PUSH_KEY).unwrap().len() > 512 * 1024);
    let fresh = store(&t);
    let report = fresh.rebuild().await.unwrap();
    assert_eq!((report.push_cells, report.invalid), (8192, 0));
    // One more cell is refused before any write.
    let mut over = cells.clone();
    over.push(g(149, 253));
    assert!(matches!(
        s.replace_push(&over, big + 1, HOUR).await,
        Err(DemandError::Invalid(_))
    ));
}

#[tokio::test]
async fn demand_rebuild_after_replacement_restores_the_active_set() {
    let t = Arc::new(MemoryDemand::paged(2));
    let s = store(&t);
    for (i, nx) in [55u16, 56, 57, 58, 59].iter().enumerate() {
        s.touch(g(*nx, 100), T0 + i as i64 * HOUR).await.unwrap();
    }
    s.replace_push(&[g(98, 76)], T0, 25 * HOUR).await.unwrap();
    drop(s);
    let replacement = store(&t);
    let report = replacement.rebuild().await.unwrap();
    assert_eq!(report.request_records, 5);
    assert_eq!(report.push_cells, 1);
    assert_eq!(report.invalid, 0);
    let now = T0 + 5 * HOUR;
    assert_eq!(replacement.active(now).len(), 6);
    // The first cell expires first; push demand lasts its own TTL.
    let late = T0 + DEMAND_WINDOW_MS + 30 * 60_000;
    let active = replacement.active(late);
    assert!(!active.contains(&g(55, 100)));
    assert!(active.contains(&g(59, 100)));
    assert!(!active.contains(&g(98, 76)));
    assert_eq!(replacement.known().len(), 6);
}

#[test]
fn demand_grid_is_bounded_to_the_kma_grid() {
    assert!(Grid::new(1, 1).is_some());
    assert!(Grid::new(149, 253).is_some());
    assert!(Grid::new(0, 1).is_none());
    assert!(Grid::new(150, 1).is_none());
    assert!(Grid::new(1, 254).is_none());
}
