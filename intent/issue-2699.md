Task: issue-2699-s14; owner: Claude builder (S14 worktree); revision/base: 47a96078 (origin/master, S13 merge); date: 2026-10-13.
Authority: AK authorized S14 on 2026-10-13 as the next critical-path step after S13 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1, AC2, AC3, AC4 below (from the #2699 completion criteria).
Issue update assessment: post the path declaration before dependent edits and one concise status at readiness.

# Intent

Used domestic APIs read up to 8 days of grid history, yesterday/midnight slots and a
20-minute station-minute rainfall window. Legacy collects these inputs for every grid.
server2 may capture only for cells with demand (O-1, O-11), so it must archive legacy history,
capture demand cells without gaps, and keep cells it cannot reproduce on legacy.

- AC1: legacy exports (old v1 and current v2 formats, station hourly/minute) import into S3 with
  provenance, every export revision is retained, and reading them back yields byte-identical
  documents and the legacy read projection of current rows. History inputs for the 192-slot
  window, the prior-day 00:00 (`2400`) attribution, the yesterday slot and the 20-minute minute
  window are selected from exports and captured records without revision loss.
- AC2: never-requested, resumed-after-more-than-8-days and partial-history cells resolve to
  complete inputs only when exports and continuous captures cover every required publication;
  otherwise they resolve to legacy forwarding with the missing items named. No grid hour is
  invented and ASOS never substitutes for a grid hour. Durable demand records contain only grid
  identity, last-demand time and expiry, reject any other field, and the active demand set is
  rebuilt from S3 after replacement.
- AC3: capture requests only demand cells (request demand within 8 days, aggregated push
  demand) at the recorded intervals: hourly families per publication, a 23-slot backfill for new
  or resumed demand, national station pages hourly and the minute page every 2 minutes while any
  demand exists. Capture runs under S08 budgets and a per-tick cap, skips publications already in
  S3, has one owner per process and publishes through S06 (O-9). Missing unrecoverable inputs
  keep the affected requests on legacy and are reported as a cutover blocker, not an accepted gap.
- AC4: all added/modified paths match `server2/config/tasks/S14.json`; outside changes are
  limited to the declared documentation; no runtime dependency reaches legacy files.

In scope: `server2::history` library (demand state, schedule, capture runner, coverage index,
coverage decision, legacy export import and read projection), offline mongoexport converter and
loopback-only importer under `server2/tools/migration/`, fixtures and tests, a release-mode
functional smoke with loopback provider and S3 peers, a quota/coexistence estimate, the server2
design text, commit/push, PR, CI and independent review/correction. Code, tests and SDLC
evidence may pass to the configured Codex reviewer.

Out of scope: route wiring and response assembly, including parsing captured provider bodies
into legacy rows (S15); push state and its reconciler (S18); route switches (S20); legacy
retirement (S21); legacy-side exporters or any `server/` edit; live provider, production
database or AWS access; deployment, merge, auto-merge or merge queue; reading `.env` secrets;
edits to `plans/issue-2614.md`.

Decisions consumed: O-1, O-11 (demand-limited capture), the cold-cell clarification
(no invented history, no ASOS substitution, legacy fallback), O-9 (publish before success),
O-10 (separate data.go.kr keys).

Risks and open questions: legacy export of production data is an operator action that needs
separate authority; whether production enables ASOS history reads is unknown (if it does, every
affected request stays on legacy); real demand-cell counts and quotas are unmeasured.
