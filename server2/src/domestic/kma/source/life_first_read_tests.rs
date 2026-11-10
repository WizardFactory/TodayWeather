//! KMA-LIFE-FIRST-READ (design revision 2, tests T1-T8; T9 is in `tests/domestic`): while a
//! process's first owned life read runs, no request starts a UV or pollen acquisition, raced or not;
//! once that read has ended, however it ended, requests decide as before. The doubles of
//! `distinct_tests` stand for the bucket (an isolated in-memory S3) and the life provider; the tests
//! run on a paused clock with a wall clock that follows it. No provider or AWS is reached.
use super::distinct_tests::{
    Answer, HOLD, IndexOnly, Memory, Provider, TEST_AREAS, Wall, kst, live, no_data, pollen,
    publication, reader, store_at, uv, uv_catalog, uv_issued, uv_page, wall_at,
};
use super::*;
use crate::resolver::race::HEAD_START;
use crate::resolver::{WAITER_BOUND, Waited};
use std::sync::Mutex;

/// The provider operations of UV and oak pollen.
const UV: &str = "getUVIdxV5";
const OAK: &str = "getOakPollenRiskIdxV3";
/// The LIST prefix of the UV kind. The four families are listed together, so a held UV listing
/// holds the whole life read.
const UV_LIST: &str = "index/v2/data-go-kr/uv-idx-v5/";
const MINUTE: u64 = 60_000;

