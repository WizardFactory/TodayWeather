# Structured diagnostics — selected verification

Base: `2ded7c9a9c007a1709336b22a4605cd7174e6f98`. macOS arm64, Rust1.99.0 release, process-scoped build settings. Executions used the dirty pre-commit source; final content/commit mapping is retained in the build/review record. No production/provider/device action was performed. Logging task #2802 precedes the remaining #2704 earlier-release recovery work. #2724 measurements are excluded.

## Actual isolated executions

| Evidence | Result and limit |
| --- | --- |
| Release HTTP / diagnostic example | PASS; actual HTTP200/404, loopback503/403/429, async/blocking context, shared-owner link, cancellation/unknown helper probes and private panic suppression. Helper drop is not an observed external send. |
| Result write refusal / unknown | PASS on two separate actual process faults; one accepted owned post each, one retained claim, no committed result, correct failed/unknown and warning-cycle identity; no process-root retained-claim summary. |
| Two alarms in one minute | PASS; exactly two owned FCM posts, two anonymous submissions, one unchanged batch claim, result count2, delivery_kind alarm; zero device sends. |
| One-operation incident query | PASS; selected alarm send plus ancestor/shared batch result retained, sibling send excluded. 32 records, local query 0.0319s; no production latency guarantee. |
| Ambiguous journal write | PASS; first original write lost, existing void1, next acknowledged update1, notifications0. HTTP-to-writer parent verified. HTTP200 alone does not imply committed mutation. |
| Blocked stderr | 600 HTTP requests complete; queue-full 576; independent loss metrics remain readable. Stop 0.0015s in this run, not a universal stop-time guarantee. |
| Final affected Rust targets | delivery60, runtime-services22 (one existing child entrypoint ignored), context3 and bounded logger core3 PASS; final all-target Clippy and formatting PASS. |
| Complete target inventory | 24 integration targets, 793 passed and 3 existing ignored entries across intended profiles. Unchanged target behavior reuses build1; changed delivery/runtime/context targets renewed in build3. Default lib93, feasibility20 and doc1 also passed in build1. |
| All-family runner | Fresh final-artifact 11/11 PASS, including KMA core220/rich92, summary27/10, state18, workers27. Each check retains its own layer. World coexistence uses a frozen legacy double; this is not legacy-free whole-service recovery. |
| Local stack launcher | Actual previous failure reproduced: merged stderr was misread as stdout readiness. Separate streams preserve the protocol; peer/atomic-ready controls, real wire smoke and eight first-visible-ready/stop observations PASS. Earlier outside-owned-binary attempt was setup only. |
| Existing protocol/process smoke | PASS; readiness, public/metrics separation, 128 socket admission/recovery, 9-second header lifetime, SIGTERM/drain behavior preserved. |
| Operator tooling | Three diagnosis controls PASS; 14 suite,31 shadow,10 recovery controls passed separately. |
| Placement / documentation | Placement PASS; six PDF pages inspected, diagram artifact/browser/visual checks PASS. Staged/outgoing retention and independent PR review are separate subsequent gates. |

The large domestic target uses the existing owned catalog peer persistent profile to avoid observed macOS ephemeral-address exhaustion. All other targets ran on the default profile, including the explicit HTTP/1.0 compatibility check. An early PUT-failure framing defect in the persistent fixture had an intended Red, then both profiles passed; product retry/status assertions were unchanged. Failed whole invocations remain FAIL, not silently reclassified as a whole-suite pass.

## Identity and reproducibility

Actual invocation: `python3 server2/tools/logging_smoke.py --binary <retained server2> --probe <retained logging_smoke> --runtime-services <retained runtime_services> --out <new directory>`. The reusable tool checks executable hashes before and after. The operator [guide](../../../operations/server2-logging.md) gives local trace/operation queries and safe next actions.

| Artifact | SHA-256 |
| --- | --- |
| server2 release | `53e88a4915f38649a916287f28cba59f59d8482c449241d088210997f9e86bde` |
| logging probe | `e3ebb68cc13d587d745218660205903bf32a6f9c99ba453cefc1a728869e44fe` |
| runtime-services release test executable | `1fb9c927aa6e4de3dba03187b4f4afb411c4d0a1e7f93f363d612195444419f2` |
| logging functional report | `6cbad182b34faba5828de1f915bcca24ad80d1cd87b3bd7528588948aea3eebc` |
| final all-family report | `0c20c1624b041ec409331d94ce1c52a0df76749c450d7fe7b22fa4532d13b167` |
| normalized two-item log | `908153dc42dbe1d067994b84060f1e2199ebdd41d0f76b2780b17614489b23c3` |
| normalized void log | `dcd4effc49fffbbdb4c53077bf1658551037f1b24808970bc9808dfbb2edf150` |
| selected operation output | `58cb230849f6eda1695a702ff0351ccdc85f41d6eb15e3ba3076c0d061153f4e` |

[Selected diagnostics](diagnosis.png) and [actual transaction diagnosis](transactions.png) are formatted selected fields from actual local captures, not raw terminal screenshots. Full generated runs remain ignored; these maintained captures and this summary survive a clean checkout. The [PDF](../../../operations/server2-logging.pdf) has editable [Markdown](../../../operations/server2-logging.md).

## Review correction LOG-GROK-001

The two old-binary result-write Reds each reached one actual owned FCM acceptance before failing the contradictory skipped summary. Final build3 reports refusal as failed and readback-unavailable as unknown. Both retain one claim, commit no result, emit no contradictory skipped summary and no fabricated process-root claim retention. Typed ledger/poll/panic/drop records remain authoritative; custom diagnostic callbacks and delivery behavior are unchanged. Two earlier unknown-fixture attempts could only establish refusal/readback absence; those setup/oracle mismatches are not intended Red. The default-sandbox build3 delivery attempt could not bind loopback; the approved retry passed60 delivery/22runtime. Original failures are retained.

## Failure history and scope

The initial old-binary HTTP Red reached HTTP200/404 then failed the absent structured terminal assertion. A setup-only attempt is separate. Build1 was blocked by missing anonymous item scopes despite passing product regressions. The intended two-send Red established two actual accepted owned posts before failing only the missing scopes; an earlier wrong weather-fixture setup is not Red. Operation-query Red failed only sibling exclusion. Green and post-refactor checks followed; current functional proof uses final executable hashes. A later default sandbox invocation could not bind loopback and is retained as failed setup; allowed loopback executions above are distinct.

No collector, host rotation, production retention, deployment, quota measurement, device delivery, whole-service previous-release recovery or live shadow is attested. Accepted FCM is not delivered. Unknown durable/send outcomes remain uncertain; logging never authorizes replay. Runtime teardown does not verify detached provider completion. Missing events and nonzero drop metrics limit reconstruction.
