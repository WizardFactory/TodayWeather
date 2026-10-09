# Plan: document and later implement server2

Source: [intent](../intent/issue-2614.md), [spec](../specs/issue-2614.md).
Current status: design PR #2685, foundation PR #2708 and S02/S03/S05 PRs
#2713/#2711/#2712 are merged. S06 [PR #2719](https://github.com/WizardFactory/TodayWeather/pull/2719)
is merged at master `94019cf5`; S07 cache/resolver and S08 provider budgets
proceed in parallel isolated tasks from that revision under AK's 2026-10-08
authorization. Their implementation endpoints remain reviewed pre-merge PRs.
No production/resource actions or route cutover are authorized by that work.
S08 rejection tests must preserve received HTTP status even when a bounded body
cannot be accepted: quota/auth rotate only to funded distinct keys, other 4xx
terminate, and incomplete bodies never enter the weather archive.

## This PR

1. Read #2614 and its amendments, inspect current source entrypoints, and reconcile
   the accepted [traffic baseline](../docs/evidence/aws/api-traffic-2026-09-22.md).
2. Maintain `docs/architecture/server2.md`, its Archify JSON/HTML and index link;
   retain intent/spec/plan and selected verification evidence.
3. Check source claims, route counts, arithmetic, links and diagram artifact,
   browser and visuals separately. Run staged and outgoing artifact-policy checks.
4. Commit/push this branch, create PR linked to #2614, obtain independent review,
   resolve selected findings and report the actual PR/CI state. No merge action.

Generated stage receipts, notebook, screenshots and browser receipts remain in
ignored reports/.planning/.archify; maintained evidence links only to tracked
inputs. The initial design PR added no runtime or CI changes. The follow-up adds task
placement instructions and issue decomposition; no runtime/checker is introduced.

## Common contract for every implementation task

AK authorized publishing the proposed S01–S21 tasks and optional raw-pack task
on 2026-10-06. Their tracker links are recorded below.
Each published issue body includes the following required
change and completion criterion, rather than relying only on a parent link:

> **Required change:** Place all new server-equivalent implementation and
> supporting assets under `server2/`, including runtime, configuration/static
> data, build/dependencies, tests/fixtures, tooling, migration and deployment.
> Declare this task's intended paths and enumerate any outside-path changes with
> their reason before implementation. Follow the architecture placement contract
> and root `AGENTS.md`; add no server2 business logic to legacy or shared paths.
>
> **Completion criterion:** Every added, modified and renamed path conforms to
> the declaration; outside changes are limited to the declared documentation,
> shared wiring, legacy verification/export/coexistence or authorized retirement
> work. No new runtime dependency, include or symlink reaches legacy source/data
> outside `server2/`. The placement gate passes, or a recorded manual review is
> supplied for tasks before that gate exists. Fix unexplained violations before
> marking the task complete.

Task intake must name its `server2/` subdirectories and exact outside paths;
generic exceptions such as "shared scripts" or "legacy support" are insufficient.
New exceptions require a decision before dependent edits. Documentation-only or
infrastructure-only tasks record implementation placement as not applicable and
check their actual changed paths against the declared exceptions.

The integrated Rust foundation task (S04, within P2) owns the first placement gate:

- Keep its checker, tests and server2 path declarations under `server2/`; shared
  `.github/workflows/server2.yml` invokes the checker and Rust commands from there.
- Check the full PR diff, including rename destinations and all outside changes,
  against the task's explicit allowed paths. Review the actual runtime dependency
  and resource layout as well; a changed-file allowlist alone cannot prove that
  a dependency on legacy data was removed.
- Reject new server2 source/resources/build files in legacy, root or shared
  packages, and reject imports/includes/symlinks that escape into legacy runtime
  assets. Exercise allowed documentation/legacy-recorder changes and rejected
  misplaced configuration, fixtures, deployment scripts and escaped assets.
- Later implementation tasks depend on this gate. Reviewer verification includes
  the task declaration, checker result and dependency/resource review. Preserve
  existing CI gates; configuring remote required checks is a separate action.

The initial design change introduced no checker. S04 PR #2708 now supplies
Rust/CI and the local placement gate. The checker supplements human dependency
review and does not establish remote branch protection. Every implementation
task still follows its named dependencies and decisions.

## Task issue index

