# C6 push startup credential verification

Scope: [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819), [spec](../../../../specs/issue-2819-push-credentials.md), isolated child of unmerged C5 PR #2829 ba56cd84. Pre-merge only. Current independent review and exact parent/current CI remain pending; no merge, host/production/full-bundle/shadow or issue closure claim.

## Behavior and retained checks

The shared factory parses/caches active TodayWeather and any configured nonempty TodayAir account before shared S3/native construction or registration restore/writer. Absent retired TodayAir is allowed; TodayAir-only is insufficient. Disabled push reads no account settings. No startup OAuth/FCM request. Low-level lazy constructor, token refresh, send admission/outcomes, immutable claims and no retries remain unchanged. Local parse is not remote authorization/revocation or future filesystem health; restart for rotation.

On unchanged ba56 plus the regression only, startup accepted missing active credentials. The owned writer was quiesced/drained before the intended assertion failed: 0 passed / 1 failed, exit101. Before-source map and executable are retained. The current full runtime target passes **41 tests / 2 ignored**; delivery passes **95 / 0 ignored** (two full targets, **136 passed / 2 ignored**, no double counting focused controls). Cases cover empty/missing/directory, malformed JSON, absent project/email, invalid RSA, TodayAir-only and invalid configured TodayAir. Invalid cases observe zero storage-setting queries and zero owned S3 requests. Valid active-only/both accounts start; no startup OAuth/FCM calls. Cached-account tests remove the file then reach a closed loopback OAuth failure (`oauth`, not `credentials`); they do not obtain a token or send a message.

Actual `cargo fmt --all --check`, all-target Clippy `-D warnings` and optimized server2 build pass with Rust1.99.0/offline locked dependencies. The optimized main executable was retained, not executed. The initial focused compile used an unavailable reqwest JSON convenience method; bytes/serde fixed it. A first Clippy run rejected duplicate external module loading of the public account helper. It is now one canonical included fixture source, preserving the helper API; affected targets were rebuilt and rerun. Those failed invocations remain NOTPASS, not regression Red.

## Additional actual process rehearsal

`server2/tools/push_credentials_smoke.py` drives the shared production process via an ignored stdin-only integration-test entrypoint. Selected retained test executable SHA-256: `b34cdf5cc2c3a68685a265bdd69a46bfe84b7db1ca4264a4a3a8e0d0f3c45655`. Report SHA-256: `edcb2758b26d13e238e741f7ab8f8765e0eaa13bc6aa66acddb36154185d73bc`. This executable requires its matching compile-time checkout assets and is not a portable eligible recovery bundle.

All **8 cases PASS**: missing, malformed, unreadable directory, TodayAir-only and invalid configured TodayAir each exit101 before a readiness line or owned storage request; active-only, both-valid and push-disabled each bind public/private listeners, answer health, TERM/join and exit0. All six bound product ports and all eight owned storage peers close. Startup makes zero OAuth/FCM requests. Zero device sends follows empty registrations and owned/closed endpoints, not a separate live-device counter. Source/tool/peer/public fixture/executable hashes stay unchanged during the run.

The earlier 8-case functional1 result and binary remain historical before the fixture module correction; functional2 is the current result. No test reads dotenv, real Firebase settings/keys or a live provider. The harness error exit is the Rust test harness around actual `process::run`; this is not a production main/dotenv or deployment test.

## Documents, diagram and remaining gates

The [runtime operator manual](../../../operations/server2-runtime-services.md), [native verification instructions](../../../operations/server2-native-verification.md), [architecture](../../../architecture/server2.md), `.env.example`, task declaration and parent plan are maintained. The [editable runtime design](../../../architecture/diagrams/server2-runtime-services.json) and [generated HTML](../../../architecture/diagrams/server2-runtime-services.html) pass artifact/provenance/browser gates. Root inspected initial1440/light and current2048/dark main diagrams; source cards and automated viewport checks are distinct claims. No new public feature/UI or unrelated PDF was created.

C5 parent review is independent and its standard CI remains a separate prerequisite. C1/B1 remain parallel branches. Current C6 review/CI, readiness, initial warning baseline, inventory/dotenv, cold/S3 capacity, eligible full recovery release, #2724 (deferred), seven-day shadow and #2704/#2705 remain outside this local PASS.
