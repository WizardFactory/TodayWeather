# E3b warning delivery polling verification

2026-10-19 integration note: the dated results and source/binary hashes below
retain their original execution identities. Statements about an unmerged or
parallel parent describe that original verification point. The integrated source
now includes C1/B1 and the preceding ordered fixes. Current source-bound checks
require explicit dev and release package rebuilds, separate owned smoke, independent
review and exact CI/tree reconciliation. The final [PR2835 integration record](https://github.com/WizardFactory/TodayWeather/pull/2835)
binds those actual results; this note does not relabel historical checks or
qualify production, a full recovery bundle, shadow or issue closure.

Scope: [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819), warning delivery
supervisor scheduling only. Parent is unmerged E3a PR2834 at `cad27de8`; parent review/CI
are separate gates, not this candidate's review. [Spec](../../../../specs/issue-2819-warning-poll-supervision.md).
Pre-merge only; no merge/cloud/deploy/live provider/device/shadow/production authority.

The actual warning JoinSet task ID replaces the bool gate. Matching normal/failed joins
release only that slot. The original panic remains incomplete; the next regular poll may
run. Minute guards, interval/Skip, stop/drain, writer, durable claim/result and send policies
remain. No new owner, monitor, mode or public endpoint. C5 acquisition is separate.

Before production edits, unchanged runtime had one intended warning-panic dead-gate failure
and one ordinary-error control pass. The original test/source/executable/log is retained.
Focused Green passed2; the final focused tests passed3. Two additional-control attempts
failed due to a timer-stalling synchronous test fault and an oracle that counted a normal
pending tick as a duplicate. Their source/bin/logs remain NOTPASS; the corrected test uses
a bounded blocking boundary and quiesces before release. No production change was made
to satisfy those incorrect test assumptions.

Current full targets: state20passed/1ignored, delivery95passed, runtime44passed/3ignored,
library134passed: **293 passed / 4 ignored**. Fmt-check, all-target Clippy with `-D warnings`,
optimized main and runtime-test builds pass. Two earlier whole-runtime invocations each
had43passed/1failed/3ignored on distinct C5 `provider_listener_closed=false` observations;
the original abort/port-check logs are retained, not relabelled. The exact HeldStop case
passed in isolation. The owned test provider now gracefully stops and must successfully
join before its unchanged closed-port assertion; the C5 five-case parallel check and full
runtime target then passed. The original intermittent cause is not conclusively established,
and no production provider-ownership defect or host readiness is claimed.

Additional retained optimized test CLI: real scheduled recovery in
**5.004s**, 2 warning clock entries,
original failure retained in drain, public push-handler HTTP200 with one acknowledged
registration, durable sequence1 and journal1 present through actual owned HTTP S3.
Delivery diagnostic events were0. Both API/S3 ports were closed in the child and independently
rechecked by root after exit. Only PATH/LANG/TMPDIR were inherited; synthetic fixtures and
closed-loopback provider endpoints were constructed. The HTTP listener is a thin test
adapter, not production main/full gateway. Input/source/executable hashes stayed unchanged.
The optimized main was built, not executed; compile-time checkout/Python/assets are required,
so this is not a portable eligible recovery bundle or production/API-inventory qualification.

The format setup command once omitted its explicit toolchain environment, triggered a
missing default toolchain auto-install, then failed without cargo-fmt. No product check ran.
That setup log is retained separately. All verification commands use the existing private
Cargo/Rustup/target directories; default/user toolchains were preserved, with no global
settings change or deletion. One later correction script syntax error occurred before
execution and is not test evidence.

Maintained operator/architecture/native-verification documents are updated. This is an
existing behavior fix with no new API/UI or PDF. Final implemented-source diagram, exact
candidate mapping, independent review and current CI are required before pre-merge and
must be recorded separately. Full E3 readiness endpoint/S3/credential-source health, other
#2819 defects, #2704/#2705, main integration, shadow and production remain open.
