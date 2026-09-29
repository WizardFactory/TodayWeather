# Overseas UV support

AK authorized implementation and issue comments on 2026-09-29. Goal: expose provider current UV and daily maximum to web and existing mobile apps. Scope: VC request/conversion, DSF parse/cache, overseas response, regression/smoke tests and architecture documentation. Preserve all existing fields, units, cache/fetch policy and domestic UV behavior. No widget UI expansion, production deployment, merge or PR publication.

Acceptance: AC1 request includes uvindex; AC2 finite nonnegative numeric UV survives current/daily cache round trip, including zero; missing/invalid values absent; AC3 live equal query cost before/after (separate operator verification if credentials unavailable); AC4 deployed Tokyo response (deployment handoff); AC5 mobile aliases/localized grade and web UV render. Main owns plan issue-2634. Legacy cache may lack UV until refresh; no forced cache invalidation.

## 2026-09-29 pre-merge amendment

AK explicitly requested pre-merge completion. This supersedes the earlier local-only endpoint: authorize scoped commit/push, PR creation/updates, CI checks, corrections, and code/test/evidence review through the already configured Codex/OpenAI and Paseo Claude/Anthropic connections. GitHub account: ak-ongyeol. Only task code, tests and sanitized SDLC evidence may be shared. No new accounts, credential transfer, permission changes, merge, auto-merge, queue enrollment or production deployment. Verify the current alternate-provider GA model and observed medium/auto settings; finish with current merge-ready evidence. Reuse unchanged validated implementation and tests; refresh checks if review changes the candidate.
