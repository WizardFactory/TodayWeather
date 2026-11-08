//! AK 2026-11-08 (`nowcast-fill-v1`): an hour of the last 23 h whose precipitation the ASOS
//! rules leave unknown takes the cell's grid nowcast for that hour, read from S3 or acquired once
//! per cell and base time within the request's wait; a late one serves the next answer. From an
//! empty store at 2026-09-24 09:10 KST, the nowcast reaches back to 2026-09-23 10:00. Scripted
//! providers only; no provider is reached.
use super::shown_publication::{Scene, Session, kst, publication, row};
use super::source_s3::S3_PEERS;
use server2::domestic::publication::Publication;

/// The current observations of 2026-09-23 the answers requested.
fn yesterday(requested: &[Publication]) -> Vec<Publication> {
    requested
        .iter()
        .copied()
        .filter(|p| p.date() == 20260923)
        .collect()
}

/// The ASOS hours 21:00..23:00 measured an uncoded amount too cold for the wet-bulb rule, and so
/// did 05:00, which the nowcast no longer reaches. The nowcast of 21:00..23:00 reports rain. Only
/// those three are requested, once each, and their slots are rain.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unknown_hours_of_the_last_23_hours_take_the_grid_nowcast() {
    let _peers = S3_PEERS.lock().await;
    let raining = [2100, 2200, 2300].map(|t| publication(20260923, t));
    let scene = Scene {
        minute: Some(publication(20260924, 851)),
        untyped: [500, 2100, 2200, 2300]
            .map(|t| publication(20260923, t))
            .to_vec(),
        raining: raining.to_vec(),
        ..Scene::default()
    };
    let answer = Session::new(kst(20260924, 910), &scene).answer().await;
    assert_eq!(
        yesterday(&answer.current),
        raining,
        "the unknown hours, once"
    );
    for time in [21, 24] {
        let slot = row(&answer.body, "20260923", time);
        assert_eq!(slot["pty"], 1, "the nowcast's rain: {slot}");
    }
}

/// A nowcast that answers after the request's wait leaves its hour unknown for that answer (the
/// guard keeps the measured amount from reading dry); the next answer has it without asking the
/// provider again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_late_nowcast_fills_the_next_answer() {
    let _peers = S3_PEERS.lock().await;
    let late = publication(20260923, 2300);
    let scene = Scene {
        minute: Some(publication(20260924, 851)),
        untyped: vec![late],
        raining: vec![late],
        late: Some(late),
        ..Scene::default()
    };
    let session = Session::new(kst(20260924, 910), &scene);
    let first = session.answer().await;
    assert_eq!(yesterday(&first.current), [late]);
    let slot = row(&first.body, "20260923", 24);
    assert_eq!(slot["pty"], -1, "unknown on the first answer: {slot}");
    session.release().await;
    let next = session.answer().await;
    assert_eq!(yesterday(&next.current), [late], "one acquisition");
    let slot = row(&next.body, "20260923", 24);
    assert_eq!(slot["pty"], 1, "the stored nowcast: {slot}");
}

/// The half-day of a past day built from filled hours keeps its type, sky and text: the 2026-09-23
/// afternoon has dry ASOS hours and the nowcast's rain at 21:00..23:00.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_past_half_built_from_filled_hours_keeps_its_fields() {
    let _peers = S3_PEERS.lock().await;
    let raining = [2100, 2200, 2300].map(|t| publication(20260923, t));
    let scene = Scene {
        minute: Some(publication(20260924, 851)),
        untyped: raining.to_vec(),
        raining: raining.to_vec(),
        ..Scene::default()
    };
    let answer = Session::new(kst(20260924, 910), &scene).answer().await;
    let day = answer.body["midData"]["dailyData"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["date"] == "20260923")
        .cloned()
        .unwrap();
    assert_eq!(day["ptyPm"], 1, "{day}");
    assert_eq!(day["wfPm"], "흐리고 비", "{day}");
    assert_eq!(day["skyPm"], "cloud_rain", "{day}");
}
