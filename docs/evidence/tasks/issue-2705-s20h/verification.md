# S20h warning binding and combined API verification

Task: [#2817](https://github.com/WizardFactory/TodayWeather/issues/2817). Parent S19/S20 issues remain open. Baseline: `28b6dfb4e92aa263b28944084f7fd8d23d3eef1f`.

## Regression and current verification

The unchanged shared production router returned 404 for selected native GET `/v000903/kma/special`. A focused HTTP regression expected the existing S12 empty-data 501 contract and failed with 404 versus 501. The baseline test executable SHA-256 is `2857bbcde6b51c29c433642a01043a7246ae71a53f79bbc280da875aaf79573f`; its source map is `source-sha256:d52b9b456a6bee8c380a9bf4926cd63858fd9eadbfbe90d032ad841b0b49202d`. This is the intended Red. Earlier byte-slice and disabled reqwest JSON-feature compile errors are separate setup failures, not regression evidence.

The corrected warning binding passes the focused selection/GET/HEAD regression. The additional inventory group passes 4 checks: inventory drift rejection, combined API/state reconstruction, populated warning reconstruction, and selected-family boundaries. Three separate existing checks pass for public registration recovery, notice language/HEAD/storage failures, and native worker-fetch construction. Each command ran in its own isolated Linux container with external networking disabled and owned loopback peers. The actual static x86_64 musl test executable SHA-256 is `081cfbbafa38766941c38e6e6d6f3aad4316f709526a7f062fc03186a1524fa8`; its 697-file source map is `source-sha256:613fd3438aaef25057afb09078e2e5b612830034e10eba19106e3484ec33701d`. Binary and source hashes stayed unchanged during these executions.

The earlier combined run completed phase 0 but timed out awaiting the replacement push writer under the optional HTTP/1.1 persistent S3 fixture. The passing combined run uses the existing standard HTTP/1.0 peer without changing its 16-connection admission or 2-second connection-lifetime bounds. Retained pools and fixture expiry are a diagnostic hypothesis, not a proven production defect or a relabeled passing retry. The separate warning cases still use persistent mode. No timeout threshold was extended.

Review, diagram and CI/integration results are recorded separately; this local execution does not attest them.

## Reproduction

Use the locked server2 toolchain and an isolated local environment with Python 3. The tests construct owned loopback S3 peers and synthetic settings; provider roots are unreachable loopback and FCM/OAuth roots are owned. They do not invoke the process supervisor or delivery/narrative loops.

```sh
cd server2
cargo test --locked --test runtime_services inventory:: -- --nocapture --test-threads=1
cargo test --locked --test runtime_services http::public_registration_is_durable_and_recovers_after_reconstruction -- --exact --nocapture
cargo test --locked --test runtime_services http::notice_latest_language_head_and_cold_storage_errors -- --exact --nocapture
cargo test --locked --test runtime_services native::production_native_handlers_are_built_for_push_without_public_selection -- --exact --nocapture
```

The matrix maps the maintained 19 historical method/path groups plus notice and WW to explicit cases and rejects an additional unmapped route. Public mutations and seeded notice/prose survive registration-writer drain and service reconstruction. The separate warning case seeds recorded publications, constructs a new public service and checks the existing GET/HEAD/conditional response contract.

## Retained failures and bounds

Two other generic test assumptions were corrected from existing source: v000705 town returns empty 200 JSON content with no ETag (`res.json(undefined)`), and invalid WW gcode returns its legacy HTML message without cache-control. Original failures are retained; neither required a product change.

Earlier nationwide assertions assumed first a 200 and then a 500; both assumptions failed under the real-clock/no-weather fixture. The original executable later returned 200, disproving that the added prose pre-read was necessary for that result. No product cause or fixed-input nondeterminism is established. Current checks distinguish only the independently supported partial-200 and rendered-child-500 contracts, validate their specific bodies/headers and report each observed status. This does not establish fixed-input parity or zero unexplained differences in a production shadow.

Factory/router reconstruction is not OS-process restart or previous-release qualification. No real provider, push send, production mirror, new host, S3 probe, deployment or cutover occurs in these checks. The deferred #2724 quota evidence remains unmeasured. A full previous release retaining forecastNarrative and all included APIs remains a separate operational gate.

## Architecture evidence

The [source diagram](../../../architecture/diagrams/server2-runtime-services.json) and [generated HTML](../../../architecture/diagrams/server2-runtime-services.html) describe the selected warning binding and existing delivery lifecycle. Archify validation, delivery, strict artifact check and real-browser checks passed. The author inspected all four light/dark captures at 1440×900 and 2048×1320; the routed guard path remains clear. This is source/visual evidence, not a runtime or production execution. The source revision is the actual code/test commit linked by the diagram, retained as an ancestor of the task delivery.
