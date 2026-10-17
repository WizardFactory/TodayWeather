use server2::observability::{self as obs, Context, Method, Route};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_survives_async_and_blocking_handoffs_without_cross_request_contamination() {
    let first = Context::root(Route::Weather, Method::Get);
    let second = Context::root(Route::Push, Method::Put);
    assert_ne!(first.trace_id(), second.trace_id());
    let a = first.scope(async {
        let child = obs::spawn(async { obs::current() }).await.unwrap();
        let blocking = obs::spawn_blocking(obs::current).await.unwrap();
        assert_eq!(first, child);
        assert_eq!(first, blocking);
        let nested = first.child();
        assert_eq!(nested.trace_id(), first.trace_id());
        assert_eq!(nested.parent_operation_id(), Some(first.operation_id()));
        nested
            .scope(async { obs::spawn(async { obs::current() }).await.unwrap() })
            .await
    });
    let b = second.scope(async { obs::spawn(async { obs::current() }).await.unwrap() });
    let (nested, independent) = tokio::join!(a, b);
    assert_eq!(nested.trace_id(), first.trace_id());
    assert_eq!(independent, second);
    assert_ne!(obs::current().trace_id(), first.trace_id());
}

#[test]
fn untrusted_configuration_and_route_text_never_become_identity_or_event_fields() {
    let secret = "SYNTHETIC-SENSITIVE-2802";
    let (options, invalid) = obs::Options::from_vars(&|_| Some(secret.into()));
    assert!(invalid);
    assert_eq!(options.level, obs::Level::Info);
    assert_eq!(options.rate_per_level, 100);
    assert_eq!(
        obs::route(&format!("/unknown/{secret}?token={secret}")),
        Route::Other
    );
    let root = Context::root(Route::Other, Method::Other);
    assert!(!root.trace_id().contains(secret));
    assert_eq!(root.trace_id().len(), 32);
    assert_eq!(root.operation_id().len(), 16);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_submissions_share_a_batch_trace_but_keep_distinct_item_parents() {
    let batch = Context::root(Route::Other, Method::Other);
    let (first, second) = batch
        .scope(async {
            tokio::join!(
                obs::value(
                    obs::Component::Delivery,
                    obs::Stage::Submission,
                    async {
                        let item = obs::current();
                        assert_eq!(obs::spawn(async { obs::current() }).await.unwrap(), item);
                        item
                    },
                    |_| obs::skipped()
                ),
                obs::value(
                    obs::Component::Delivery,
                    obs::Stage::Submission,
                    async {
                        let item = obs::current();
                        assert_eq!(obs::spawn_blocking(obs::current).await.unwrap(), item);
                        item
                    },
                    |_| obs::skipped()
                )
            )
        })
        .await;
    assert_eq!(first.trace_id(), batch.trace_id());
    assert_eq!(second.trace_id(), batch.trace_id());
    assert_ne!(first.operation_id(), second.operation_id());
    assert_eq!(first.parent_operation_id(), Some(batch.operation_id()));
    assert_eq!(second.parent_operation_id(), Some(batch.operation_id()));
}
