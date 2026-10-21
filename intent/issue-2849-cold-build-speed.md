# Intent: speed up one empty-cache domestic forecast build (issue #2849 follow-through)

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | `issue-2849-cold-build-speed` / intent / main (Claude Sonnet 5.5, Anthropic) |
| Date / revision | 2026-10-22 KST, revision 2 (amendment below) |
| Source / authority | AK, 2026-10-22: implement per SDLC after the #2849 investigation; keep the EC2 host time limit until implementation completes. Issues #2849 (revised body), #2850. |
| Base | `307defeb706886217ab67ea858dc7c7b0435752f` (PR #2841 head, branch `fix/domestic-warm-cache-2819`); this task's branch `fix/cold-build-speed-2849` |
| Endpoint | `pre-merge` as the intended constraint; delegation of external writes is **pending** (see Authority) |
| Consumers | investigation, spec, plan, builder, reviewers |

## Problem and supporting facts

server2 builds the forecast views of one town from raw S3 acquisitions when its memory cache is empty. D2 (PR #2841) reads the partitions of a view one at a time, each as a chain of 3–4 GETs, through a forecast catalog store limited to 2 concurrent lookups. One empty-cache request therefore performs about 2,220 forecast GETs in about 700 sequential lookups.

- On the Seoul t3.small / 2 GiB / CPU Unlimited host with a loopback S3 fixture the request needs 8.0–9.1 s (p95 8.28 s over 20 fresh-process runs) against a 3 s native deadline and the #2705 gate "assembly-only cold p95 ≤ 2.5 s"; with the product limits it returns HTTP 502 (2026-10-21 record).
- The loopback run hides S3 round trips. A local sweep with a delay injected into every GET/HEAD/LIST gives 1.4 s (0 ms), 10.1 s (5 ms), 19.8 s (10 ms); the sequential chain costs about 2 s per millisecond of S3 delay.
- A throwaway prototype (never committed) that keeps results in partition order but looks up 12 partitions at once and raises the store limit to 12 reached 3.2 s at 10 ms and 6.2 s at 20 ms; with a 32-permit process gate 1.8 s / 2.5 s. Raising only the lookup concurrency without the store limit changed nothing; more owners changed nothing.
- Fold CPU is next: `short` 1.16 s and `shortest` 0.43 s locally, about 4× slower on t3.small. The fold re-weighs the whole Doc collection on every store (quadratic), copies `String` values on every `Row::get`, and allocates heavily. A prototype that skipped the quadratic re-weigh cut fold by about 17%.
- All outputs were identical to the goldens (13 view Docs; HTTP body sha256 `a6462aba8ad9ec34…`, 42,549 bytes).

Affected: every first request for a town whose forecast views are not cached (restart, eviction, expiry), the 502 rate of the native route, and the #2705 cold-p95 cutover gate. Retention (how long views are kept) is #2850 and out of scope.

## Desired outcome and acceptance criteria

An empty-cache forecast request completes inside the unchanged 3 s native deadline with identical output, bounded memory and no new runtime mode. Goal on the measured host class: empty-cache p95 ≤ 2.5 s at a modeled S3 delay of 10 ms. If the bounded iterations cannot reach that, report the measured remaining gap; never relax the deadline or the gate.

- **AC1 — ordered concurrent reads.** A view build looks up its partitions with bounded concurrency while consuming results in partition order. Acquisitions, order, exclusion counts and the first error equal the sequential read. With a delayed transport double the build time follows operations × delay ÷ concurrency (at least 4× faster than the sequential read for 120+ partitions at the same delay). Timeout, corruption, missing catalog and capacity paths return the same typed errors; a cancelled build leaves no installed partial view and no running lookup beyond the S06 blocking closures that already outlive their caller.
- **AC2 — identical output and limits.** All 13 view Docs equal their goldens; the HTTP bodies of the cold, warm and empty-cache-in-warm-process requests equal the reference; every capacity limit keeps its exact boundary behavior (existing ±1 tests stay green); the forecast store's in-flight read memory, summed over all views of the process, stays below D2's bound.
- **AC3 — linear fold accounting.** Retained-Doc accounting no longer re-walks the whole collection per store or the whole Doc per field set, and the grid collector's row lookup no longer copies strings per visited row; a deterministic operation-count test shows linear growth and the local fold time of `short` and `shortest` falls against the D2 baseline on the same corpus with unchanged output.
- **AC4 — Seoul t3.small evidence.** The candidate and D2-as-published are measured with the same harness on the Seoul t3.small (Unlimited) host at modeled S3 delays 0, 10 and 20 ms (empty-cache request, fresh process and warm process), bodies identical, and the gap to 2.5 s is stated.
- **AC5 — contract, documentation and placement.** No new runtime flag or mode; all added paths are under the declared `server2/` subdirectories plus the declared documents; the D2 architecture section, the operator guide and the diagram describe the new read concurrency and limits; the placement gate passes; unrelated files are untouched.

## In scope, out of scope, constraints

- In scope: `server2/src/domestic/kma/source/{forecast_cache,records,mod,grid,doc,items,rss,mid}.rs` as needed for AC1–AC3, tests under `server2/tests/` and unit tests in those modules, the loopback-peer latency test aid under `server2/tests/storage/`, measurement tooling under `server2/examples/` or `server2/tools/`, and the declared documents.
- Out of scope: retention, SSD tier and warm-up (#2850); packs/rollups (#2707); resizing the process S3 gate `S3_IN_FLIGHT` (a separate decision; evidence recorded); host class; legacy `server/`; provider calls; production actions.
- Constraints: a request waits at most 3 s and omits late optional parts; S3 is authoritative; responses are byte-identical; no verification-only mode; no legacy dependency; fallible/charged allocation discipline of D2 stays; reviewer provider must differ from the builder.

## Authority and endpoint

- Delegated now: local implementation, tests, local smoke, the Seoul EC2 host described below, local commits on the task branch.
- **Not yet delegated (needs AK's explicit authority record `pre-merge-authority.json`):** pushing the branch, creating or updating a PR (stacked on #2841), issue comments or edits, sending code to another provider's reviewer, CI reads that need a PR. Until then pr-review and completion cannot run; the work stops at a verified local candidate.
- EC2: one role-less Spot t3.small in Seoul (ap-northeast-2d), SSH from the operator address only, egress revoked, auto-shutdown timer (initially 8 h, renewed while work continues), budget envelope USD 0.30 with a stop-and-ask above it. A safety classifier blocked the first operator-script run; no AWS call has been made. Launch waits for AK's explicit confirmation.
- Always excluded: merge, auto-merge, merge queue, production deployment, secrets, new accounts, permission changes.

## Assumptions, risks and open questions

- Assumption: AK's "implementation" selects options A and B of #2849; C (packs) and gate resizing stay decisions.
- Risks: ordering/error-precedence regressions in the concurrent read; sharing the 12-permit process S3 gate with other families during a cold build; unaccounted in-flight bytes; timing-only tests being flaky; a stacked PR on an unmerged, conflicting base.
- Open questions for AK: (1) delegate `pre-merge` (push, stacked PR on #2841, OpenAI Codex as required reviewer, issue comments)? (2) confirm the EC2 launch now. (3) raise `S3_IN_FLIGHT` later (evidence: 12 → 3.2 s, 32 → 1.8 s at 10 ms)?

## Intent gate

PROCEED for local stages (investigation → build → local self-verification). NEEDS_HUMAN for external writes and the AWS launch; unaffected work continues.

Amendment 2026-10-22 (revision 2, before any code): AC2's memory clause read "in-flight read memory stays within the previous per-view bound". The forecast catalog store is one instance shared by every view, and D2 already let two owners read at once, so its bound is process-wide; with overlapped lookups one view may now use more than one sequential D2 lookup did. The clause now compares the store's in-flight bytes over all views with D2's. Found while planning, when the raw store's refuse-rather-than-wait admission and the per-load compressed buffer were added to the arithmetic. No other criterion changes.
