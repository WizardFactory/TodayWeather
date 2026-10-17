# Plan: document and later implement server2

Source: [intent](../intent/issue-2614.md), [spec](../specs/issue-2614.md).
Current status (2026-10-17, observed main `6e4436c8`): existing backend ports including S15b #2742 and S18 #2703 are integrated/closed. S20a #2789 and S20b #2792 process/API/worker preparation is integrated. Structured logging #2802 is integrated through PR #2804; common native verification and local paired recovery are integrated through S19b/S19c PR #2801/#2806. S19 #2704 and S20 #2705 remain open for operational qualification. S20c reconciles the accepted19route inventory plus notice supplement, preserves the unclassified `/ww` gap, prepares a per-request nginx upstream deadline configuration and an explicit previous-server2/config/state rollback procedure. These preparations do not establish whole-service eligibility. #2724 quota measurement and new #2805 nationwide narrative are excluded from this preparation. Seven-day shadow, exact production inventory/parity, real-host capacity/performance/deadline, final state/rainfall handover and separately approved cutover remain gates. App/web notice popup #2623 is separate. No deployment, live mirroring or device send is claimed. Earlier dated entries remain revision-bound history.

## Current AK amendments (2026-10-14 to 2026-10-16)

These decisions supersede the older cold-cell, key, push-copy, cache and mock-only statements below. In particular, the 2026-10-13 mock-only geocoder description is historical; S10c/S10e replaced those verification modes.

