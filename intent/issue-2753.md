Task: issue-2753-s10e; owner: Claude builder (S10e worktree); base: origin/master dbf3a4bc; date: 2026-10-15.
Authority: AK decisions of 2026-10-15 relayed by the root coordinator: (1) "SERVER2_DATA_GO_KR_KEYS와
SERVER2_DATA_GO_KR_DAILY_UNITS를 따로 두는게 아니야, server/.env의 값을 legacy와 동일하게 쓰는거야";
(2) "server/.env를 server2/.env로 복사해서 사용"; (3) "server2/.env에 다른 필요한 환경변수를 추가해서
사용해도 됨". Endpoint pre-merge (no merge, auto-merge or queue).
Criteria: AC1 (legacy names configure every native family), AC2 (no removed name is read), AC3
(server2/.env loading and Paseo copy), AC4 (live configuration check without printing values),
AC5 (tests, smokes, placement, artifact policy, documents).
Issue update assessment: path declaration posted before PR; one concise status at readiness.

# Intent

server2 needed about 40 `SERVER2_*` variables for provider keys, quotas, quota owners, provider
URLs, S3 and process tuning, so the operator's legacy `server/.env` could not start it. AK decided
that server2 reads the legacy variable names and values, from a copy of that file at
`server2/.env`, and that only values legacy does not have may be server2 variables. The S10c rules
stay: no runtime mode or verification flag, no endpoint override for tests, and no dependency on
legacy files.

- AC1: an environment with only legacy `server/.env` names, the coexistence routing entries and
  `SERVER2_S3_BUCKET` builds the `geocode`, `dsf` and `kma` families; no other `SERVER2_*` name is
  read.
- AC2: no runtime or migration-tool code path reads a removed name (grep proof).
- AC3: the `server2` binary and the seed importers read `.env` from the working directory with the
  legacy dotenv 10.0.0 rules and process precedence; they never read `server/.env`. Paseo copies
  `server2/.env` into new worktrees with the `server/.env` safety rules. `server2/.env.example`
  lists every variable server2 reads.
- AC4: built in-process from the operator's `server2/.env`, every provider key resolves to a
  non-empty value; no value is printed and no provider is called.
- AC5: workspace tests, clippy, release smokes, the placement gate and the artifact policy pass;
  `docs/architecture/server2.md` and the affected operations guides and PDFs describe the settings.

In scope: server2 configuration loading and wiring, built-in quotas and endpoints, test-only
builders and the `loopback_server` example, smokes, migration tools, `paseo.json` setup,
documentation and PDFs, commit/push, PR, CI and Codex review.

Out of scope: measuring quotas (#2724), AWS bucket creation or IAM changes, production
deployment, cutover, merge, printing or committing secret values, edits to `plans/issue-2614.md`.

Risks: S15b-3b edits `gateway/runtime.rs` in parallel; quota owners derived from keys restart S08
windows; built-in quotas are stricter than legacy where legacy had no budget.
