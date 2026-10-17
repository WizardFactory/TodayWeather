# Nationwide narrative verification (2026-10-17)

Builder: Codex /root (OpenAI). Base: `2ded7c9a9c007a1709336b22a4605cd7174e6f98`.
Scope: legacy server acquisition/API, pre-merge only. Client presentation and
localization are [#2803](https://github.com/WizardFactory/TodayWeather/issues/2803).
Original [#2798](https://github.com/WizardFactory/TodayWeather/issues/2798) stays open
for separately approved deployed acquisition/readback.

## Executed checks

Environment: macOS arm64, Node24.19.0. Isolated dependencies: async2.6.4,
request2.88.2, express4.13.4, mongoose5.1.2 and mongoose-smoke5.13.23,
mongodb-memory-server-core10.1.4; local mongod7.0.14. No production config loaded.

| Check | Actual result |
| --- | --- |
| New scheduled-acquisition regression before implementation | Intended failure: existing gather returned `skip`, no type5 row |
| `kma-narrative.test.js` green and separate post-refactor execution | 8 tests passed in each execution |
| Same regression under `TZ=America/Los_Angeles` | 8 passed; KST/UTC policy independent of host timezone |
| `kma-warning.test.js` | 18 passed; existing warning/zone/collector scheduling behavior retained |
| `data-go-kr-keys.test.js` | 33 passed; consolidated key conventions retained |
| `kma-narrative-smoke.js` | Passed with real loopback HTTP/request, Mongo and mounted v000903 route; 7 provider requests, 2 stored publications |
| Archify | Schema/artifact/provenance and actual Chrome browser checks passed; light-theme capture visually inspected |
| API manual | Chrome PDF and screenshot created; PDF page and screenshot visually inspected |

Commands and dependency setup are in the [runbook](../../../operations/kma-forecast-narrative.md#local-verification).
The smoke verifies exact stored text, UTC announcement, order4/1/2/3/5, escaped
markup, repeated/new publications, bounded quota exhaustion, preservation after
no-data, cache `max-age=2` at two seconds before expiry, exact24h omission and
unchanged stored warning types1–4. Flash expiry continues to follow its old policy.

Initial smoke attempts failed due to environment/harness setup (sandbox socket
restriction, Date-subclass schema type, Express app versus HTTP server). Those
attempts were not successful product checks or intended Red. The corrected smoke
ran successfully, closed its services and disposable database, and was rerun on
the final source candidate before commit.

## Limits and retention

The issue reports a real provider result at `tmFc=202610161700` including capital
precipitation30–80mm. No complete raw response was supplied. Tests explicitly use
synthetic excerpt text and malicious markup with that reported metadata; they do
not claim complete captured-bulletin coverage. No live provider/production DB,
mobile render/build, deployed overlay, origin/public CDN readback or push send was
performed. Production Mongoose5.1.2 is used for schema regressions; the real Mongo7
smoke needs5.13 and does not establish a production-driver integration result.
CI adds Node16 regression coverage and a real Mongo smoke; local Node16 was absent.

The [editable API manual](../../../operations/kma-forecast-narrative-manual.html),
[PDF](../../../operations/kma-forecast-narrative-manual.pdf) and
[capture manifest](../../../operations/kma-forecast-narrative-assets/manifest.json)
are selected durable evidence. Local execution ledgers and diagram recovery remain
ignored; PR review/CI/readiness records are retained in the PR, tied to its head.
No Rust build output was created or cleaned. The isolated dependency directory is
retained while tests/review still consume it. Generated Archify HTML whitespace
is generator output; it was not hand-edited.