/// Provider calls: (operation, `time`, virtual instant), in order.
type Asked = Arc<Mutex<Vec<(String, String, Instant)>>>;
/// A process over the in-memory S3 whose UV and pollen acquisitions reach the provider double (MFDS
/// and KASI answer nothing, [`IndexOnly`]), with the provider calls it made.
struct Process {
    mem: Memory,
    store: Arc<CatalogStore<Memory>>,
    wall: Arc<Wall>,
    inputs: LifeInputs<Memory>,
    asked: Asked,
}
/// A process started at a KST date and `HHMM` whose provider answers `answer`.
fn process(
    date: u32,
    time: u16,
    answer: impl Fn(&str, &str) -> Answer + Send + Sync + 'static,
) -> Process {
    let mem = Memory::default();
    let store = Arc::new(CatalogStore::new(mem.clone(), CatalogLimits::default()).unwrap());
    let wall = wall_at(date, time);
    let asked = Asked::default();
    let calls = asked.clone();
    let provider = Provider::new(move |operation, time| {
        calls
            .lock()
            .unwrap()
            .push((operation.to_owned(), time.to_owned(), Instant::now()));
        answer(operation, time)
    });
    let live = live(&mem, &store, provider, &wall);
    let inputs = LifeInputs::build(
        reader(&mem, &store),
        Some(Arc::new(IndexOnly(live))),
        (HOLD, HOLD),
        wall.clone(),
    );
    Process {
        mem,
        store,
        wall,
        inputs,
        asked,
    }
}
/// A process started at 2026-11-10 12:30 KST whose provider answers the 12:00 UV slot with one page
/// after `after`, and no data otherwise.
fn at_1230(after: Duration) -> Process {
    let body = uv_page("2026111012", 0, 1, 1);
    process(20261110, 1230, move |operation, time| {
        if operation == UV && time == "2026111012" {
            Answer::After(after, body.clone())
        } else {
            Answer::After(Duration::ZERO, no_data())
        }
    })
}
impl Process {
    /// Every provider call so far: (operation, `time`).
    fn asked(&self) -> Vec<(String, String)> {
        let asked = self.asked.lock().unwrap();
        asked
            .iter()
            .map(|(o, t, _)| (o.clone(), t.clone()))
            .collect()
    }
    /// The UV calls so far: (`time`, virtual instant).
    fn uv_asked(&self) -> Vec<(String, Instant)> {
        let asked = self.asked.lock().unwrap();
        asked
            .iter()
            .filter(|(o, _, _)| o == UV)
            .map(|(_, t, at)| (t.clone(), *at))
            .collect()
    }
    /// One request at `now`, as the KMA source makes it: its head start ends 0.7 s and its wait
    /// 2.5 s after it starts. Its answers and how long it took.
    async fn request_at(&self, now: f64) -> (LifeAnswers, Duration) {
        let started = Instant::now();
        let answers = self
            .inputs
            .load_by(
                now,
                started + HEAD_START,
                started + Duration::from_millis(2700),
            )
            .await;
        (answers, started.elapsed())
    }
    /// [`Self::request_at`] at the wall clock's instant.
    async fn request(&self) -> (LifeAnswers, Duration) {
        self.request_at(self.wall.now()).await
    }
    /// Store `date`'s UV slot `time` (`HHMM`), completed ten minutes after it.
    async fn store_uv(&self, date: u32, time: u16) {
        let issued = format!("{date}{:02}", time / 100);
        let at = kst(date, time) + 10 * MINUTE;
        store_at(
            &self.store,
            "uv-idx-v5",
            publication(date, time),
            at,
            &uv(&issued, 0, 1),
        )
        .await;
    }
    /// Store `date`'s 06 KST issuance of every pollen kind but `missing`, completed ten minutes
    /// after it.
    async fn store_pollen(&self, date: u32, missing: Option<&str>) {
        for (family, _) in &LIFE_FAMILIES[1..] {
            if Some(family.kind()) == missing {
                continue;
            }
            let at = kst(date, 600) + 10 * MINUTE;
            let pages = pollen(&format!("{date}06"), 0);
            store_at(
                &self.store,
                family.kind(),
                publication(date, 600),
                at,
                &pages,
            )
            .await;
        }
    }
    /// Let the paused clock run until a life read has committed.
    async fn committed(&self) {
        for _ in 0..10_000 {
            if self.inputs.shared.life.lock().unwrap().refreshed.is_some() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("no life read committed");
    }
}

/// T1 (I1): S3 holds the current UV slot and every pollen kind's issuance, and the first life read
/// is held past the head start. The request starts no UV or pollen acquisition, waits for the read
/// to its bound and answers without them. Once the read has ended, a request whose fold holds the
/// slot asks the provider nothing either.
#[tokio::test(start_paused = true)]
async fn a_stored_slot_is_asked_neither_during_nor_after_a_slow_first_read() {
    let p = at_1230(Duration::ZERO);
    p.store_uv(20261110, 1200).await;
    p.store_pollen(20261110, None).await;
    let gate = p.mem.hold(UV_LIST);
    let (first, took) = p.request().await;
    assert!(p.mem.reached(), "the first read lists during the request");
    assert!(
        p.asked().is_empty(),
        "no UV or pollen call while the first read runs: {:?}",
        p.asked()
    );
    assert_eq!(
        took,
        Duration::from_millis(2500),
        "it waited for the read to its bound"
    );
    assert!(first.life.is_empty(), "the read has not ended");
    gate.add_permits(1 << 20);
    p.committed().await;
    let (second, _) = p.request().await;
    assert_eq!(uv_issued(&second.life, TEST_AREAS[0]), ["2026111012"; 4]);
    assert!(
        p.asked().is_empty(),
        "nor once it has ended: {:?}",
        p.asked()
    );
}

/// T2 (I1, D3; design Q4): S3 holds today's 09:00 UV slot but not the current 12:00 one, and the
/// first read stalls after its needed-first fold (the oldest UV day's catalog). At the head start that
/// fold is installed and lacks 12:00, but the read is still running: no acquisition starts, and the
/// first answer is the needed-first fold. The first request after the read has ended starts the 12:00
/// acquisition and answers with it.
#[tokio::test(start_paused = true)]
async fn a_missing_slot_is_acquired_by_the_first_request_after_the_first_read() {
    let p = at_1230(Duration::from_secs(1));
    for date in [20261104, 20261105] {
        p.store_uv(date, 1200).await;
    }
    p.store_uv(20261110, 900).await;
    p.store_pollen(20261110, None).await;
    let oldest = uv_catalog(publication(20261104, 1200)).key();
    p.mem.stall_next(&oldest, Duration::from_secs(30));
    let started = Instant::now();
    let (first, _) = p.request().await;
    assert!(
        p.asked().is_empty(),
        "no call while the first read runs: {:?}",
        p.asked()
    );
    assert_eq!(
        first.life.last_issued(KINDS[0]),
        Some("2026111009"),
        "the needed-first fold answers"
    );
    assert!(
        p.inputs.shared.life.lock().unwrap().refreshed.is_none(),
        "before the read commits"
    );
    tokio::time::sleep_until(started + Duration::from_secs(30)).await;
    p.committed().await;
    let (second, _) = p.request().await;
    assert_eq!(
        p.asked(),
        [(UV.to_owned(), "2026111012".to_owned())],
        "the 12:00 slot, asked once"
    );
    assert_eq!(second.life.last_issued(KINDS[0]), Some("2026111012"));
}

/// T3 (I2, D3): the first read fails after the head start: today's only UV partition is listed but
/// its catalog answers nothing, 2 s late. While it runs no acquisition starts, and the request answers
/// when it fails. The next request's read, a second attempt that never commits, fails the same way
/// and misses the head start: it is raced as before, acquiring the current slot at the head start.
#[tokio::test(start_paused = true)]
async fn a_first_read_failing_after_the_head_start_holds_the_race_until_it_fails() {
    let p = at_1230(Duration::from_millis(500));
    p.store_uv(20261110, 900).await;
    let catalog = uv_catalog(publication(20261110, 900)).key();
    p.mem.hide(&catalog);
    p.mem.stall_next(&catalog, Duration::from_secs(2));
    let (first, took) = p.request().await;
    assert!(
        p.asked().is_empty(),
        "no call while the first read runs: {:?}",
        p.asked()
    );
    assert_eq!(
        took,
        Duration::from_secs(2),
        "answered when the read failed"
    );
    assert!(first.life.is_empty());
    assert!(p.inputs.shared.life.lock().unwrap().refreshed.is_none());
    p.mem.stall_next(&catalog, Duration::from_secs(2));
    let started = Instant::now();
    let (second, _) = p.request().await;
    assert_eq!(
        p.uv_asked(),
        [("2026111012".to_owned(), started + HEAD_START)],
        "the current slot, at the head start"
    );
    assert_eq!(
        second.life.last_issued(KINDS[0]),
        Some("2026111012"),
        "answered from the acquisition"
    );
    assert!(
        p.inputs.shared.life.lock().unwrap().refreshed.is_none(),
        "the second read failed too"
    );
}

/// T4 (I2): the first read fails before the head start (its catalog answers nothing at once). The
/// request that waited for it decides as before: it acquires the current slot at once and answers
/// with it.
#[tokio::test(start_paused = true)]
async fn a_first_read_failing_before_the_head_start_acquires_as_before() {
    let p = at_1230(Duration::from_millis(500));
    p.store_uv(20261110, 900).await;
    p.mem.hide(&uv_catalog(publication(20261110, 900)).key());
    let started = Instant::now();
    let (first, _) = p.request().await;
    assert_eq!(
        p.uv_asked(),
        [("2026111012".to_owned(), started)],
        "the current slot, as soon as the read failed"
    );
    assert_eq!(first.life.last_issued(KINDS[0]), Some("2026111012"));
    assert!(p.inputs.shared.life.lock().unwrap().refreshed.is_none());
}

/// T5 (D3): after a committed first read, a later read that misses the head start (the memo expired,
/// its listing held) is raced as before: the request acquires the slot its fold lacks at the head
/// start and answers with it.
#[tokio::test(start_paused = true)]
async fn a_later_read_missing_the_head_start_is_raced_as_before() {
    let p = at_1230(Duration::from_millis(500));
    p.store_uv(20261110, 900).await;
    p.store_pollen(20261110, None).await;
    // A request at 11:30 KST: its slot (09:00) is stored and the read commits at once.
    let (first, _) = p.request_at(kst(20261110, 1130) as f64).await;
    assert_eq!(first.life.last_issued(KINDS[0]), Some("2026111009"));
    assert!(p.asked().is_empty(), "{:?}", p.asked());
    // The memo expires (it counts real time, which the paused clock does not move), and the next
    // read's listing is held.
    p.inputs.shared.life.lock().unwrap().refreshed = std::time::Instant::now().checked_sub(MEMO);
    let gate = p.mem.hold(UV_LIST);
    let started = Instant::now();
    let (second, _) = p.request().await;
    assert!(p.mem.reached(), "the later read lists during the request");
    assert_eq!(
        p.uv_asked(),
        [("2026111012".to_owned(), started + HEAD_START)],
        "the current slot, at the head start"
    );
    assert_eq!(p.asked().len(), 1, "{:?}", p.asked());
    assert_eq!(second.life.last_issued(KINDS[0]), Some("2026111012"));
    gate.add_permits(1 << 20);
}

/// T6 (I1): pollen in season, as T1 and T2 for the oak kind (2026-04-15; the provider answers its 06
/// KST issuance). With the issuance stored, no pollen call during or after a slow first read; without
/// it, none during the read and one by the first request after it.
#[tokio::test(start_paused = true)]
async fn pollen_in_season_waits_for_the_first_read_as_uv_does() {
    for stored in [true, false] {
        let body = pollen("2026041506", 1).remove(0);
        let p = process(20260415, 1230, move |operation, _| {
            if operation == OAK {
                Answer::After(Duration::from_millis(500), body.clone())
            } else {
                Answer::After(Duration::ZERO, no_data())
            }
        });
        p.store_uv(20260415, 1200).await;
        p.store_pollen(20260415, (!stored).then_some("oak-pollen-v3"))
            .await;
        let gate = p.mem.hold(UV_LIST);
        let (first, _) = p.request().await;
        assert!(p.mem.reached(), "stored {stored}");
        assert!(
            p.asked().is_empty(),
            "stored {stored}: no call while the first read runs: {:?}",
            p.asked()
        );
        assert!(first.life.is_empty(), "stored {stored}");
        gate.add_permits(1 << 20);
        p.committed().await;
        let (second, _) = p.request().await;
        let asked: Vec<String> = p.asked().into_iter().map(|(o, _)| o).collect();
        let expected: &[&str] = if stored { &[] } else { &[OAK] };
        assert_eq!(asked, expected, "stored {stored}");
        assert_eq!(
            second.life.last_issued(KINDS[1]),
            Some("2026041506"),
            "stored {stored}"
        );
    }
}

/// T7 (D1, I2): how the first owned read ends. Its listing never answers. The request that started
/// it is cancelled before its head start, and requests that join the running read stop waiting at
/// their bounds (Pending), at once and a minute later: none of them opens the race. With no waiter
/// left, the read ends at its owner deadline (READ_FOR after it started), and the next request,
/// whose own read is held as well, is raced as before. A first read that panics opens the race too.
#[tokio::test(start_paused = true)]
async fn the_first_owned_read_opens_the_race_however_it_ends() {
    let p = at_1230(Duration::from_millis(500));
    let _held = p.mem.hold(UV_LIST);
    let started = Instant::now();
    let cancelled = tokio::time::timeout(Duration::from_millis(300), p.request()).await;
    assert!(cancelled.is_err(), "the first request is cancelled");
    assert!(p.mem.reached(), "after starting the read");
    for at in [Duration::from_millis(300), Duration::from_secs(60)] {
        tokio::time::sleep_until(started + at).await;
        let (answers, took) = p.request().await;
        assert!(
            p.asked().is_empty(),
            "at {at:?}: no call while the first read runs: {:?}",
            p.asked()
        );
        assert_eq!(took, Duration::from_millis(2500), "at {at:?}: Pending");
        assert!(answers.life.is_empty(), "at {at:?}");
    }
    tokio::time::sleep_until(started + READ_FOR + Duration::from_secs(1)).await;
    let later = Instant::now();
    let (answers, _) = p.request().await;
    assert_eq!(
        p.uv_asked(),
        [("2026111012".to_owned(), later + HEAD_START)],
        "raced as before once the first read reached its owner deadline"
    );
    assert_eq!(answers.life.last_issued(KINDS[0]), Some("2026111012"));

    // A first read that panics: its waiter answered (Pending) and the read panics later.
    let p = at_1230(Duration::from_millis(500));
    let gate = p.mem.hold(UV_LIST);
    let (first, _) = p.request().await;
    assert!(p.asked().is_empty(), "{:?}", p.asked());
    assert!(first.life.is_empty());
    gate.close();
    tokio::time::sleep(Duration::from_millis(1)).await;
    // The next request's read panics at once (its waiter fails), so it is not raced.
    let later = Instant::now();
    let (answers, _) = p.request().await;
    assert_eq!(
        p.uv_asked(),
        [("2026111012".to_owned(), later)],
        "decided as before once the first read panicked"
    );
    assert_eq!(answers.life.last_issued(KINDS[0]), Some("2026111012"));
}

/// T8 (I1, D2): the path without a head start (`load`). The first read's listing is held: the read
/// waiter stops at its bound (Pending), the request is not raced, does not wait for the read again and
/// starts no acquisition. A request whose read finds no capacity for an owned read (Busy) starts none
/// either and does not open the race: the process's first owned read is the one that starts later,
/// and the race stays closed until it ends.
#[tokio::test(start_paused = true)]
async fn the_path_without_a_head_start_acquires_nothing_during_the_first_read() {
    let p = at_1230(Duration::from_millis(500));
    let gate = p.mem.hold(UV_LIST);
    let started = Instant::now();
    let answers = p
        .inputs
        .load(p.wall.now(), started + Duration::from_secs(10))
        .await;
    assert!(
        p.asked().is_empty(),
        "no call while the first read runs: {:?}",
        p.asked()
    );
    assert_eq!(
        started.elapsed(),
        WAITER_BOUND,
        "answered when its read waiter stopped"
    );
    assert!(answers.life.is_empty());
    gate.add_permits(1 << 20);
    p.committed().await;
    let answers = p
        .inputs
        .load(p.wall.now(), Instant::now() + Duration::from_secs(10))
        .await;
    assert_eq!(p.uv_asked().len(), 1, "as before once the read has ended");
    assert_eq!(answers.life.last_issued(KINDS[0]), Some("2026111012"));

    // Busy: every owned-read slot runs a read that never ends.
    let p = at_1230(Duration::from_millis(500));
    let started = Instant::now();
    for i in 0..8 {
        let waited = p
            .inputs
            .shared
            .reads
            .join(format!("busy-{i}"), started, READ_FOR, |_| {
                std::future::pending::<bool>()
            })
            .await;
        assert!(matches!(waited, Waited::Pending { .. }), "{waited:?}");
    }
    let answers = p
        .inputs
        .load(p.wall.now(), started + Duration::from_millis(2700))
        .await;
    assert!(
        p.asked().is_empty(),
        "no call without an owned read: {:?}",
        p.asked()
    );
    assert!(started.elapsed() < HEAD_START, "{:?}", started.elapsed());
    assert!(answers.life.is_empty());
    // Those reads end at their owner deadline. The next request starts the first owned read, held.
    tokio::time::sleep_until(started + READ_FOR + Duration::from_secs(1)).await;
    let gate = p.mem.hold(UV_LIST);
    let (first, _) = p.request().await;
    assert!(p.mem.reached(), "the first owned read lists");
    assert!(
        p.asked().is_empty(),
        "no call while it runs: {:?}",
        p.asked()
    );
    assert!(first.life.is_empty());
    gate.add_permits(1 << 20);
    p.committed().await;
    p.request().await;
    assert_eq!(p.uv_asked().len(), 1, "as before once it has ended");
}
