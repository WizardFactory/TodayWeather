Task: issue-2729-s13a; owner: Claude builder (S13a worktree); revision/base: 45e9193b6a6d6168314eea0c48a6c1bf1c46d6cb; date: 2026-10-13.
Authority: AK authorized S13a on 2026-10-13 (relayed by the root coordinator); endpoint pre-merge (no merge, auto-merge or queue).
Criteria: AC1 (formats and raw records), AC2 (rejection before records), AC3 (live air chain and S3-only restore), AC4 (air privacy), AC5 (compatibility and placement).
Issue update assessment: path declaration posted before dependent edits
([comment](https://github.com/WizardFactory/TodayWeather/issues/2729#issuecomment-6143039351)); one concise status at readiness.

# Intent

S13 ported the data.go.kr families that answer `dataType=JSON`. AirKorea, KASI rise/set and
the forecast-zone code service use other response-format parameters, so they were not ported.
S11 kept the legacy "no configured air provider" output because Google, OpenWeather and WAQI
had no S08 funding identity and the air raw storage rule was undecided. AK decided on
2026-10-13 that air raw records are keyed by provider station or grid, never by the user's
precise coordinates. S15 needs these inputs before the domestic and world responses can move.

- AC1: recorded or synthetic (labelled) AirKorea station/sido, KASI area rise/set and
  forecast-zone fixtures produce raw records with the provider bytes unchanged; request
  arguments, including the format and credential parameter, match legacy.
- AC2: gateway error bodies, quota/auth codes, provider error codes, invalid rows and
  incomplete or inconsistent page sets never become records.
- AC3: the world air chain runs in the legacy free order (Google, OpenWeather, WAQI), funds
  each call through S08 before HTTP, marks a provider down after auth/quota rejection, and
  publishes the decisive body before a new success. With providers disabled and empty
  memory, S3 records alone reproduce the S11 air output byte for byte for the recorded air
  fixtures.
- AC4: no air raw key, catalog identity, metadata, body or provider request contains a
  precise user coordinate.
- AC5: S11/S12/S13 tests pass unchanged; the S04 placement gate passes for
  `server2/config/tasks/S13a.json`; native families stay off by default.

In scope: library code under `server2/`, an opt-in loopback-only air wiring of the local world
runtime, fixtures with provenance, loopback provider and S3 stubs, tests, a release-mode smoke,
the server2 design text, commit/push, PR, CI and Codex review/correction.

Out of scope: route wiring and response assembly (S15), capture scheduling (S14), the paid air
phase (legacy default off), Visual Crossing air, live provider calls, AWS, deployment, cutover,
merge, reading `.env` secrets, and edits to `plans/issue-2614.md`.

Decisions consumed: O-9 (raw PUT and fetch-group publication before a new success), O-10
(separate server2 data.go.kr key set), AK 2026-10-13 air keying (station or grid).

Open questions are recorded in the specification: AirKorea dust forecast and station-list
operations still use the retired `openapi.airkorea.or.kr` host; live response shapes of the
newsky2 zone service and KASI over HTTPS are unverified.
