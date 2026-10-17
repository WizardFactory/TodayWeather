# Structured diagnostics — selected verification

Base: `2ded7c9a9c007a1709336b22a4605cd7174e6f98`. macOS arm64, Rust1.99.0 release, process-scoped build settings. Executions used the dirty pre-commit source; final content/commit mapping is retained in the build/review record. No production/provider/device action was performed. Logging task #2802 precedes the remaining #2704 earlier-release recovery work. #2724 measurements are excluded.

## Actual isolated executions

| Evidence | Result and limit |
| --- | --- |
| Release HTTP / diagnostic example | PASS; actual HTTP200/404, loopback503/403/429, async/blocking context, shared-owner link, cancellation/unknown helper probes and private panic suppression. Helper drop is not an observed external send. |
| Two alarms in one minute | PASS; exactly two owned FCM posts, two anonymous submissions, one unchanged batch claim, result count2, delivery_kind alarm; zero device sends. |
| One-operation incident query | PASS; selected alarm send plus ancestor/shared batch result retained, sibling send excluded. 32 records, local query 0.0301s; no production latency guarantee. |
| Ambiguous journal write | PASS; first original write lost, existing void1, next acknowledged update1, notifications0. HTTP-to-writer parent verified. HTTP200 alone does not imply committed mutation. |
| Blocked stderr | 600 HTTP requests complete; queue-full 576; independent loss metrics remain readable. Stop 0.0016s in this run, not a universal stop-time guarantee. |
| Final affected Rust targets | delivery60, runtime-services22 (one existing child entrypoint ignored), context3 and bounded logger core3 PASS; final all-target Clippy and formatting PASS. |
| Complete target inventory | 24 integration targets, 793 passed and 3 existing ignored entries across intended profiles. Unchanged target behavior reuses build1; changed delivery/runtime/context targets renewed in build2. Default lib93, feasibility20 and doc1 also passed in build1. |
| All-family runner | Fresh final-artifact 11/11 PASS, including KMA core220/rich92, summary27/10, state18, workers27. Each check retains its own layer. World coexistence uses a frozen legacy double; this is not legacy-free whole-service recovery. |
| Existing protocol/process smoke | PASS; readiness, public/metrics separation, 128 socket admission/recovery, 9-second header lifetime, SIGTERM/drain behavior preserved. |
| Operator tooling | Three diagnosis controls PASS; 14 suite,31 shadow,10 recovery controls passed separately. |
| Placement / documentation | Placement PASS; six PDF pages inspected, diagram artifact/browser/visual checks PASS. Staged/outgoing retention and independent PR review are separate subsequent gates. |

The large domestic target uses the existing owned catalog peer persistent profile to avoid observed macOS ephemeral-address exhaustion. All other targets ran on the default profile, including the explicit HTTP/1.0 compatibility check. An early PUT-failure framing defect in the persistent fixture had an intended Red, then both profiles passed; product retry/status assertions were unchanged. Failed whole invocations remain FAIL, not silently reclassified as a whole-suite pass.

## Identity and reproducibility

Actual invocation: `python3 server2/tools/logging_smoke.py --binary <retained server2> --probe <retained logging_smoke> --runtime-services <retained runtime_services> --out <new directory>`. The reusable tool checks executable hashes before and after. The operator [guide](../../../operations/server2-logging.md) gives local trace/operation queries and safe next actions.

| Artifact | SHA-256 |
| --- | --- |
| server2 release | `659f3f99de0d8d44202da2950107c6c395e65f00ad4b6091fb625d214b696b96` |
| logging probe | `9d6c34f793fe0b477ced71dd815b47e5572b5020d2e94477824e628e829fff6d` |
| runtime-services release test executable | `3ea0363783cc13a5d8084b3f014c31eba486892d82b2951f861f363283aa1fe6` |
| logging functional report | `3a96cac1c92a09a175dd92e1b74e88cafcaeb3ba076c7235e0a5bac62e004d15` |
| final all-family report | `0288667a49b7ec123c47a12580d8d194b528b5a686999ebe28fff6002ab1dadb` |
| normalized two-item log | `4d274fe21c858d9b0de610fcb7010cdbaa2c153c809711785f82ca6327850d74` |
| normalized void log | `a41ae0d0019a62b2c210f2b0c8ffa7baab34f1654a4eddf2d3356759c06ebc08` |
| selected operation output | `02d741a6bf76190b176f2a86fc5e9d392c306b66fc3f4489e86d1d0e7496914e` |

[Selected diagnostics](diagnosis.png) and [actual transaction diagnosis](transactions.png) are formatted selected fields from actual local captures, not raw terminal screenshots. Full generated runs remain ignored; these maintained captures and this summary survive a clean checkout. The [PDF](../../../operations/server2-logging.pdf) has editable [Markdown](../../../operations/server2-logging.md).

## Failure history and scope

The initial old-binary HTTP Red reached HTTP200/404 then failed the absent structured terminal assertion. A setup-only attempt is separate. Build1 was blocked by missing anonymous item scopes despite passing product regressions. The intended two-send Red established two actual accepted owned posts before failing only the missing scopes; an earlier wrong weather-fixture setup is not Red. Operation-query Red failed only sibling exclusion. Green and post-refactor checks followed; current functional proof uses final executable hashes. A later default sandbox invocation could not bind loopback and is retained as failed setup; allowed loopback executions above are distinct.

No collector, host rotation, production retention, deployment, quota measurement, device delivery, whole-service previous-release recovery or live shadow is attested. Accepted FCM is not delivered. Unknown durable/send outcomes remain uncertain; logging never authorizes replay. Runtime teardown does not verify detached provider completion. Missing events and nonzero drop metrics limit reconstruction.
