# C5 warning acquisition verification

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

Five full scoped targets yield **461 passed / 3 ignored**: library131,
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
whole log and bounded serial result remain separate. Current runtime helper checks
were renewed after adding the recurrence fixture. Its final unused-in-test-target
lint annotation changes no helper body; this exact difference and unaffected target
dependency projections are retained. No whole default-parallel PASS is claimed.

Actual `fmt --check`, all-target Clippy with `-D warnings` and the optimized example
build pass. One earlier Clippy invocation failed on the standalone-only recurrence
helper's dead-code lint; the precise annotation and original failure are preserved.
The earlier bind-failure harness also failed waiting for a success hook that is
never called in that case. It now joins the existing failed-bind stop path; no
production deadline changed. Neither setup/control failure is a new behavior Red.
The existing OS-process TERM matrix runs all nine cases successfully on the current
retained runtime test binary. INT/listener variants remain the later exact CI gate.

## Separate optimized owned-process execution

The selected four-case optimized run uses729 unchanged repository inputs before
and after execution; executable SHA-256:
`a522f325f63e0f0beff028a6e48714493c555c2512246770388a808cc06398fb`.
Report SHA-256: `fbb5cb07d1518b93c0998309748b90d8c4ce0ec2acf0125c7ee468dc795e8cc0`.
The earlier three-case optimized run is retained separately, with its original
executable and source map; it is not relabelled as the current four-case run.

| Case | Owned provider calls after bind | New native pwn-cd PUTs | Feed events | Observation |
| --- | ---: | ---: | ---: | --- |
| No product HTTP | 14 | 10 | 1 | Post-bind acquisition |
| Four same-source joins | 14 | 10 | 1 | 3001ms wait; no extra provider cycle |
| Stop with held provider | 14 | 10 | 1 | Process waits; existing publication completes during grace |
| Normal recurrence | 28 | 20 | 2 | 179844ms between observed publications |

Normal recurrence uses the actual production180-second memo, no shortened
integration interval or mode. It observes a third synthetic provider revision
without product HTTP or another direct collector call. It does not measure a full
wake-jitter distribution or600-second wall-clock expiry. Private protocols use
short real-time tracking bounds separately.

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
