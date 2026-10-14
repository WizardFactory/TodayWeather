Task: issue-2741-s13b; owner: Claude builder (S13b worktree); revision/base: ae21b6cc6525d4b51fd879469f9b573ebceb4fe6; date: 2026-10-14.
Authority: AK authorized S13b on 2026-10-14 (relayed by the root coordinator); endpoint pre-merge (no merge, auto-merge or queue).
Criteria: AC1 (request arguments and key handling), AC2 (exact records and rejection), AC3 (compatibility and placement).
Issue update assessment: path declaration posted before dependent edits
([comment](https://github.com/WizardFactory/TodayWeather/issues/2741#issuecomment-6167062732)); one concise status at readiness.

# Intent

Legacy master changed two provider sources that server2 follows. #2737 moved the AirKorea dust
forecast (`getMinuDustFrcstDspth`) and station list (`getMsrstnList`) from the retired
`openapi.airkorea.or.kr` host to data.go.kr B552584, and gave every AirKorea operation one key
selection rule that skips rejected credentials. #2740 moved the forecast-zone list from the
retired newsky2 host to data.go.kr `1360000/FcstZoneInfoService/getFcstZoneCd`. The S13a and
S15 decision not to port the two AirKorea operations rested on the retired host, so it no longer
applies. S15b (#2742) reads the resulting raw records.

- AC1: the dust forecast, station list and forecast-zone requests match legacy master in host,
  path, format, paging and key parameters; AirKorea key selection follows legacy `withKeys`.
- AC2: recorded fixtures produce exact raw records of kinds `airkorea-dust-forecast`,
  `airkorea-station-list` and `forecast-zone` (source `data-go-kr`); gateway error bodies,
  quota/auth codes, provider error codes, invalid items and incomplete pages never become records.
- AC3: existing S13/S13a tests pass, adapted only where legacy master changed the asserted
  behavior; the newsky2 path is removed; the S04 placement gate passes for
  `server2/config/tasks/S13b.json`.

In scope: library code under `server2/src/domestic/` and `server2/src/providers/`, fixtures with
provenance, loopback provider and S3 test peers, tests, a release-mode smoke, the server2 design
text, commit/push, PR, CI and Codex review/correction.

Out of scope: capture scheduling (S14), store answers and nearest-station selection (S15b),
`getNearbyMsrstnList` (no current legacy caller), runtime wiring or settings, live provider
calls, AWS, deployment, merge, secrets and edits to `plans/issue-2614.md`. No runtime mode,
dry-run or verification flag is added (AK, 2026-10-13).
