# S02 offline oracle contract

## Architecture and boundary

One named legacy recorder executes real route/controller modules without loading app.js. Maintained offline harness/fixture inputs may be read only inside that recorder. The server2-owned verifier validates the exact legacy-oracle declaration, canonical path and fixture provenance, then runs the recorder as a separate Node process. Runtime server2 never imports legacy. Node dependencies use exact pins and a lock, installed in an isolated temporary prefix with scripts disabled. Production configuration, Mongo, provider/geocoder sockets and push sends fail closed. Only explicitly registered local HTTP listener ports are admitted for wire capture.

Record JSON contains schema version, source revision and SHA256 map of all observed legacy source/input reads, runtime/dependency versions, fixed scenario clock, timezone, request parameters, injected dependency identities/outcomes, actual middleware traces, raw response body encoded as base64, status and ordered normalized header pairs. Body/status/content type/CORS/cache/ETag values are never reformatted. Date is fixed explicitly because Node HTTP's cached Date is independent of the VM clock. Session ID and clock are fixed; any excluded transport-only fields must be named with a reason. Byte comparison operates on whole canonical artifact bytes and separately checks recorded response bytes.

The accepted inventory is the immutable 19-group CSV in docs/evidence/aws. New maintained inventory copies identify the original path/hash and preserve counts. The CSV is scope evidence only. Every group maps to one or more real public wire captures. Separate backend cases cover v901/v902/v903 domestic/world pipelines needed by the weather gateway; a scripted gateway backend response alone cannot satisfy those cases.

## Determinism and failures

Two fresh recorder processes must produce exactly the same files. Verification compares fresh recordings to checked-in goldens and rejects missing/extra cases, altered bytes, wrong source hashes or incomplete inventory. Review-approved differences remain separate metadata; they do not change baseline output. Failed-only POST v705 push uses actual controller/store failure; GET v901 nation uses actual route dependency failure. Recorded 500/502 counts do not supply fabricated expected success.

Fixtures cover all master locales en/ko/ja/de/zh-CN/zh-TW, unit conversions, input/auth validation, default v901 alias, OPTIONS/ETag304, text/HTML errors, yesterday/midnight, partial/no 8-day history, POP covered/missing/old-row cases and warning types including week-old type2/3 and type4 +10h/+19h. Missing grid history records actual legacy empty/fallback behavior; no ASOS data is invented as grid observations. Recording legacy responses does not prove current production deployment parity or server2 port parity.

## Security and scope

Use synthetic tokens/keys only. No secret environment lookup, host account mutation or network access outside registered loopback capture. Explicitly reject live-mode environment toggles. Limits bound response bytes, per-case duration and process wall time. The canonical named recorder orchestration is an authorized test exception with manual review, not proof that static placement analysis understands arbitrary computed paths. Original legacy tests/fixtures stay in place. S03 owns common architecture/diagram; this verification-only change does not alter service topology, so no separate architecture diagram is required.

## Interfaces and observable outcomes

Owned CLI: verify exact declaration, run record twice, compare against baseline; an explicit record command writes a requested directory without silently updating committed goldens. Tests mutate bytes/source/inventory to prove rejection. Independent golden CI job invokes owned entrypoint alongside unchanged Rust/foundation checks. No invocation starts collectors or production stores. Operator manual records actual commands, expected success/error and baseline update procedure requiring review.

## Placement integration extension

Declaration extension6017136605 adds exact checker/test paths under exclusive root-serialized S02 ownership. The shared workflow retains the existing foundation job and adds only the exact golden entrypoint with pinned Node16.20.2/Python3.11 setup and30min timeout. Unknown actions, deployment/upload/extra shell steps, secret-dependent env and changed foundation steps are rejected.

Only cases[*].handler identities in exact server2/tests/golden/records.json are inert provenance roles after schema/type, exact known handler allowlist and source-hash membership validation. Other JSON values still undergo resource scanning. Runtime config/executable accesses are not exempt. Old full-Git fixtures prove existing false rejections; negatives cover unknown handler, invalid schema/type, outside runtime config and unknown workflow action. Existing compiler/resource and29 placement controls remain. Actual legacy source reads happen only in the named recorder; the owned consumer verifies hashes returned in immutable records and oracle/lock identity, without reading or importing legacy modules.
