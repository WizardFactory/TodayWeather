Task: issue-2701-s16; owner: Claude builder (S16 worktree); revision/base: 1d60f728 (origin/master); date: 2026-10-15.
Authority: AK authorized S16 on 2026-10-15 (relayed by the root coordinator); endpoint pre-merge (no merge).
Criteria: AC1-AC5 below (from the #2701 completion criteria and the #2614 "Daily summaries" section).
Issue update assessment: post the path declaration before dependent edits and one concise status at readiness.

# Intent

server2 keeps raw provider records in S3 without deletes, but a "same time last year" comparison
needs a compact daily answer per location that survives for at least three years. AK's O-13
decision authorizes storing those daily summaries and an internal last-year fallback now;
exposing them in a response (new API version, app UI) stays a separate product decision.

- AC1 (grid): a grid summary is the legacy `getPastMid` day summary of the town, computed from
  exactly the inputs the native v000903 assembly has at `getPastMid` (grid current, ultra-short
  sky repair, station and city corrections, ASOS history recovery). The `00:00` hour belongs to
  the previous day. A day is complete with at least 18 of 24 valid `t1h` hours; incomplete days
  are not stored.
- AC2 (ASOS, VC): an ASOS summary is complete when the station's daily minimum and maximum
  temperatures are valid and ordered (rain optional). A VC summary is complete when hourly
  temperature covers at least 75% of the actual local hours of the date (23/24/25 under DST).
- AC3 (late inputs): summaries are computed only from complete published input groups and a
  fully read input set; a later published input recomputes the day and stores a new revision
  that records its exact input identities. A partial or failed read stores nothing.
- AC4 (lookup and retention): the internal last-year lookup tries the same date, then the
  nearest dates ±1..±3, and at each date the grid summary, then ASOS (fetched on demand from
  data.go.kr when missing), then VC. Summaries are written once per revision and never deleted
  (at least three-year retention); no new public field, version or UI is added.
- AC5 (placement): all added/modified paths match `server2/config/tasks/S16.json`; outside
  changes are limited to the declared documentation; no runtime dependency reaches legacy files.

In scope: `server2::summary` (model, S3 layout and transport, grid/ASOS/VC derivation, recorder,
lookup), the capture of the `getPastMid` day summaries in the KMA chain, the snapshot's
input-completeness record, runtime wiring with the `kma` family, tests and fixtures, one live
ASOS check, the `docs/architecture/server2.md` section, PR, CI and review.

Out of scope: any response field, API version or app UI (O-13); grid summaries for towns that
are not requested (no pre-collection, AK 2026-10-14); VC provider calls for summaries; edits to
`server/` or `plans/issue-2614.md`; deployment, merge or production S3 writes.

Decisions consumed: O-13 (summary storage only), D6/O-4 (summaries for at least three years),
AK 2026-10-14/15 (no legacy dependency, no pre-collection, 3-second request wait, ASOS on demand).

Risks and open questions: summary keying by town (grid answers depend on the town's stations);
revision count per town-day is an estimate until traffic is observed; VC summaries exist only for
cells whose raw VC records were fetched by the world family.
