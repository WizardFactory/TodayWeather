//! Combined production factory/public router coverage, not OS-process or release rollback.
//! The real worker supervisor and delayed acquisition loop are deliberately never started.
use super::common::{Http, Peer, ready};
use reqwest::{Client, Method};
use serde_json::{Value, json};
use server2::{notice::store::Mutation, runtime_services::RuntimeServices};
use std::{collections::BTreeSet, time::Duration};

const FAMILIES: &str = "geocode,dsf,kma,kma-v000901,kma-v000902,town,push,notice";
const TOKEN: &str = "s20h-owned-registration";

fn services(peer: &Peer) -> RuntimeServices {
    services_for(peer, FAMILIES)
}
fn services_for(peer: &Peer, families: &str) -> RuntimeServices {
    services_at(
        peer,
        families,
        std::sync::Arc::new(server2::budget::SystemClock),
    )
}
fn services_at(
    peer: &Peer,
    families: &str,
    clock: std::sync::Arc<dyn server2::budget::Clock>,
) -> RuntimeServices {
    let defaults = peer.vars(families);
    let vars = |name: &str| match name {
        "GEOCODER_KAKAO_KEYS" => Some(r#"["synthetic-s20h-kakao"]"#.into()),
        "GEOCODER_GOOGLE_KEY" => Some("synthetic-s20h-google".into()),
        "DONGNAE_SECRET_KEYS" => Some(r#"["synthetic-s20h-data-go-kr"]"#.into()),
        "SERVER2_WORLD_VERSIONS" => Some("v000901,v000902,v000903".into()),
        _ => defaults(name),
    };
    assert!(vars("SERVER2_GATEWAY_LEGACY_URL").is_none());
    // Every provider root is unreachable loopback; FCM/OAuth are explicitly owned.
    // No private dotenv/account file or real instance role is consulted.
    RuntimeServices::from_vars_with_delivery(
        &vars,
        &peer.builtins(),
        server2::push::deliver::Endpoints::loopback(&peer.endpoint),
        clock,
        None,
    )
    .unwrap()
}

// Each GET has a deliberate cold-empty/unavailable input and expected native status.
// Direct KMA may complete with partial weather or its exact dependency-error reply.
// These are route/contract checks, not weather availability, latency or frozen-input parity.
#[derive(Clone, Copy, Debug)]
enum Expected {
    Status(u16),
    Nation,
    NativeKma,
}
fn reads() -> Vec<(&'static str, &'static str, Expected)> {
    use Expected::{Nation, NativeKma, Status};
    vec![
        (
            "/weather/coord/{location}",
            "/weather/coord/not-a-coordinate",
            Status(400),
        ),
        (
            "/weather/v000903/coord/{location}",
            "/weather/v000903/coord/not-a-coordinate",
            Status(400),
        ),
        (
            "/v000901/kma/addr/{location}",
            "/v000901/kma/addr/Seoul",
            NativeKma,
        ),
        (
            "/v000903/kma/addr/{location}",
            "/v000903/kma/addr/Seoul",
            NativeKma,
        ),
        (
            "/geocode/v000903/coord/{location}",
            "/geocode/v000903/coord/not-a-coordinate",
            Status(400),
        ),
        ("/v000803/town/{location}", "/v000803/town/Seoul", NativeKma),
        ("/v000903/nation/KR", "/v000903/nation/KR", Nation),
        (
            "/weather/v000901/coord/{location}",
            "/weather/v000901/coord/not-a-coordinate",
            Status(400),
        ),
        (
            "/weather/v000902/coord/{location}",
            "/weather/v000902/coord/not-a-coordinate",
            Status(400),
        ),
        (
            "/geocode/v000903/addr/{location}",
            "/geocode/v000903/addr/Seoul",
            Status(501),
        ),
        ("/v000903/kma/special", "/v000903/kma/special", Status(501)),
        ("/v000705/town/{location}", "/v000705/town/Seoul", NativeKma),
        (
            "/geocode/v000901/addr/{location}",
            "/geocode/v000901/addr/Seoul",
            Status(501),
        ),
        ("/v000901/nation/KR", "/v000901/nation/KR", Nation),
        (
            "/v000903/notice/latest",
            "/v000903/notice/latest",
            Status(200),
        ),
        (
            "/ww/010000/current/2",
            "/ww/010000/current/2?gcode=not-a-coordinate",
            Status(400),
        ),
    ]
}
fn mutations() -> [(&'static str, &'static str); 5] {
    [
        ("POST", "/v000902/push-list"),
        ("PUT", "/v000902/push"),
        ("POST", "/v000705/push"),
        ("OPTIONS", "/v000902/push"),
        ("DELETE", "/v000902/push"),
    ]
}
fn assert_inventory(inventory: &Value) {
    let declared: BTreeSet<_> = inventory["routes"]
        .as_array()
        .unwrap()
        .iter()
        .chain(inventory["supplements"].as_array().unwrap())
        .map(|r| {
            (
                r["method"].as_str().unwrap().to_owned(),
                r["path"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        declared.len(),
        inventory["routes"].as_array().unwrap().len()
            + inventory["supplements"].as_array().unwrap().len(),
        "inventory entries must be unique"
    );
    let exercised: BTreeSet<_> = reads()
        .iter()
        .map(|(p, _, _)| ("GET".to_owned(), (*p).to_owned()))
        .chain(
            mutations()
                .iter()
                .map(|(m, p)| ((*m).to_owned(), (*p).to_owned())),
        )
        .collect();
    assert_eq!(
        declared, exercised,
        "every inventory entry needs a concrete reviewed case"
    );
    assert_eq!(
        declared.len(),
        21,
        "historical19 plus notice/WW; prose is a response supplement"
    );
}
fn inventory() -> Value {
    serde_json::from_str(include_str!("../../config/cutover/inventory.json")).unwrap()
}

#[test]
fn combined_inventory_rejects_an_unmapped_route() {
    let mut changed = inventory();
    changed["routes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"method":"GET","path":"/new-native-route"}));
    assert!(std::panic::catch_unwind(|| assert_inventory(&changed)).is_err());
    assert_inventory(&inventory());
}

async fn populate(s: &RuntimeServices) -> (Value, Value) {
    let notices = s.notices.as_ref().unwrap();
    let id = notices
        .apply(
            &"b".repeat(64),
            Mutation::Add(json!({
                "texts":{"ko":{"title":"Owned notice","body":"Restored"}},
                "startsAt":"2020-01-01T00:00:00Z"
            })),
            0,
        )
        .await
        .unwrap();
    let now = server2::narrative::now_ms();
    let publication: String = server2::world::js::iso((now + 9 * 3_600_000) as f64).unwrap()[..16]
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    let page = server2::narrative::provider::Page {
        content_type: "application/json; charset=utf-8".into(),
        body: serde_json::to_vec(
            &json!({"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{
                "stnId":108,"tmFc":publication,"wfSv1":"Owned national prose <plain> & unchanged"
            }]}}}}),
        )
        .unwrap()
        .into(),
        fetched_at_ms: now as u64,
    };
    let store = server2::narrative::store::Store::new(s.s3.clone().unwrap()).unwrap();
    let prose = store
        .publish(
            108,
            page,
            tokio::time::Instant::now() + Duration::from_secs(3),
        )
        .await
        .unwrap()
        .unwrap();
    (json!(id), serde_json::to_value(prose).unwrap())
}

async fn push(client: &Client, h: &Http, method: Method, path: &str, body: Value) -> Value {
    let response = client
        .request(method, format!("{}{path}", h.base))
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200, "{path}");
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
    serde_json::from_slice(&response.bytes().await.unwrap()).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn combined_native_router_inventory_and_acknowledged_state_restore() {
    assert_inventory(&inventory());
    // Static town initialization is distinct from the cold request/storage state.
    let _ = server2::domestic::kma::source::towns();
    // Use the standard close-after-response S3 fixture for factory replacement.
    // Its optional persistent mode holds bounded connection slots across pools;
    // it is covered independently by the warning cases, not required for restore.
    let peer = Peer::new();
    let client = Client::builder()
        .pool_max_idle_per_host(0)
        .timeout(Duration::from_secs(12))
        .build()
        .unwrap();
    let mut expected_notice = None;
    let mut expected_prose = None;
    let mut expected_seq = 0;
    let mut expected_notice_wire = None;
    for phase in 0..2 {
        let s = services(&peer);
        ready(&s).await;
        assert!(s.gateway.is_some() && s.delivery.is_some() && s.warning_store.is_some());
        // Constructed delivery workers are never run; only the registration writer is active.
        if phase == 0 {
            let (notice, prose) = populate(&s).await;
            expected_notice = Some(notice);
            expected_prose = Some(prose);
        } else {
            let state = s.push.as_ref().unwrap().state();
            let state = state.read().unwrap();
            assert_eq!(
                state.seq, expected_seq,
                "acknowledged journal sequence restored"
            );
            assert!(
                state
                    .coll(server2::push::Coll::Alarm)
                    .iter()
                    .map(Result::unwrap)
                    .any(|(_, r)| r.token("fcmToken") == Some("s20h-retained-token"))
            );
            assert!(
                !state
                    .coll(server2::push::Coll::Alarm)
                    .iter()
                    .map(Result::unwrap)
                    .any(|(_, r)| r.token("fcmToken") == Some("s20h-deleted-token"))
            );
        }
        // This real-clock/no-weather setup can produce native partial weather or the
        // established rendered child-error response. Validate each exact contract below;
        // it is not frozen-input parity. Canonical prose recovery is checked separately.
        let restored_prose = server2::narrative::store::Store::new(s.s3.clone().unwrap())
            .unwrap()
            .read(
                108,
                server2::narrative::now_ms(),
                tokio::time::Instant::now() + Duration::from_secs(3),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(restored_prose).unwrap(),
            *expected_prose.as_ref().unwrap(),
            "original national prose restored from canonical S3"
        );
        let h = Http::new(s.clone()).await;
        for (pattern, path, expected) in reads() {
            let response = client
                .get(format!("{}{path}", h.base))
                .header("accept-language", "ko")
                .send()
                .await
                .unwrap();
            let status = response.status().as_u16();
            match expected {
                Expected::Status(want) => assert_eq!(status, want, "phase{phase} {pattern}"),
                Expected::NativeKma => assert!(
                    matches!(status, 200 | 502),
                    "phase{phase} {pattern}: {status}"
                ),
                Expected::Nation => assert!(
                    matches!(status, 200 | 500),
                    "phase{phase} {pattern}: {status}"
                ),
            }
            println!("S20H_READ phase={phase} path={pattern} status={status}");
            if matches!(expected, Expected::NativeKma) && status == 502 {
                // api::native's dependency failure is res.status(502).send(text),
                // distinct from gateway no-store and finalhandler error responses.
                assert_eq!(
                    response.headers()["content-type"],
                    "text/html; charset=utf-8"
                );
                assert_eq!(response.headers()["content-length"], "12");
                assert_eq!(response.headers()["x-powered-by"], "Express");
                assert_eq!(response.headers()["access-control-allow-origin"], "*");
                assert!(!response.headers().contains_key("cache-control"));
                assert!(!response.headers().contains_key("x-content-type-options"));
                let tag = response.headers()["etag"].to_str().unwrap().to_owned();
                let body = response.bytes().await.unwrap();
                assert_eq!(body.as_ref(), b"Bad Gateway\n");
                assert_eq!(tag, server2::gateway::response::etag(&body));
            } else if pattern.contains("/nation/") && status == 200 {
                let value: Value =
                    serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
                assert_eq!(value["weather"].as_array().unwrap().len(), 15);
                assert_eq!(
                    value["forecastNarrative"],
                    *expected_prose.as_ref().unwrap()
                );
                assert!(
                    value["weather"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|item| item.get("forecastNarrative").is_none())
                );
            } else if pattern.contains("/nation/") {
                assert_eq!(
                    response.headers()["content-type"],
                    "text/html; charset=utf-8"
                );
                let tag = response.headers()["etag"].to_str().unwrap().to_owned();
                assert!(
                    !response.headers().contains_key("x-content-type-options"),
                    "Jade/res.render error is distinct from the native finalhandler"
                );
                let body = response.bytes().await.unwrap();
                assert_eq!(tag, server2::gateway::response::etag(&body));
                let html = std::str::from_utf8(&body).unwrap();
                assert!(
                    html.contains("response.statusCode=")
                        && html.contains("&quot;getWeather&quot;"),
                    "rendered legacy child-error message must be retained: {html}"
                );
            } else if pattern == "/v000903/kma/special" {
                assert_eq!(
                    response.headers()["content-type"],
                    "text/html; charset=utf-8"
                );
                assert!(!response.headers().contains_key("cache-control"));
                assert_eq!(response.headers()["access-control-allow-origin"], "*");
                assert_eq!(response.bytes().await.unwrap().as_ref(), b"data is empty");
            } else if pattern == "/v000705/town/{location}" {
                // Legacy v000705 omits makeResult: res.json(undefined) has an
                // empty 200 body (chain::send_result / api::express).
                assert_eq!(response.headers()["content-type"], "application/json");
                assert!(!response.headers().contains_key("etag"));
                assert!(response.bytes().await.unwrap().is_empty());
            } else if pattern == "/ww/010000/current/2" {
                // The retained widget wire intentionally removes cache-control
                // for this legacy validation error (world::widget::wire).
                assert_eq!(
                    response.headers()["content-type"],
                    "text/html; charset=utf-8"
                );
                assert!(!response.headers().contains_key("cache-control"));
                let tag = response.headers()["etag"].to_str().unwrap().to_owned();
                let bytes = response.bytes().await.unwrap();
                assert_eq!(bytes.as_ref(), b"It is not valid request");
                assert_eq!(tag, server2::gateway::response::etag(&bytes));
            } else if status >= 400 {
                assert_eq!(response.headers()["cache-control"], "no-store", "{pattern}");
                assert!(!response.bytes().await.unwrap().is_empty());
            } else {
                assert!(
                    response.headers()["content-type"]
                        .to_str()
                        .unwrap()
                        .contains("application/json")
                );
                let bytes = response.bytes().await.unwrap();
                if pattern.contains("/notice/") {
                    if phase == 0 {
                        expected_notice_wire = Some(bytes.to_vec());
                    } else {
                        assert_eq!(
                            bytes.as_ref(),
                            expected_notice_wire.as_ref().unwrap(),
                            "notice wire bytes restored"
                        );
                    }
                }
                let value: Value = serde_json::from_slice(&bytes).unwrap();
                if pattern.contains("/notice/") {
                    assert_eq!(value["notice"]["id"], *expected_notice.as_ref().unwrap());
                    assert_eq!(value["notice"]["title"], "Owned notice");
                    assert_eq!(value["notice"]["body"], "Restored");
                } else {
                    assert!(
                        value.is_object() || value.is_array(),
                        "structured native partial/empty body {pattern}"
                    );
                }
            }
        }
        let head = client
            .head(format!("{}/v000903/notice/latest", h.base))
            .send()
            .await
            .unwrap();
        assert_eq!(head.status(), 200);
        assert!(head.bytes().await.unwrap().is_empty());
        if phase == 0 {
            let registration = |token: &str| json!({"type":"android","fcmToken":token,"cityIndex":0,"id":1,"location":{"lat":37.5,"long":127.1},"source":"KMA","pushTime":79200});
            let first = push(
                &client,
                &h,
                Method::POST,
                "/v000902/push-list",
                json!([registration(TOKEN)]),
            )
            .await;
            assert!(first.to_string().contains("upserted"));
            push(
                &client,
                &h,
                Method::PUT,
                "/v000902/push",
                json!({"oldToken":TOKEN,"newToken":"s20h-retained-token"}),
            )
            .await;
            push(
                &client,
                &h,
                Method::POST,
                "/v000705/push",
                registration("s20h-deleted-token"),
            )
            .await;
            let options = client
                .request(Method::OPTIONS, format!("{}/v000902/push", h.base))
                .header("access-control-request-headers", "content-type")
                .send()
                .await
                .unwrap();
            assert!(options.status().is_success());
            assert_eq!(options.headers()["access-control-allow-origin"], "*");
            let deleted = push(
                &client,
                &h,
                Method::DELETE,
                "/v000902/push",
                json!({"fcmToken":"s20h-deleted-token","cityIndex":0,"id":1,"category":"alarm"}),
            )
            .await;
            assert_eq!(deleted, json!([{"n":1,"ok":1}]));
            let bad = client
                .put(format!("{}/v000902/push", h.base))
                .header("content-type", "application/json")
                .body("{")
                .send()
                .await
                .unwrap();
            assert_eq!(bad.status(), 400);
            expected_seq = s.push.as_ref().unwrap().state().read().unwrap().seq;
            assert_eq!(
                expected_seq, 4,
                "only the four accepted mutations advance the journal"
            );
        }
        println!(
            "S20H_INVENTORY phase={phase} read_cases=16 native_families={FAMILIES} delivery_loops_started=0 production_eligible=false"
        );
        drop(h);
        assert!(
            s.push
                .as_ref()
                .unwrap()
                .drain(tokio::time::Instant::now() + Duration::from_secs(3))
                .await,
            "registration writer stopped before rebuilding the same durable state"
        );
        drop(s);
    }
    println!(
        "S20H_INVENTORY PASS declared_method_paths=21 reconstructed_phases=2; factory/router layer, not OS-process or eligible previous-release proof"
    );
}

// The existing S12 handler owns this contract; the shared production router must
// reach it before the broad direct-KMA mount. Internal warning state is not a
// public family selection.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn warning_api_is_native_only_and_precedes_the_direct_kma_mount() {
    let peer = Peer::persistent();
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    for (families, selected) in [
        (FAMILIES, true),
        ("kma", true),
        ("push,notice", false),
        ("kma-v000901,kma-v000902", false),
        ("notice", false),
    ] {
        let s = services_for(&peer, families);
        ready(&s).await;
        let h = Http::new(s.clone()).await;
        for path in ["/v000903/kma/special", "/V000903/KMA/SPECIAL/"] {
            for method in [Method::GET, Method::HEAD] {
                let response = client
                    .request(method.clone(), format!("{}{path}", h.base))
                    .send()
                    .await
                    .unwrap();
                assert_eq!(
                    response.status().as_u16(),
                    if selected { 501 } else { 404 },
                    "{families} {method} {path}"
                );
                if selected {
                    assert_eq!(
                        response.headers()["content-type"],
                        "text/html; charset=utf-8"
                    );
                    assert!(!response.headers().contains_key("cache-control"));
                    assert_eq!(response.headers()["access-control-allow-origin"], "*");
                    let bytes = response.bytes().await.unwrap();
                    assert_eq!(
                        bytes.as_ref(),
                        if method == Method::HEAD {
                            b"".as_slice()
                        } else {
                            b"data is empty".as_slice()
                        }
                    );
                }
            }
        }
        drop(h);
        if let Some(push) = &s.push {
            assert!(
                push.drain(tokio::time::Instant::now() + Duration::from_secs(3))
                    .await
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn populated_warning_http_survives_shared_service_reconstruction() {
    use server2::warnings::{provider::Operation, records::Member};
    struct Fixed;
    impl server2::budget::Clock for Fixed {
        fn now_ms(&self) -> Result<i64, server2::budget::BudgetError> {
            Ok(server2::warnings::js::parse_iso("2026-10-04T00:10:00.000Z").unwrap())
        }
    }
    let peer = Peer::persistent();
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .unwrap();
    let mut expected = None;
    for phase in 0..2 {
        let s = services_at(&peer, "kma", std::sync::Arc::new(Fixed));
        if phase == 0 {
            let member = |op: Operation, bytes: &str| Member {
                role: op.role().into(),
                bytes: bytes.as_bytes().to_vec().into(),
                fetched_at_ms: server2::warnings::js::parse_iso("2026-09-27T00:20:00.000Z").unwrap()
                    as u64,
            };
            let store = s.warning_store.as_ref().unwrap();
            for (kind, date, members) in [
                (
                    "bulletin-1",
                    20260926,
                    vec![
                        member(
                            Operation::PwnStatus,
                            include_str!("../warnings/fixtures/pwn-status.json"),
                        ),
                        member(
                            Operation::WrnMsg,
                            include_str!("../warnings/fixtures/wrn-msg-0926.json"),
                        ),
                    ],
                ),
                (
                    "bulletin-2",
                    20260926,
                    vec![member(
                        Operation::WthrPwn,
                        include_str!("../warnings/fixtures/wthr-pwn.json"),
                    )],
                ),
                (
                    "bulletin-3",
                    20260927,
                    vec![member(
                        Operation::WthrInfo,
                        include_str!("../warnings/fixtures/wthr-info.json"),
                    )],
                ),
            ] {
                store
                    .publish(
                        kind,
                        date,
                        members,
                        tokio::time::Instant::now() + Duration::from_secs(5),
                    )
                    .await
                    .unwrap();
            }
        }
        let h = Http::new(s).await;
        let response = client
            .get(format!("{}/v000903/kma/special", h.base))
            .header("accept-language", "ko")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["cache-control"], "max-age=300");
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
        let etag = response.headers()["etag"].to_str().unwrap().to_owned();
        let bytes = response.bytes().await.unwrap();
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        let list = value.as_array().unwrap();
        assert_eq!(
            list.iter()
                .map(|x| x["type"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(list[0]["announcement"], "2026-09-26T03:00:00.000Z");
        assert_eq!(list[0]["name"], "기상특보");
        assert_eq!(list[0]["comment"], "o 없음");
        if phase == 0 {
            expected = Some(bytes.to_vec());
        } else {
            assert_eq!(bytes.as_ref(), expected.as_ref().unwrap());
        }
        let head = client
            .head(format!("{}/V000903/KMA/SPECIAL/", h.base))
            .header("accept-language", "ko")
            .send()
            .await
            .unwrap();
        assert_eq!(head.status(), 200);
        assert_eq!(head.headers()["etag"], etag);
        assert_eq!(head.headers()["content-length"], bytes.len().to_string());
        assert!(head.bytes().await.unwrap().is_empty());
        let unchanged = client
            .get(format!("{}/v000903/kma/special", h.base))
            .header("accept-language", "ko")
            .header("if-none-match", &etag)
            .send()
            .await
            .unwrap();
        assert_eq!(unchanged.status(), 304);
        assert!(unchanged.bytes().await.unwrap().is_empty());
    }
}