All 21 required tasks and one conditional optimization were published as native
sub-issues of #2614 on 2026-10-06. Dependency links in each body are authoritative
for execution; runtime work also follows the common S01/S04/S02 gates above.
AK's core S01 decisions are [recorded on the parent](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640).
S01 decision recording is [complete](https://github.com/WizardFactory/TodayWeather/issues/2686#issuecomment-6009248131).
S04 foundation [PR #2708](https://github.com/WizardFactory/TodayWeather/pull/2708)
is merged and #2689 is complete. S02 goldens ([PR #2713](https://github.com/WizardFactory/TodayWeather/pull/2713)),
S03 local infrastructure ([PR #2711](https://github.com/WizardFactory/TodayWeather/pull/2711))
and S05 raw-record storage ([PR #2712](https://github.com/WizardFactory/TodayWeather/pull/2712))
are merged; the [integration record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6031101668)
records the reviewed heads and resulting master tree. S06 is merged; its
[integration record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6046074764)
verifies the reviewed tree and records the next scoped work authorized by AK.
S07 resolver/cache ([PR #2721](https://github.com/WizardFactory/TodayWeather/pull/2721))
and S08 provider reservations ([PR #2720](https://github.com/WizardFactory/TodayWeather/pull/2720))
are merged. The [integration record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6051933388)
verifies final master against the tested combined tree. S09 now prepares reproducible
measurement tooling and the [approved bounded intended-host/S3 run](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6052596161).
The [pre-edit live amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6053018487)
requires reviewed, source-bound one-use tools, aggregate request/byte/version limits,
watchdog and pre-bootstrap metering before resource creation. The
[33-path amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6054300695)
adds placement-check regressions for four exact host-read roles; it does not waive
legacy/sibling boundaries or expand the resource approval. The
[dynamic-I/O clarification](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6055549129)
enumerates manifest/claim/provenance/config/report operations separately from
literal checker exemptions. Failed or uncertain worker evidence must be exported
and retained before rejection and owned cleanup; no failed run may become a PASS or
receive a replacement allocation. The next case must check uncertainty before
seeding. The operator must reserve a 15-minute export/cleanup tail before host or
approval expiry and refuse a worker window below five minutes. The effective
benchmark maximum is 59 minutes 30 seconds, with at most 30 seconds for report
completion inside the reserved tail and at least 14 minutes 30 seconds left for
export/cleanup. The SSM command cap remains 60 minutes. Export remains bounded
best effort. The first approved creation attempt left task-owned infrastructure
but no worker measurement. QA4 found invalid EC2 CLI options; `--count 1` and an
installed-CLI check of the complete launch arguments are required. The metered
2026-10-08T12:40:57Z inventory found no current instance, tagged volume or S3
version, while IAM/profile/security-group resources remained. This does not settle
the historical launch outcome.

AK's [explicit recovery amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6060200508)
permits one reviewed pre-worker recovery using the same state, token, nonce and
owned resources. Preserve the original snapshot, deadlines and all charged usage;
never replace an issued worker allocation. Reserve a new watchdog from remaining
aggregate limits. A unique owned instance suppresses creation; unknown/multiple
matches block it. Current absence permits only one same-token launch, with no
replacement token after an idempotency mismatch. The recovery deadline is bounded
by two hours and the original approval expiry. Cleanup verifies current ownership,
retains S3 versions, and records unresolved evidence separately from live results.

That [one recovery was executed](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6061547104)
on 2026-10-08 at 13:48:27Z. Host creation succeeded, but the operator decoded
already-decoded CLI console text as Base64 and stopped before worker admission.
Automatic cleanup completed at 13:54:50Z; separate AWS readback confirmed the
terminated host, no root volume or IAM/profile/security-group resources, and
the preserved empty S3 bucket. Correct the bounded CLI text boundary and verify
actual CLI response transformation offline. The recovery allowance is used; no
further launch or measurement is authorized by this completed attempt.

Local protocol measurements do not complete S09: actual same-region observations
and O-2/O-5 disposition remain gates for S10 and S13. No route work is released by the merges.
Passing local checks do not imply complete route parity or deployed server2.
S07's geocode AC1 is partial: volatile key/privacy primitives are included;
geocode value caches and exact-label/boundary parity remain S10 acceptance work.
S07 refresh verification must cover same-payload lease reuse, externally pinned
replacement pressure, and TTL expiry during dependency I/O without extending
the operation deadline or returning expired data.

| Task | Tracker | Required predecessors |
| --- | --- | --- |
| S01 | [server2 S01: record remaining decisions and implementation gates](https://github.com/WizardFactory/TodayWeather/issues/2686) | None for preparation |
| S02 | [server2 S02: freeze the used-API inventory and byte parity goldens](https://github.com/WizardFactory/TodayWeather/issues/2687) | [S04](https://github.com/WizardFactory/TodayWeather/issues/2689) |
| S03 | [server2 S03: prepare isolated infrastructure and Spot prerequisites](https://github.com/WizardFactory/TodayWeather/issues/2688) | [S01](https://github.com/WizardFactory/TodayWeather/issues/2686), [S04](https://github.com/WizardFactory/TodayWeather/issues/2689) |
| S04 | [server2 S04: establish the Rust workspace, CI and placement gate](https://github.com/WizardFactory/TodayWeather/issues/2689) | [S01](https://github.com/WizardFactory/TodayWeather/issues/2686) |
| S05 | [server2 S05: implement immutable raw S3 records](https://github.com/WizardFactory/TodayWeather/issues/2690) | [S04](https://github.com/WizardFactory/TodayWeather/issues/2689) |
| S06 | [server2 S06: publish catalogs and recover complete fetch groups](https://github.com/WizardFactory/TodayWeather/issues/2691) | [S05](https://github.com/WizardFactory/TodayWeather/issues/2690) |
| S07 | [server2 S07: implement bounded memory lookup and the resolver](https://github.com/WizardFactory/TodayWeather/issues/2692) | [S06](https://github.com/WizardFactory/TodayWeather/issues/2691) |
| S08 | [server2 S08: enforce provider reservations and rejection rules](https://github.com/WizardFactory/TodayWeather/issues/2693) | [S04](https://github.com/WizardFactory/TodayWeather/issues/2689), [S05](https://github.com/WizardFactory/TodayWeather/issues/2690), [S06](https://github.com/WizardFactory/TodayWeather/issues/2691) |
| S09 | [server2 S09: measure Rust feasibility and cold origin cost](https://github.com/WizardFactory/TodayWeather/issues/2694) | [S02](https://github.com/WizardFactory/TodayWeather/issues/2687), [S03](https://github.com/WizardFactory/TodayWeather/issues/2688), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S08](https://github.com/WizardFactory/TodayWeather/issues/2693) |
| S10 | [server2 S10: port gateway and geocoding with legacy backend switches](https://github.com/WizardFactory/TodayWeather/issues/2695) | [S02](https://github.com/WizardFactory/TodayWeather/issues/2687), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S08](https://github.com/WizardFactory/TodayWeather/issues/2693), [S09](https://github.com/WizardFactory/TodayWeather/issues/2694) |
| S11 | [server2 S11: port world weather and air](https://github.com/WizardFactory/TodayWeather/issues/2696) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695) |
| S12 | [server2 S12: port warning history and latest bulletin recovery](https://github.com/WizardFactory/TodayWeather/issues/2697) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695) |
| S13 | [server2 S13: port domestic provider acquisition and raw formats](https://github.com/WizardFactory/TodayWeather/issues/2698) | [S02](https://github.com/WizardFactory/TodayWeather/issues/2687), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S08](https://github.com/WizardFactory/TodayWeather/issues/2693), [S09](https://github.com/WizardFactory/TodayWeather/issues/2694) |
| S14 | [server2 S14: migrate legacy history and close acquisition gaps](https://github.com/WizardFactory/TodayWeather/issues/2699) | [S01](https://github.com/WizardFactory/TodayWeather/issues/2686), [S13](https://github.com/WizardFactory/TodayWeather/issues/2698) |
| S15 | [server2 S15: port domestic KMA v000903 assembly and Rust checkpoint](https://github.com/WizardFactory/TodayWeather/issues/2700) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695), [S11](https://github.com/WizardFactory/TodayWeather/issues/2696), [S12](https://github.com/WizardFactory/TodayWeather/issues/2697), [S13](https://github.com/WizardFactory/TodayWeather/issues/2698), [S14](https://github.com/WizardFactory/TodayWeather/issues/2699) |
| S16 | [server2 S16: store daily summaries and last-year lookup](https://github.com/WizardFactory/TodayWeather/issues/2701) | [S11](https://github.com/WizardFactory/TodayWeather/issues/2696), [S14](https://github.com/WizardFactory/TodayWeather/issues/2699), [S15](https://github.com/WizardFactory/TodayWeather/issues/2700) |
| S17 | [server2 S17: port used older weather versions, nation and town](https://github.com/WizardFactory/TodayWeather/issues/2702) | [S15](https://github.com/WizardFactory/TodayWeather/issues/2700) |
| S18 | [server2 S18: implement used push and notice state with new registrations](https://github.com/WizardFactory/TodayWeather/issues/2703) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695), [S12](https://github.com/WizardFactory/TodayWeather/issues/2697), [S15](https://github.com/WizardFactory/TodayWeather/issues/2700) |
| S19 | [server2 S19: build integrated smoke, shadow and rollback tooling](https://github.com/WizardFactory/TodayWeather/issues/2704) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695) |
| S20 | [server2 S20: verify and perform approved family cutovers](https://github.com/WizardFactory/TodayWeather/issues/2705) | [S19](https://github.com/WizardFactory/TodayWeather/issues/2704) |
| S21 | [server2 S21: retire legacy and MongoDB after all included families migrate](https://github.com/WizardFactory/TodayWeather/issues/2706) | [S20](https://github.com/WizardFactory/TodayWeather/issues/2705) |
| O01 | [server2 O01: conditionally reduce raw GET fan-out with exact-raw packs](https://github.com/WizardFactory/TodayWeather/issues/2707) | [S06](https://github.com/WizardFactory/TodayWeather/issues/2691), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S09](https://github.com/WizardFactory/TodayWeather/issues/2694) |

Start with S01, then S04 foundation; S02 inventory and S03 infrastructure
planning may start earlier, but their server2 assets wait for S04; storage/resolver/budgets
lead to S09 feasibility and S10 gateway. World, warnings and domestic acquisition
can proceed independently when their listed prerequisites hold. S19 verification
and S20 cutover repeat per ready family; they do not wait for every port before
starting. S20 cannot be completed until every included family is dispositioned;
S21 retirement waits for all included families and scope gaps. O01 is optional
and does not become a cutover dependency unless its measured use requires it.

## Decision gates beyond issue dependencies

Closing S01 or another predecessor does not approve a pending decision. Each
issue body names its decision gates. AK approved the core S3 policy and
demand-limited capture on 2026-10-06. Explicitly deferred family choices continue
to block their named work after S01 closes.

| Decision | Blocked work until recorded |
| --- | --- |
| O-1 / O-11 | S14 history/capture, S15/S17 dependent assembly and affected push weather behavior; no history gaps accepted |
| O-2 | S04 Rust foundation direction, S09 feasibility and S15 time-box checkpoints |
| O-3 | D01–D03 resolved: S18 owns schema/ordering, uses new registrations without legacy migration, and does not automatically retry failed/unknown deliveries; verification and durable acceptance still gate activation |
| O-4 / O-12 | S04/S07 memory-only admission/failure contract; local disk policy superseded |
| O-5 | S05/S06 catalog/raw lifecycle, S08 reservation retention, S09 cost assessment and O01 pack policy |
| O-6 | D04 authorizes memory/S3 caches; S07/S10 select layout/validity and prove exact labels, privacy, quota/deadline behavior |
| O-7 / O-8 | S02 fixture scope, S15/S17 current active behavior; unknown scope stays on legacy until dispositioned |
| O-9 | S05–S08 publication/reservation/outage semantics, S10–S13 affected serving and warning behavior, S18 state acceptance and O01 publication |
| O-10 | S03/S08/S10/S13 separate-key and quota prerequisites |
| O-13 | S16 authorized summary storage only; new API/UI remains excluded |

Ordinary legacy maintenance remains allowed in `server/`. The S02 planned new
legacy recorder is an explicit server2 verification exception; its outputs and
consumer live under `server2/tests/golden/`. S14 exporter and S21 retirement
outside paths are declared placeholders that must be resolved to exact files
and decisions at intake before edits; they are not blanket legacy allowances.

## Later implementation phases

Each route port depends on P1 and recorded issue decisions; one PR per phase.

| Phase | Scope and proof |
| --- | --- |
| P0 | Record remaining issue choices; keys/IAM/bucket/versioning/lifecycle, actual runtime/Spot prerequisites and rollback ownership. No persistent gp3 requirement. Use accepted traffic report; supplement only its scope gaps/new paths before their cutover. |
| P1 | Golden harness for the 19 observed groups and retained internal dependencies; current deployment/source/client contract reconciliation, error/CORS/cache/304/preflight fixtures, #2609/#2620 and acquired-history cases. Freeze clock and raw input; two runs byte-identical. |
| P2 | First establish the `server2/` Rust workspace/CI and placement gate (S04); later implementation tasks depend on it. Then storage/resolver, synchronous publication, memory/single-flight limits; property/crash tests with recorded providers and local S3-compatible peer. Measure actual host build compatibility, S3 tails/throughput, RSS/CPU and cold request fan-out. Raw packs are a measured optional optimization. |
| P2b | Gateway/geocoder with backend switches to legacy, exact validation/errors/cache/deadline and privacy-safe coordinate handling. Whole-gateway shadow and rollback rehearsal. |
| P3/P4 | World providers used by gateway and warning catalogs/restore; no deletion of a backend solely due to unused direct public paths. |
| P5/P6 | Domestic raw JSON, legacy-history export, summaries and v000903 assembly; close O-1/O-11 acquisition gaps and Rust time-box. Active health/air behavior follows current fixtures. |
| P7 | Used older versions, nation and town, including v000705 town; exclude only supported zero-observed public paths. |
| P8 | Used push/state and applicable notice supplement; durable new-state acceptance, send ownership, sanitized failure logs, no automatic resend and new registrations without legacy migration. Do not revive retired purchases. |
| P9 | Retire legacy/Mongo only after every included family and scope gap is dispositioned, parity/shadow/performance/quota gates pass and AK approves cutover. |
| Later scale-out | Independent per-host caches, shared S3, durable global provider admission, fetch/background ownership, concurrent catalog CAS, readiness/drain and bounded S3 warm-up. No shared-cache implementation now. |

## Scenarios and acceptance mapping

| ID / user and goal | Prerequisites and ordered actions | Expected result / failure | AC and future proof |
| --- | --- | --- | --- |
| S1 / app user refreshes domestic weather | Published S3 fixtures, empty memory, providers disabled; GET an included address weather path, then repeat | Cold output equals legacy frozen-input bytes; warm output unchanged; missing history must not produce invented fields | AC1/2; golden + cold/warm smoke |
| S2 / coordinate user receives correct label | Legacy-key geocode cache empty after replacement; replay recorded locale/boundary coordinates with one/two-provider replies and peak arrivals | Same legacy label/fields; no precise-geocode archive; world raw requests use legacy 0.02-degree cells; quotas and 3s/5s/9s caps hold, failure preserves error/fallback | AC1/2; privacy/schema, geocoder demand and gateway fixtures |
| S3 / old client updates push/town/nation | 19-route fixture matrix, including failed-only and OPTIONS groups; replay each method/version | Existing validation, body/status, authentication, CORS and 304 preserved; zero-observed exclusions do not remove used internal functions | AC2; inventory reconciliation and golden harness |
| S4 / client survives replacement | PUT raw; publish group partition A then fail B while B retains an old healthy catalog; restart empty, request, repair B and retry | Incomplete fetch group excluded in all partitions; previous complete group or error used; after all siblings/member digests match, identical full revision fold restored; no blind provider quota spend | AC1/2; cross-partition kill/fault/property smoke |
| S5 / concurrent/cancelled callers | Several same-key cold requests; cancel initiator during S3 acquisition | Remaining callers share operation; bounded owner completes publication; no unbounded CPU/I/O or lost acknowledged record | AC1; single-flight and shutdown tests |
| S6 / client uses historical pack | Build pack from durable fixtures, introduce late revision, corrupt/delete serving pack in test peer | Late fields retained; verified canonical fallback yields same bytes; pack-before-index crash harmless | AC1/2; pack hash/range/fallback smoke |
| S7 / operator checks outage and warning history | Valid memory, S3 outage; then empty memory; providers disabled with old type 2/3 and type 4 fixtures | Memory within TTL works; new undurable success rejected according to decided contract; warnings equal legacy at +10h/+19h | AC1/2; failure matrix/golden |
| S8 / reviewer assesses speed and future scale-out | Fixed fixture workload; clear caches; measure 8/16/32/64 concurrency, sibling-catalog hops, provider misses and replacement geocoder bursts | Report full p50/p95/p99, bytes/RSS/CPU, catalog-version cost, geocoder quota and attempt time; no estimate relabeled p95; future coordination remains prerequisite | AC3; P2/P2b benchmarks and later scale-out fault tests |

| S9 / implementer preserves the new runtime boundary | Task declares paths; add server2 configuration, fixture or deployment assets, then review/check the full diff and dependencies | Assets under `server2/` pass; misplaced files or legacy resource dependencies fail; only declared outside wiring/verification changes pass | AC4; manual review before S04, then placement gate plus dependency/resource review |

## Risks, rollback and proof

Riskiest changes are raw/catalog publication after interruption, incomplete
history acquisition, volatile precise geocoding, and output parity after merging
revisions. Raw packs can trade fewer GETs for more bytes/CPU/storage; disabling
packs must fall back to the same canonical raw set. Multi-process API workers
and inter-instance shared caches are rejected initially because they add cache
duplication/IPC/coordination before a measured need.

Keep the legacy process and family switches during coexistence. D03 requires
no legacy push-registration migration, while rollback must preserve new durable
registrations; switch-back alone does not undo accepted state mutations. Preserve CloudFront policy and rehearse rollback with cached responses.
Only per-family AK-approved cutover changes deployment. A design-document revert
has no runtime side effects.

Proof for this PR is recorded in
[selected verification evidence](../docs/evidence/tasks/issue-2614-design/verification.md).
Rust/property/provider/latency/shadow checks above are future requirements, not
tests claimed to have run in the documentation PR.

## S01 approved policy handoff

The [AK decision record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640)
resolves demand-limited capture and core S3 storage/publication/outage choices.
S01 can complete after disposition records and documentation verification. S04
foundation then precedes S02/S03 server2 assets and every later implementation.
S14 must prove demand expiry, replacement reconstruction and capture ownership
under durable provider budgets; S15/S17 and affected push behavior wait for its
history catch-up. D01–D04 resolve the prior push migration/retry and cache-policy questions.
S18 implementation-owned state design, geocoder privacy/label proof, measured
costs, key provisioning and every route cutover retain their verification gates.

Decision-record scenario: AK accepts the options; the implementer opens the
parent record and follows S04's O-2/O-4/O-12 prerequisites. Expected: foundation
work proceeds in its own PR. S18 follows recorded D01–D03 and its dependency
gates; any route switch without goldens/shadow/approval remains blocked.
This document verification checks the recorded disposition, not runtime capture.

## Cold-cell compatibility gate (R16)

The [parent clarification](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009294236)
retains the accepted demand-limited policy without approving absent history.
S14 #2699 tests never-requested, resumed-after-more-than-8-days and partial S3
history cells. Only verified S3 revisions, legacy exports and legacy-equivalent
recovery may reproduce history; ASOS does not replace missing grid-hour values.
S20 #2705 preserves per-family legacy fallback, deadlines/errors and measured
coexistence quota costs even after nominal cutover. S21 #2706 is blocked while
cold-cell behavior needs legacy/Mongo; retirement is not promised without proof.
Demand identity under state/demand/grid/ is grid, last-demand time and expiry
only, without user coordinates/identifiers, tokens or per-request logs.


## Parallel implementation after S04

AK authorized useful parallel implementation. S02 owns used-API goldens; S03 owns
local S3/provider infrastructure and this architecture/plan reconciliation; S05
owns raw records. Separate branches share the integrated baseline and exact task
declarations. Shared CI edits are serialized; each PR retains its original checks
and independent review, with no merge authority. S03 resource templates are a
proposal, not provisioning. See [S03 plan](issue-2688.md) and its operations manual.

[AK D01–D04](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6015980608)
remove the superseded registration-migration/retry policy gate. They do not remove
weather-history acquisition, cold-cell legacy fallback, quota or cutover gates.

## 2026-10-09 focused PR correction after actual AWS execution

One separately authorized host attempt failed before guard readiness and measurement. At 13:06:08Z, AWS readback confirmed host termination, owned root/SG/IAM/profile removal and zero retained S3 versions. Egress stayed closed; no SSM/bootstrap/worker/provider work ran. The live console exposed both a multibyte console bound mismatch and a bootcmd timer/sysinit ordering cycle inferred from logs plus upstream unit definitions.

The focused correction moves all stock guard setup to final-stage runcmd, retains closed egress/watchdog/expiry, accepts complete CLI text within 65,536 characters and 131,072 UTF-8 bytes, and removes the host workspace test invocation per AK. The [operations manual](../docs/operations/server2-feasibility.md#2026-10-09-actual-execution-and-focused-correction) records direct evidence, cleanup and limitations. The eight unfinished preparation15 files are preserved separately, not shipped. No further AWS launch, merge or budget reset is part of this correction. QA6 remains historical; new live readiness and independent review are not claimed. Tests are not added or run under AK's instruction. S09/O-2/O-5 and downstream S10/S13 remain pending.
