# S02 implementation plan

Authority/scope: [declaration6016577542](https://github.com/WizardFactory/TodayWeather/issues/2687#issuecomment-6016577542), issue2687, root delegation. Endpoint: independently reviewed unmerged PR. Base f568508da68d408a282752f55614407899631c88; not stacked on S03/S05. Shared ci.py remains unchanged.

1. Freeze inventory and executable contract tests first. Prove intended rejection before the recorder exists; retain setup failures separately.
2. Implement named isolated legacy recorder: real domestic old/new routes and world pipeline, real gateway/geocoder with scripted providers, nation composition, warning controller and push route/controllers with fixed store outcomes. Preserve existing handler code; adapt only test harness orchestration.
3. Generate baseline from actual execution, inspect traces, then run twice in separate processes. Add regression mutations for raw bytes, inventory/provenance and network rejection. Refactor only with tests green.
4. Run a distinct offline end-to-end CLI smoke into a fresh directory. Run placement/artifact/Rust/foundation checks and additive golden CI. Capture CLI usage and regenerate editable/PDF manual with visual QA.
5. Stage/outgoing checks, commit/push/create PR, exact-head CI and independent Claude review dispatched by root. Apply selected findings; finish readiness with merge disabled.

Files: server2/tools/golden/, server2/tests/golden/, server2/config/tasks/S02.json; exactly named legacy recorder; owned intent/spec/plan/manual/evidence paths; additive shared workflow wiring only. No common server2 architecture or parent plan changes.

## User scenarios / tests

| User and goal | Prerequisites and actions | Expected result / failure | Criteria |
| --- | --- | --- | --- |
| Port developer needs an oracle | Pinned Node deps; run verification CLI; inspect inventory and real middleware traces | Two recordings and baseline byte-identical; missing backend coverage fails | AC1/AC2 |
| Reviewer checks an error-only API | Fixed dependency failure; record v705 push and v901 nation | Actual failure status/body/header captured; no fabricated success | AC1/AC2 |
| App caller revalidates weather | Fixed response; send If-None-Match from actual ETag | Actual Express304/empty body and header contract | AC2 |
| Developer checks history/locale/POP/warnings | Execute edge fixture cases through real controller chain | Deterministic legacy behavior, missing history stays missing/fallback | AC2 |
| Operator runs without credentials | Isolated temp installation; execute offline smoke; try prohibited external socket/live mode | Local record succeeds; forbidden access fails before IO | AC2/AC3 |
| Maintainer updates baseline | Explicit output directory, source/dependency map, compare diff and independent review | No implicit committed fixture overwrite | AC3 |

Riskiest part: recording a stub instead of actual assembly, or omitting unstable fields silently. Prove with actual route/controller provenance and full response bytes/headers. Rejected alternative: app startup or live Mongo/provider integration would trigger collection and cannot provide stable offline goldens. Blast radius is test tooling and CI only. Rollback removes additive golden tooling/job while preserving foundation and legacy runtime. Deployment/source drift and later-added notice/web/ww inventory remain explicit downstream cutover gates.

Placement extension: exact server2/tools/check_placement.py and server2/tools/test_placement.py are exclusively assigned to S02 by root. Preserve old checker bytes from pinned f568508d and run full-Git workflow/provenance-role positives as intended Red, then run positives and unknown-action/unknown-handler/schema/type/outside-config negatives with the new checker. Shared tools/ci.py is still untouched. Compare returned legacy source hash maps with baseline rather than reading legacy from the consumer.

## Review correction round1

Apply R1–R4 and R6–R10: first assert old candidate's missing app query/locale, realistic nation500 and genuine old-row gap, then implement real loopback transport, wire revalidation/error/locales, legacy dependency pins, guarded output/IO and readable manual. Preserve original actual review and histories. R5 is unselected because widening legacy-only triggers changes the foundation task-declaration contract; no shared ci.py or event change. Run fresh full golden CI and distinct recording/socket smoke, preserve foundation checks, regenerate and inspect every manual page. Publish new exact candidate and reserve review2 before root rereview. Do not close issues or merge.
