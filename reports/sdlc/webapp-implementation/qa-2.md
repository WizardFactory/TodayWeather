# QA-2 corrective independent verification

Verdict: **PASS** for the local executable integration candidate. Proposed HOTL decision: **PROCEED**. This does not establish full mobile parity, production release readiness, deployment or alternate-provider PR review. Keep issue #2558 open.

Candidate: `sha256:184769c5a403bff6971dcd94047847c6dde0f1ded0af7b004174349b47af4e13`; base `87b8855f308611a07897cd3a39c45fefb3088d77`. All 60 file hashes match and the actual changed non-report file set agrees with the manifest. Six files changed since QA-1: domain source/test, App, snapshot state/test and browser regressions. Source remained frozen and read-only during this review; prior QA-1 evidence is preserved.

Context: `/root/webapp_qa`, continuing the independent non-builder OpenAI QA-1 context; main `/root` remains builder. Exact inherited model ID/reasoning effort were not exposed. Assignment, correction report, current build/self-verification/test evidence and actual corrected files were read and acknowledged. Exact input and used production-bundle hashes are in `qa-2.json`.

## Dispositions

| Finding | Disposition | Independent verification |
| --- | --- | --- |
| QA1-F1, stale search submission | RESOLVED | At 390px, fill 부산 and immediately press Enter; actual new bundle navigates to Busan and shows 부산. |
| QA1-F2, delayed geolocation state loss | RESOLVED | Hold location callback, add Busan, use mobile menu to change to F, release Seoul callback; saved state retains Busan + Seoul and F. |
| QA1-F3, corrupt offline snapshots | RESOLVED | Missing savedAt and null hourly variants each show the recoverable weather-error view, remove the bad record and recover online. No router crash. Valid snapshots still render offline. |
| N1, nationwide city identity (main finding) | RESOLVED | Independent five-city domain fixture retains Chuncheon, Gangneung, Mokpo, Yeosu and Andong names with their distinct values. Missing cityName retains region fallback. Catalog/map source includes Yeosu and Andong and prefix matching supports city suffixes. |

No new mandatory finding arose in this bounded corrective assessment.

## Actual checks

- `npm run typecheck`: exit 0.
- `npm test`: 27 tests/four files passed, exit 0, isolated HTTP listeners under existing managed permission; synthetic upstream and injected push sender.
- Independent domain fixture: exit 0, including five city names/values, fallback and catalog assertions (`qa-2-domain.log`).
- Independent actual Chromium + production demo BFF on port 4188: five correction/compatibility cases passed, exit 0 (`qa-2-browser-verified.log`). Invalid snapshot records were confirmed deleted, all snapshot cases recovered after reconnect, and no pageerror events occurred. No Playwright API interception.
- Main's new 27-test and eight-browser-scenario evidence was read and reused for broader unchanged flows; it was not treated as the independent verdict.

The first reviewer script had a syntax error; subsequent setup attempts targeted links hidden by the mobile layout. Those logs are preserved and are not application failures or intended-red evidence. The successful final script uses the actual mobile menu before opening Settings.

## Limits

The newly rebuilt main production bundle was independently hashed and used; QA did not rebuild it. N1 is verified by source and a fresh isolated fixture, not a fresh external national-data request. QA-1 unchanged reviews are reused. No live provider, real device push, deployment, Docker/Compose, remote CI, native build or alternate-provider PR review was performed. Previous-worker upgrade/rollback and the full supported-device matrix were not dynamically exercised in this corrective pass. Declared parity gates remain open, including conditional weather alerts, actual device delivery, world/air/provider freshness, commercial/native policy and public operations approval.
