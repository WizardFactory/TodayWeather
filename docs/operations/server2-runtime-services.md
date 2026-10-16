# Server2 runtime services

S20a connects selected native serving APIs and shared services. It does not start delivery schedules, send notifications or activate production. S20b owns delivery supervision and durable stop behavior; #2705 retains production activation gates.

## Selection and startup

Use ordinary `SERVER2_NATIVE_FAMILIES` entries `push` and `notice` beside existing weather/geocode entries. Native-only selection requires no `SERVER2_GATEWAY_LEGACY_URL`. When supplied explicitly, that URL remains available for unselected gateway families only. Selected native errors terminate locally. An empty selection with no legacy URL keeps the foundation health service.

Configured services reuse one bounded S3 transport and its credential cache/pool. Supply `SERVER2_S3_BUCKET`, `SERVER2_S3_REGION` and the existing AWS credential names or instance role as documented in the storage configuration. This manual contains no credential values. No FCM account is required for S20a. The read-only notice service never constructs Translator/OpenAI; publication remains the separate notice CLI.

Push selection constructs its native KMA, DSF and geocoder dependencies even when public weather routes are unselected. Existing weather/provider key requirements still apply. NativeFetch uses fixed logical origin `http://server2.internal` only as an input to existing URL builders; dispatch is in process. `SERVICE_SERVER` and `API_SERVER` do not select its destination. Unsupported origins, versions and routes fail without HTTP or legacy fallback.

Native selection uses the existing 12-second connection lifetime, above the 9-second gateway/registration wait. HTTP listener drain remains bounded to five seconds; it does not guarantee every acquisition/writer task has drained. No delivery or scheduler task is started in this increment.

## Registration and recovery

With the service configured and running, submit the existing registration API (`POST /v000705/push`, `PUT`/`DELETE /v000902/push`, `POST /v000902/push-list`). Preserve the client's existing payloads and language headers. Success follows durable journal publication. Existing method, body-size, parse-error, CORS and response-header behavior is unchanged.

To verify recovery in an isolated environment, register a synthetic token against an owned S3 peer, stop the task-owned listener, reconstruct services over the same peer, and inspect the restored registration. Do not substitute a health response for this durability check. Cold or unavailable storage answers the route's existing storage-error response.

## Read a notice

`GET /v000903/notice/latest` returns `{"notice":null}` when no object/publication exists. An active notice uses explicit `lang` before `Accept-Language` and the existing language fallback. GET/HEAD retain `Cache-Control: public, max-age=300` and `Vary: Accept-Language`. An unreadable/corrupt cold store returns 503 with `Cache-Control: no-store`; it must not masquerade as no notice. POST is not a publishing API.

The notice CLI publishes and withdraws records separately. Reading a notice does not translate it or contact a paid model.

## Warning publication and limits

KMA request-driven acquisition shares WarningStore with the read service and installs the persisted WarningFeed hook before wrapping the collector in Arc. The collector publishes zone storage first, then the feed. Failed storage does not create a successful feed event; feed failure retains existing retry/restart behavior. Construction performs no precollection or periodic gather. Delivery remains disabled.

Rollback removes the selected entry and restarts; coexistence requires an explicit legacy URL. This is not a deployment procedure. Live credentials, provider quota, native inventory, supervised delivery stop, cutover and production measurements remain separately authorized work.

## Verification

The maintained [verification record](../evidence/tasks/issue-2705-s20a/verification.md) identifies the exact candidate, actual HTTP scenario capture, tests and limitations. The [design](../architecture/diagrams/server2-runtime-services.html) distinguishes shared ownership and lifecycle boundaries. The actual process smoke registered and updated a synthetic token, restarted the process, and updated the restored token successfully. It also checked notice null/HEAD/read-only, health/private metrics and unselected weather 404. Both SIGTERM stops exited 0 in 0.002s; this demonstrates the exercised HTTP stop only.

![Actual isolated process HTTP calls and responses](../evidence/tasks/issue-2705-s20a/runtime-smoke.png)

The capture shows actual output from the loopback process using the production constructor. S20a focused 14 tests, related regression suites and all-target Clippy passed locally. Current CI and independent review are separate readiness gates. The PDF uses ReportLab and was rendered with PyMuPDF because Poppler is absent.
