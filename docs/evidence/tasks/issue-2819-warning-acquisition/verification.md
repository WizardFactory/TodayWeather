# C5 warning acquisition verification

2026-10-19 integration note: the dated results and source/binary hashes below
retain their original execution identities. Statements about an unmerged or
parallel parent describe that original verification point. The integrated source
now includes C1/B1 and the preceding ordered fixes. Current source-bound checks
require explicit dev and release package rebuilds, separate owned smoke, independent
review and exact CI/tree reconciliation. The final [PR2829 integration record](https://github.com/WizardFactory/TodayWeather/pull/2829)
binds those actual results; this note does not relabel historical checks or
qualify production, a full recovery bundle, shadow or issue closure.

Base: C4 `d0c268a4daad39e41aa924567649f8211773838f`, still unmerged.
[Requirements](../../../../specs/issue-2819-warning-acquisition.md) and
[operator procedure](../../../operations/server2-native-verification.md#warning-acquisition-without-product-http).
This is scoped local preparation. Independent current C5 review and exact CI still
gate readiness; no main integration, full recovery bundle or production claim.

## Source and lifecycle

Push starts the shared-source driver after both binds. Construction and HTTP-only
KMA do not start it. Requests retain their three-second wait; the existing source
pool, 180-second Attempts memo, collector step deadlines and 600-second outer
tracking remain. The actual inner task stays owned/cancellable after outer tracking
expiry. A lease covers unpolled work and panic. Close precedes HTTP drain after
FCM/delivery quiesce; process timeout and guard destruction request inner abort.
HTTP-only retains five seconds, push retains34 seconds. A completion signal means
collector-future destruction, not successful publication or a synchronous task join.
Incomplete warning drain makes the overall outcome Unknown without changing the
three existing joined-field meanings. No public cache-generation fence is added.

## Actual method and scoped regressions

The unchanged parent runtime plus a new public test observed zero provider calls
and zero new feed events without product HTTP (exit101, intended assertion).
Process stop/join and owned provider cleanup preceded that assertion. The fixture
first persisted a quiet durable feed baseline; the old `native_source_put` field
included baseline writes and was not proof of a new collection. Current checks
separately count new writes. Initial feed/delivery silence is unchanged.

Five full scoped targets yield **464 passed / 3 ignored**: library134,
runtime_services36/1, delivery95, warnings31 and domestic168/2. Focused checks are
not added again. Private protocols exercise cancellation before wrapper/inner first
poll, close/admission races, constructor/async panic, provider destruction before
completion, actual generic-flight expiry with a still-cancellable inner, dropped
process guard and cancelled drain futures. The real HTTP-only process keeps its
five-second budget and reports incomplete warning drain. The direct source/join
cases are distinct from actual public HTTP route-parity evidence.

The initial full domestic invocation remains **NOT_PASS:150 passed,18 failed,
2 ignored**. Many errors occur while publishing fixture data before source
construction. The unchanged raw key-rotation test passes alone. The identical
retained binary passes the entire serial target168/2 in306.28s, without source,
assertion, production-timeout or admission changes. This demonstrates execution
sensitivity; a particular peer/resource root cause is not established. The original
whole log and bounded serial result remain separate. Current runtime helper checks were renewed for the explicit scenario enum, and the
library target was renewed for three added direct scheduling/fallback protocols.
Delivery/warnings/domestic test and production bodies are unchanged; the only
production-source difference is three builder-ordering comment lines. Reuse and
compiled dependency projections are explicit. No whole default-parallel PASS is claimed.

Actual `fmt --check`, all-target Clippy with `-D warnings` and the optimized example
build pass. One earlier Clippy invocation failed on the standalone-only recurrence
helper's dead-code lint; its original failure/annotation history is preserved.
The later scenario-enum interface removes that standalone-only wrapper and annotation.
The earlier bind-failure harness also failed waiting for a success hook that is
never called in that case. It now joins the existing failed-bind stop path; no
production deadline changed. Neither setup/control failure is a new behavior Red.
The existing OS-process TERM matrix runs all nine cases successfully on the current
retained runtime test binary. INT/listener variants remain the later exact CI gate.

## Separate optimized owned-process execution

The selected four-case optimized run uses729 unchanged repository inputs before
and after execution; executable SHA-256:
`48ee14040f4797ab1b8274b45c0264434eb17bf8623f94113a7e63807a1e9c06`.
Report SHA-256: `9e4dfca9370666a9412455269a05dc25bc6fe6060dc8e9b30139492853427053`.
The earlier three-case optimized run is retained separately, with its original
executable and source map; it is not relabelled as the current four-case run.

| Case | Owned provider calls after bind | New native pwn-cd PUTs | Feed events | Observation |
| --- | ---: | ---: | ---: | --- |
| No product HTTP | 14 | 10 | 1 | Post-bind acquisition |
| Four same-source joins | 14 | 10 | 1 | 3002ms wait; no extra provider cycle |
| Stop with held provider | 14 | 10 | 1 | Process waits; existing publication completes during grace |
| Normal recurrence | 28 | 20 | 2 | 179916ms between observed publications |

Normal recurrence uses the actual production180-second memo, no shortened
integration interval or mode. It observes a third synthetic provider revision
without product HTTP or another direct collector call. It does not measure a full
wake-jitter distribution or600-second wall-clock expiry. Private protocols use
short real-time tracking bounds separately.

Selected independent review recommendations add three direct real-Tokio checks:
a request-owned short private memo anchors the actual driver wake, a Busy shared
pool waits three seconds without claiming Attempts or calling the provider, and a
retained outcome waits three seconds without reclaiming an expired memo. The
period injection is private to those unit tests; production stays180 seconds. The
fixture now uses one mutually exclusive case enum. Builder ordering and the
retained drain-diagnosis/initial-baseline loss limits are documented. No production
behavior or public mode changes in this review follow-up.

Every case explicitly declares its prior quiet baseline and empty registrations;
all provider/FCM dependencies are owned or closed loopback endpoints. Zero live
sends follows that isolation, not a separately measured device counter. The
executable exits0, all eight public/private product listeners are closed after exit,
and each owned provider/storage peer is retired. Its compile-time checkout/Python
assets must remain available; it is not a portable eligible server release bundle.

The checked [proposed flow](../../../architecture/diagrams/server2-warning-acquisition.html)
and [JSON](../../../architecture/diagrams/server2-warning-acquisition.sequence.json)
remain unchanged. Actual main light1440/dark2048 views were inspected; off-screen
card bodies were source-checked only. No new render or production execution is
claimed. C6, remaining #2819 findings, #2704/#2705, real quotas, EC2, full rollback
eligibility and seven-day shadow remain open. C1/B1 are separate branches.
