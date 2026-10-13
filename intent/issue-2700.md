Task: issue-2700-s15; owner: Claude builder (S15 worktree); revision/base: 87ab79cd (origin/master, S14 merge); date: 2026-10-13.
Authority: AK authorized S15 on 2026-10-13 after S10-S14 and S13a merged (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC5 below (from the #2700 completion criteria).
Issue update assessment: post the path declaration and split before dependent edits, and one concise status at readiness.

# Intent

The used v000903 KMA routes (`/v000903/kma/addr/...` and the `/weather/v000903/coord/...`
gateway path) assemble about 37 order-dependent legacy middleware steps over stored KMA rows,
station observations, air, life-index, rise/set and warning inputs. server2 must reproduce every
used field byte for byte before the KMA family can move off legacy.

- AC1: `server2::domestic::kma` ports the v000903 middleware order and assembly from the legacy
  store-read boundary (rows and dependency results as legacy controllers receive them). All S02
  v000903 KMA goldens match byte for byte: the 16 direct-route cases (bodies and their Express
  ETags) and the 5 gateway domestic v000903 wire cases. This includes locales/units, `(null)`
  units, DB 1.0 rows, #2620 slot-hour POP replacement, missing-hour POP retention, whole-percent
  POP, old rows without `pop`, never-requested/partial/resumed history, yesterday and
  local-midnight comparisons, 8-day daily rows and warning `specialInfo` (S12).
- AC2: the KMA family is a native S10 backend handler for v000903. Legacy stays the default and
  the rollback. In native mode, a request whose inputs a source cannot supply (S14 coverage
  `Legacy`, unknown town, non-Korean coordinate redirect, unsupported region parameters,
  unavailable source) is forwarded to legacy inside the gateway deadline; nothing is invented.
- AC3: AirKorea `getMinuDustFrcstDspth` and `getMsrstnList` stay unported. The goldens show the
  forecast and station-list fields absent, the port reproduces that and calls no AirKorea
  forecast or station-list endpoint.
- AC4: the O-2 checkpoint records measured assembly time, peak RSS and CPU for the golden
  workloads (local and Linux CI) without changing gateway deadlines. Rust adoption is settled;
  this is a correctness/performance record, not a language decision.
- AC5: all added/modified paths match `server2/config/tasks/S15.json`; outside changes are limited
  to the declared documentation; no runtime dependency reaches legacy files.

In scope: the assembly library with an explicit input contract, the native backend handler and
source trait, a dispatcher forward-to-legacy outcome, golden parity tests, a release-mode
checkpoint measurement, the existing release smoke (unchanged), the server2 design text, commit/push,
PR, CI and independent review/correction. Code, tests and SDLC evidence may pass to the
configured Codex reviewer.

Split (proposed to AK in the PR and the report): the S02 goldens are defined at the legacy
store-read boundary, so assembly parity is provable there. Building those inputs at runtime from
S3 (parsing S13/S13a raw records into legacy rows, reading S14 history/legacy exports, station
selection, AirKorea/life-index/KASI/MFDS/warning store reads, and the request-time RSS/mid/life
acquisitions) is a second, separately reviewable task ("S15b"). Until it lands, the release binary
does not register the native KMA handler and adds no runtime mode; v000903 KMA stays on legacy.

Out of scope: S15b input sourcing; older KMA versions, nation and town (S17); route switches
(S20); legacy retirement; any `server/` edit; live provider calls, AWS, deployment, merge,
auto-merge or merge queue; reading `.env` secrets; edits to `plans/issue-2614.md`.

Decisions consumed: O-1/O-11 (history coverage keeps cold cells on legacy), O-2 (Rust adopted;
checkpoint only), O-7/O-8 (current active behavior), O-9.

Risks and open questions: AirKorea dust-forecast/station-list are not ported (AK, 2026-10-13,
#2729); S15b must select the nearest station from ported station coordinates. The air provider fallback, KASI/MFDS/life-index stores and
station observations are inputs supplied by S15b; local timings are not production latency.