- **Request-time collection:** wait at most 3 seconds once across a client request. Assemble the available data using the legacy absent-field rules and omit parts still being acquired. The original `EWEATHERUNAVAILABLE` / 503 direction in [the first record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6170975982) was explicitly withdrawn by [AK's correction](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6171051242); late inputs alone must not create a new 503 response. Owned acquisitions continue with the legacy provider timeouts (AirKorea 5 s, life index 30 s, KMA web pages 30 s, town forecast and forecast zone 10 s), store the raw record and serve subsequent requests. Do not pre-collect before startup or cutover.
- **Hourly history:** retrieve recent KMA grid hours on demand. For D-7..D-1, fill only missing or invalid grid hourly fields at exact hourly keys from the nearest ASOS city station within 100 km, with per-field provenance, `historyStatus` and the legacy yesterday-comparison eligibility rules. Fetch the ASOS records on demand and store them as raw records ([AK correction](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6167422423)). Past multi-day history uses the data.go.kr per-station period request; ongoing nationwide observations use the national AWS hourly page ([AK's two-source decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6172208535)). No full Mongo weather archive copy or post-go-live legacy fallback is required.
- **Go-live boundary:** legacy stops when server2 goes live. Development/coexistence routing switches may remain until then, but every included production path must work without forwarding to legacy. Missing native coverage blocks cutover rather than becoming a permanent legacy dependency. Shadow verification does not authorize startup or cutover pre-collection ([decision](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6167422423)).
- **Small state copies:** only push/alarm registrations, latest warning bulletins/zone state and `kmastninfos` are copied from MongoDB. Original documents remain unchanged. Development-time read-only copies are already authorized whenever needed, followed by a final pre-cutover copy; no renewed operator approval is required merely to read/copy these datasets ([development authorization](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6167457443), [copy clarification](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6167461903), [station authorization](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6180171324), [S20 procedure](https://github.com/WizardFactory/TodayWeather/issues/2705)). The station seed is copied. Production server2 push state has not been reported as seeded. Preserve legacy rainfall statistics until shutdown, then server2 manages updates ([S20 handover](https://github.com/WizardFactory/TodayWeather/issues/2705)). Production deployment, cutover and live sends retain their separate gates.
- **Nationwide reuse:** AirKorea `전국` observations, station lists and dust forecasts, and KMA national observation pages are acquired once per dataset/publication and shared across requests ([AirKorea contract](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6172254679), [station/history contract](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6173095881)). ASOS historical station/period records are shared by every grid using that station; the request-local 3-second wait does not multiply collection work.
- **Configuration:** server2 reads its own `server2/.env`, initially copied from `server/.env`, using legacy names/values for equivalent settings. AK also allowed necessary server2-only settings in that file; this permits settings missing from legacy, not arbitrary replacement provider keys ([S10e decision and mapping](https://github.com/WizardFactory/TodayWeather/pull/2755)). The dedicated S3 settings are one use of this permission. Do not add dry-run, mock, local-only or operational verification modes; test doubles are injected in tests. S10c/S10e removed the former modes.
- **Provider scope:** follow current official API documentation, legacy collectors and tw-svc assembly, and confirm proposed collection methods with real API calls before relying on them ([national collection decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6172254679), [ASOS method decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6172208535)). AirKorea dust forecast/station listing and forecast zones follow the repaired legacy sources; quota rejection rotates keys in both legacy and server2; day+3 pollen is retained ([AK decisions](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6170975982)). Quotas are per API and key (#2772); operating allowance values remain to be supplied ([quota decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6205933057)). Live push sending remains excluded from development verification.
- **Image forecasts:** restore AirKorea 820×820 image forecasts ([AK decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6180171324)). Read calibration read-only from production configuration, or derive it if absent ([calibration direction](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6170975982)); the deployed calibration was subsequently retained and the current legend/KAQ fallback approved ([later decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6183425093)). Current legacy #2757/#2762 governs decoding and #2771 governs KAQ-to-AirKorea selection. S15b-3c and its #2777 selection alignment are merged. The accepted image-start safety bound remains recorded in [the S15b-3c decision](https://github.com/WizardFactory/TodayWeather/issues/2742#issuecomment-6194598140).
- **Local disk:** the entire server2 may use a bounded, disposable local cache. S3 remains authoritative; missing/corrupt local copies are recovered from S3. Existing privacy boundaries still apply. The merged disk-cache increment #2781 records the allocated-byte sample and recommends 32 GiB gp3 with an 8 GiB global cache cap plus explicit OS/log/temporary/headroom assumptions in [the infrastructure guide](../docs/operations/server2-infrastructure.md); this is not an EC2 cold-p95 measurement ([AK decision](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6194793664)).
- **Notices and summaries:** implement #2623 directly in server2/S3 (S18c); preserve legacy `push-list` storage-error 200 with item `null` ([S18 decisions](https://github.com/WizardFactory/TodayWeather/issues/2703#issuecomment-6205932430)). S16 town-keyed grid summaries and lookup-only VC summaries are accepted ([S16 decision](https://github.com/WizardFactory/TodayWeather/issues/2701#issuecomment-6205932746)), with no new API/UI (O-13). S16 PR #2764 is now merged; summary storage/lookup remains separate from new API/UI scope.


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

## S09 local-first scope amendment (2026-10-11)

AK fixed Rust adoption and requested maximum local verification with minimal EC2
work; [issue #2694](https://github.com/WizardFactory/TodayWeather/issues/2694)
is the governing scope; [the recorded task direction](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6099330068) provides the decision trace. Rust go/fallback/time-box reconsideration is removed.
S09 completes on the scoped local/Linux-CI checks and resolution of Required PR
findings. S09 live measurements no longer block S10/S13 implementation. Other
S01 decisions, S02 route goldens, placement, API parity and cutover gates remain.

Build the intended Linux x86_64 musl release artifact in isolated Linux CI and
run its startup smoke and synthetic loopback matrix there. The portable local
runner also works with a native release artifact. Cover cold, warm and simulated
provider Data/NoData/denied/error outcomes at 8/16/32/64 offered clients without
raising the existing owner/I/O/CPU or fixture limits. Retain overload and timeout
outcomes, sample limitations, whole-process RSS/CPU, foreground throughput and
operation/version-byte cost inputs. Local timings and byte counts do not establish
AWS latency, physical S3 storage or invoiced cost. Unit prices remain explicitly
unset until a dated price assumption is supplied; no dollar estimate is inferred.

Before production, use a separately authorized minimal EC2 smoke: transfer the
prebuilt artifact, verify startup/health/runtime resources/TLS/credentials, then
a tiny isolated same-region S3 GET/HEAD/PUT/LIST and exact readback. No on-host
build, full concurrency sweep or provider traffic is required by S09. Actual API
performance/cost acceptance belongs to pre-cutover work. Raw packs remain disabled
until actual route measurements demonstrate a need against an agreed target.
Existing AWS campaign tools/grants and their failure/cleanup records are retained
as historical evidence. They are not the minimal smoke procedure or renewed
execution authority. No AWS execution, retry, budget renewal, merge or deployment
is authorized by this amendment.

Earlier S09 campaign paragraphs below are historical; their live-measurement
and Rust-feasibility blockers are superseded by this amendment.

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

The historical S09 live-evidence blocker is superseded: scoped local/Linux-CI
verification and Required finding resolution release S10/S13 implementation.
Minimal EC2 smoke and actual API performance/cost checks remain preproduction/pre-cutover work.
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
| S09 | [server2 S09: verify locally and minimize EC2 validation](https://github.com/WizardFactory/TodayWeather/issues/2694) | [S02](https://github.com/WizardFactory/TodayWeather/issues/2687), [S03](https://github.com/WizardFactory/TodayWeather/issues/2688), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S08](https://github.com/WizardFactory/TodayWeather/issues/2693) |
| S10 | [server2 S10: port gateway and geocoding with legacy backend switches](https://github.com/WizardFactory/TodayWeather/issues/2695) | [S02](https://github.com/WizardFactory/TodayWeather/issues/2687), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S08](https://github.com/WizardFactory/TodayWeather/issues/2693), [S09](https://github.com/WizardFactory/TodayWeather/issues/2694) |
| S10a | [server2 S10a: measure actual geocoder quotas](https://github.com/WizardFactory/TodayWeather/issues/2724) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695), [S19](https://github.com/WizardFactory/TodayWeather/issues/2704) gateway increment (#2725) |
| S10b | [server2 S10b: keep the gateway 501 deadline response within the connection lifetime](https://github.com/WizardFactory/TodayWeather/issues/2730) (merged #2731) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695), [S19](https://github.com/WizardFactory/TodayWeather/issues/2704) gateway increment (#2725) |
| S11 | [server2 S11: port world weather and air](https://github.com/WizardFactory/TodayWeather/issues/2696) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695) |
| S12 | [server2 S12: port warning history and latest bulletin recovery](https://github.com/WizardFactory/TodayWeather/issues/2697) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695) |
| S13 | [server2 S13: port domestic provider acquisition and raw formats](https://github.com/WizardFactory/TodayWeather/issues/2698) | [S02](https://github.com/WizardFactory/TodayWeather/issues/2687), [S07](https://github.com/WizardFactory/TodayWeather/issues/2692), [S08](https://github.com/WizardFactory/TodayWeather/issues/2693), [S09](https://github.com/WizardFactory/TodayWeather/issues/2694) |
| S13a | [server2 S13a: extend provider formats for air, rise/set and zone data](https://github.com/WizardFactory/TodayWeather/issues/2729) (merged #2733) | [S13](https://github.com/WizardFactory/TodayWeather/issues/2698), [S11](https://github.com/WizardFactory/TodayWeather/issues/2696) |
| S14 | [server2 S14: migrate legacy history and close acquisition gaps](https://github.com/WizardFactory/TodayWeather/issues/2699) | [S01](https://github.com/WizardFactory/TodayWeather/issues/2686), [S13](https://github.com/WizardFactory/TodayWeather/issues/2698) |
| S15 | [server2 S15: port domestic KMA v000903 assembly and Rust checkpoint](https://github.com/WizardFactory/TodayWeather/issues/2700) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695), [S11](https://github.com/WizardFactory/TodayWeather/issues/2696), [S12](https://github.com/WizardFactory/TodayWeather/issues/2697), [S13](https://github.com/WizardFactory/TodayWeather/issues/2698), [S14](https://github.com/WizardFactory/TodayWeather/issues/2699), [S13a](https://github.com/WizardFactory/TodayWeather/issues/2729) merged scope (#2733; its AirKorea decision follows S02 golden parity) |
| S16 | [server2 S16: store daily summaries and last-year lookup](https://github.com/WizardFactory/TodayWeather/issues/2701) | [S11](https://github.com/WizardFactory/TodayWeather/issues/2696), [S14](https://github.com/WizardFactory/TodayWeather/issues/2699), [S15](https://github.com/WizardFactory/TodayWeather/issues/2700) |
| S17 | [server2 S17: port used older weather versions, nation and town](https://github.com/WizardFactory/TodayWeather/issues/2702) | [S15](https://github.com/WizardFactory/TodayWeather/issues/2700) |
| S18 | [server2 S18: implement used push and notice state with new registrations](https://github.com/WizardFactory/TodayWeather/issues/2703) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695), [S12](https://github.com/WizardFactory/TodayWeather/issues/2697), [S15](https://github.com/WizardFactory/TodayWeather/issues/2700) |
| S19 | [server2 S19: build integrated smoke, shadow and rollback tooling](https://github.com/WizardFactory/TodayWeather/issues/2704) | [S10](https://github.com/WizardFactory/TodayWeather/issues/2695) |
| S20 | [server2 S20: verify and perform approved family cutovers](https://github.com/WizardFactory/TodayWeather/issues/2705) | [S19](https://github.com/WizardFactory/TodayWeather/issues/2704); gateway family also [S10a](https://github.com/WizardFactory/TodayWeather/issues/2724) |
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
| O-2 | Rust adoption settled; S09 local/Linux artifact checks. S15 correctness checkpoint remains; language go/fallback/time-box review removed |
| O-3 | D01–D03 resolved: S18 owns schema/ordering and copies legacy registrations read-only (development-time and final pre-cutover authority above); failed/unknown deliveries are not automatically retried. Verification and durable acceptance still gate activation |
| O-4 / O-12 | S04/S07 bounded cache admission/failure contract; disposable local disk caches allowed by the 2026-10-15 amendment |
| O-5 | S05/S06 catalog/raw lifecycle, S08 reservation retention, S09 local operation/version-byte cost inputs, pre-cutover actual API cost validation and O01 pack policy |
| O-6 | D04 authorizes memory/S3 caches; the 2026-10-15 disposable-disk amendment also applies without changing privacy. S07/S10 select layout/validity and prove exact labels, privacy, quota/deadline behavior |
| O-7 / O-8 | S02 fixture scope, S15/S17 current active behavior; unknown scope blocks go-live until dispositioned; selected native paths do not depend on legacy |
| O-9 | S05–S08 publication/reservation/outage semantics, S10–S13 affected serving and warning behavior, S18 state acceptance and O01 publication |
| O-10 | Reuse the legacy names/values from the copied `server2/.env` per the [S10e configuration decision](https://github.com/WizardFactory/TodayWeather/pull/2755); ASOS uses existing `DONGNAE_SECRET_KEYS` per [AK](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6170975982). This supersedes the former separate-key requirement, not actual quota verification |
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
| P0 | Record remaining issue choices; keys/IAM/bucket/versioning/lifecycle, actual runtime/Spot prerequisites and rollback ownership. No durable local archive requirement; reserve measured disposable-cache capacity. Use accepted traffic report; supplement only its scope gaps/new paths before their cutover. |
| P1 | Golden harness for the 19 observed groups and retained internal dependencies; current deployment/source/client contract reconciliation, error/CORS/cache/304/preflight fixtures, #2609/#2620 and acquired-history cases. Freeze clock and raw input; two runs byte-identical. |
| P2 | First establish the `server2/` Rust workspace/CI and placement gate (S04); later implementation tasks depend on it. Then storage/resolver, synchronous publication, memory/single-flight limits; property/crash tests with recorded providers and local S3-compatible peer. Verify local/Linux-musl build compatibility, synthetic origin throughput, RSS/CPU and cold request fan-out. Use only a separately authorized minimal preproduction host smoke; validate actual API latency/costs before cutover. Raw packs remain disabled pending measured route benefit. |
| P2b | Gateway/geocoder with backend switches to legacy, exact validation/errors/cache/deadline and privacy-safe coordinate handling. Whole-gateway shadow and rollback rehearsal. |
| P3/P4 | World providers used by gateway and warning catalogs/restore; no deletion of a backend solely due to unused direct public paths. |
| P5/P6 | Domestic raw JSON, request-time KMA/ASOS history, summaries and v000903 assembly; close O-1/O-11 acquisition gaps and runtime correctness checkpoint. Active health/air behavior follows current fixtures. |
| P7 | Used older versions, nation and town, including v000705 town; exclude only supported zero-observed public paths. |
| P8 | Used push/state and applicable notice supplement; durable new-state acceptance, send ownership, sanitized failure logs, no automatic resend and a read-only copy of existing registrations. Do not revive retired purchases. |
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

Keep the legacy process and family switches only during development/coexistence.
The later AK copy decision supersedes D03: copy legacy registrations read-only and
preserve new durable state. Go-live must remove the legacy serving dependency, so
an old-process switch is not a steady-state recovery strategy after retirement.
Preserve CloudFront policy and rehearse the approved recovery procedure with cached
responses. Cutover and production deployment still require explicit AK approval.
A plan-document revert has no runtime side effects.

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
history cells. The original no-ASOS/no-gap interpretation was corrected by AK on
2026-10-14: use request-time recent KMA data and legacy-compatible ASOS hourly fill,
with provenance and comparison eligibility. Do not depend on Mongo weather exports,
startup pre-collection or post-go-live legacy forwarding. S20 #2705 must verify the cold
request's native partial response and continuing acquisition before cutover; S21
#2706 cannot retire a dependency that an included path still needs.
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
weather-history acquisition, cold-cell native coverage, quota or cutover gates. The later copy decision supersedes D03; see Current AK amendments above.

## 2026-10-09 focused PR correction after actual AWS execution

One separately authorized host attempt failed before guard readiness and measurement. At 13:06:08Z, AWS readback confirmed host termination, owned root/SG/IAM/profile removal and zero retained S3 versions. Egress stayed closed; no SSM/bootstrap/worker/provider work ran. The live console exposed both a multibyte console bound mismatch and a bootcmd timer/sysinit ordering cycle inferred from logs plus upstream unit definitions.

The focused correction moves all stock guard setup to final-stage runcmd, retains closed egress/watchdog/expiry, accepts complete CLI text within 65,536 characters and 131,072 UTF-8 bytes, and removes the host workspace test invocation per AK. The [operations manual](../docs/operations/server2-feasibility.md#2026-10-09-actual-execution-and-focused-correction) records direct evidence, cleanup and limitations. The eight unfinished preparation15 files are preserved separately, not shipped. No further AWS launch, merge or budget reset is part of this correction. QA6 remains historical; new live readiness and independent review are not claimed. Tests are not added or run under AK's instruction. S09/O-2/O-5 and downstream S10/S13 remain pending.

### S09 external-review correction17

PR2722 review5471241898 is addressed within the declared tooling scope: watchdog bounded retries and truthful failure receipts, per-client provider-data storage observations without discarding overload outcomes, existing operator expectation alignment, and warm-wave population labels. CLI serialized-output limits remain conservative and documented. No new tests or local suites, AWS execution, route release or merge are authorized. Actual intended-host/S3 measurements and O-2/O-5 still block S10/S13.

### S09 integrated and S10 staged gateway (2026-10-13)

PR #2722 is merged at `07fdaf991d617f16944d75c201d64f35a4f2c83a`;
S09 #2694 is complete under AK's local-first amendment. The separately authorized
one-host AWS smoke passed and its instance/resources were cleaned up; see the
[issue result](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6135052769).
Earlier dated S09 blocker entries above are retained historical records.

S10 is being implemented on that integrated base with parallel gateway, geocoder
and design lanes plus root integration. Its [task plan](issue-2695.md) and
[exact path declaration](../server2/config/tasks/S10.json) govern changes.
Default explicit legacy HTTP adapters remain; native geocoder acquisition is
local mock-only. Reuse existing injected Kakao/Google `.env` keys; do not require
a new geocoder key set. Actual daily/peak quotas, production exact-label/shadow
and cutover checks remain activation gates. No S10 AWS execution, live provider
traffic, production switch or merge is authorized by this implementation task.

### S10–S14 integrated (2026-10-13)

AK authorized merging the reviewed server2 PRs in dependency order and starting the
next parallel tasks. Merged to master: S10 #2723 (`ca8735cf`), S13 #2726 (`47a96078`),
S19 first increment #2725 (`d15ea118`), S11 #2728 (`45e9193b`), S12 #2727 (`7ffe0b80`),
S10b #2731 (`ae81f972`), S13a #2733 (`91b29d0f`) and S14 #2732 (`87ab79cd`). Each was
merged pinned to a head with 14/14 CI and an independent Codex PASS, as recorded in
each issue's closing or completion comment ([#2695](https://github.com/WizardFactory/TodayWeather/issues/2695),
[#2698](https://github.com/WizardFactory/TodayWeather/issues/2698),
[#2704](https://github.com/WizardFactory/TodayWeather/issues/2704),
[#2696](https://github.com/WizardFactory/TodayWeather/issues/2696),
[#2697](https://github.com/WizardFactory/TodayWeather/issues/2697),
[#2730](https://github.com/WizardFactory/TodayWeather/issues/2730),
[#2729](https://github.com/WizardFactory/TodayWeather/issues/2729),
[#2699](https://github.com/WizardFactory/TodayWeather/issues/2699)). Integration-only
changes (master merges, the S12 code-30 expectation and the S12 store-wide S3 bound) were
re-run locally and in CI before merge; the S12 bound also received a focused Codex PASS.

Follow-ups: [S10a #2724](https://github.com/WizardFactory/TodayWeather/issues/2724)
owns actual Kakao/Google quotas and the live geocoder mode; S20 now also requires it
for the gateway family and a keep-alive decision for the 9 s `501` (S10b guarantees it
only within 3 s of connection accept). [S13a #2729](https://github.com/WizardFactory/TodayWeather/issues/2729)
remains open for the AirKorea dust-forecast/station-list decision (legacy calls a
retired host; S02 goldens contain no dust-forecast fields). S11 live air is in S13a;
AK accepted the single native S10 attempt as an intended difference
([decision record](https://github.com/WizardFactory/TodayWeather/pull/2728#issuecomment-6142276647)).
S14's ASOS history-read concern: the [observed service host](../docs/architecture/ec2-internals.md)
runs a `5bca407` checkout (commit date 2019-03-07), and `2116c6bf` (2026-09-24), which adds
`ASOS_HISTORY_READ_ENABLED`, is not its ancestor, so the observed deployment has no such
switch. This is a timestamped observation, not proof of the current deployment; recheck
the deployed revision before cutover. Native families remain off; no AWS, live provider,
deployment or cutover action was taken.

### Implementation/status reconciliation (2026-10-16)

This amendment records already authorized work and corrections; it does not introduce
new runtime behavior. S15b data work is tracked by [#2742](https://github.com/WizardFactory/TodayWeather/issues/2742).
Merged provider/configuration follow-ups include S13b #2743, S13c #2748, S13d #2749,
S10c #2738, S10e #2755 and S10f #2760. Original S15 assembly #2735 is integrated;
S15b inputs were added by #2744, #2751, #2754, #2750, #2752 and #2761, and request-time
forecast collection by #2767. S17a #2763 and S17b #2765, S18a #2766 and fixed-clock
tests #2768 are integrated. Golden hash refresh #2776 follows legacy #2771.

At master `c7ad661b`, S15b-3e #2777 is merged; the active integration queue is S16 #2764,
S18b-1 #2774 and S15b-4b-1 #2773. Their independent code-review results are separate
from documentation assessment, CI and integration: none alone establishes task completion,
cutover or live push success. S17c nation and S18b-2 conditional alerts are separate
implementation lanes. Then finish the S18 warning feed/notices and the S15b cold
request/local-cache/storage sizing work, extend S19 verification, measure the
remaining S10a quotas, and perform separately approved S20/S21 operational work.


### Recovery integration snapshot (2026-10-16, master bf772fff)

S16 #2764 merged as `f00b83d3`, scheduled alarms #2774 as `abf59d09`,
conditional alerts #2778 as `82356a95`, native errors #2773 as `ec32c73f`,
nation #2780 as `8daa43ad`, disposable disk cache #2781 as `f32386cb`,
and warning delivery #2783 as `bf772fff`.
Each integration retains its exact-head CI and independent review evidence in
its PR. Earlier failed or incomplete attempts remain in task history.

AK approved normalizing a newly geocoded town's coordinates to numbers from
first admission, yielding 200 for valid first/same-process/reloaded requests.
Legacy's string-coordinate failure is tracked separately in
[#2782](https://github.com/WizardFactory/TodayWeather/issues/2782); another team
reviews legacy and no legacy fix is part of server2 work.

The remaining S15b whole-response verification must distinguish assembly-only
oracle cases from cases representable by actual provider raw. It must not
fabricate canonical S3 records, weaken validators or label partial-layer checks
as full-response parity. Empty RAM, disabled providers, cache loss/corruption
and zero legacy hops remain required scenarios. S18 notice implementation and
S19 family coverage remain unfinished; warning worker/process wiring and
deployment/cutover are S20 activation tasks.
