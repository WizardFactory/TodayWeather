# Private readiness verification

Scope: E3c, base `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1` plus the recorded task changes. This is a local API/availability change; #2819/#2704/#2705 remain open. No real-role IAM, host, provider, device, full recovery or production readiness qualification.

The intended initial Red invoked the real shared process and observed private `/internal/ready` 404 instead of the required 200; its child retired before the assertion. The implemented focused checks pass ten tests with two explicitly ignored child/smoke entries. They cover fixed JSON/no-store, empty valid LIST, 403/503/malformed/oversized responses, credential failure, cancellation/permit recovery, shared S3 and CPU queue deadlines, stop/lost sender, failed push restore, writer exit while pending and later recovery. The existing public health/metrics behavior is preserved. Original compiler/fixture/setup failures were retained separately and are not behavior Red.

The broadened regression covers the library plus foundation, runtime_services, state, raw_records and catalogs. The original 301-passed/6-ignored regression is reused for byte-identical production Rust. The test-only revision redirects every unused provider/metadata builtin to dead loopback. Its focused ten checks, all-target Clippy with `-D warnings`, format check, fresh optimized rebuild and additional process workflow were rerun successfully against the recorded revised test source. The broad regression is not relabelled as a new run. A first command naming a nonexistent `storage` test target ran no tests and is preserved as invalid setup, not a failed product assertion.

A fresh package release rebuild produced main and runtime_services executables. The selected files were copied and hashed outside Cargo target before another worker received its build lease. The additional actual optimized `readiness::owned_readiness_wire_smoke --ignored --nocapture` exited zero: an actual process factory, synthetic credentials and owned S3 peer with client-signed requests (without signature validation) returned 200/503/200, exactly three LISTs, zero S3 writes, public liveness 200, public ready 404, private metrics 200 and wrong-method 405. Both workflow listeners closed after graceful exit. This specific fixture enables notice only; push is not_required, never an assertion that production may omit push.

A separate actual owned process observation at 2026-10-19T06:40:09.390515+00:00 produced the [browser capture](readiness.png). The image displays those retained observations, not a product dashboard. Initial Paseo screenshot/snapshot calls timed out; the delivered capture was taken with headless Chrome in an owned temporary profile. The editable [operator manual](../../../operations/server2-readiness.md) and its four-page PDF were rendered and every page visually inspected: readable labels, correct states and bounds, no clipping/overlap.

Selected release main SHA-256: `bfc3f5ceb3aa231c5e6af37b1e8708ac1c5f1f7731bafd5f365e50968e72d413`. Selected release test SHA-256: `b20a9b59d053d40ea5ab66820571b44339f35820baf166974a7cc15a2cc3414d`. These binaries bind to the retained dirty Rust-source map, not a claim that historical base c1ae9082 already contained the feature. Raw commands/logs/source maps and manual JSON stay in ignored task reports. Full exact-revision integrated bundles are a later task.

The endpoint uses the same canonical push predicate and process stop watch. One three-second timeout includes credential source, shared S3 admission, one raw/v2/ LIST capped at one key/64 KiB, and strict decoding through existing CPU admission. It does not write, start a monitor, call providers/OAuth/FCM or restart work. The same local state is checked after dependencies. GET/HEAD are private; POST performs no probe. A successful LIST does not prove GET/PUT, other prefixes, actual-role missing-key behavior, remote Firebase authorization, capacity or cutover eligibility. #2724 remains deferred. Current independent review and GitHub CI remain separate task gates.


### Executable and checkout boundary

The optimized workflow invokes `process::run` and `RuntimeServices::from_vars_at`
through a code-injected notice-only test child. It bypasses the production main
entrypoint's `.env` loading, `Config::from_vars`, and
`startup::validate_native_coverage`. This partial factory is deliberately not a
complete production selection. The release main `server2` binary was built and
hashed but was not executed by this workflow.

The retained test executable is not a portable standalone bundle: it uses the
original compile-time `CARGO_MANIFEST_DIR` checkout and `python3`, including
`tests/storage/catalog_peer.py`, `deploy/local/peer.py` and
`config/local-stack.json`. Preserve those matching inputs (or use a separately
verified exact source-root bundle) before rerunning it. Copying the executable
out of Cargo target alone does not remove that dependency. All unused provider
and instance-metadata builtins in the test child point to a dead loopback address.

The client sends SigV4-signed requests; the owned peer does not validate
signatures, IAM or TLS. This check proves response handling, not authentication
or permissions. The public route is unmounted and uses the existing fallback;
404 is the observed notice-only fixture result, not a universal coexistence
response claim. Readiness503 currently uses the shared HTTP logger's generic
`cause=capacity`; inspect the fixed component fields before interpreting capacity
alerts. Each configured probe competes for the same S3 admission, so avoid
high-frequency polling.
