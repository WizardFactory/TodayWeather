# Implementation plan

1. Add requester assertion and route regression file using existing isolated VC harness, including actual mongoose model casting. Prove red for omitted UV.
2. Add optional valid uvIndex conversion/parse/storage and current/daily response aliases using existing translated KMA grading. Preserve ranges/caches/units; no client build required.
3. Run focused and existing VC regressions. Smoke with fresh isolated Mongo and loopback HTTP plus actual mobile parsers; no collector startup or production calls.
4. Update mobile-api and collection docs and existing request Archify source; validate generated HTML, browser and visual output.
5. Independent fresh-context QA required by SDLC; main alone owns artifacts/counters. Final authorized issue comment records local result and live limitations.

Risks: strict schema drops values; legacy zero helper loses valid zero; translation uses global locale if res omitted; stale records legitimately omit UV. Reject numeric coercion and backfilling missing values. Rollback source patch; additive cache fields require no destructive migration. Local endpoint excludes deployment, commit/push and PR.

## 2026-09-29 pre-merge amendment

AK explicitly requested pre-merge completion. This supersedes the earlier local-only endpoint: authorize scoped commit/push, PR creation/updates, CI checks, corrections, and code/test/evidence review through the already configured Codex/OpenAI and Paseo Claude/Anthropic connections. GitHub account: ak-ongyeol. Only task code, tests and sanitized SDLC evidence may be shared. No new accounts, credential transfer, permission changes, merge, auto-merge, queue enrollment or production deployment. Verify the current alternate-provider GA model and observed medium/auto settings; finish with current merge-ready evidence. Reuse unchanged validated implementation and tests; refresh checks if review changes the candidate.
