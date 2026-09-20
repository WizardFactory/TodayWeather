# Service architecture intent
Owner: /root. Authority: AK's current request. Endpoint: local working files.
Explain the checked-out TodayWeather/TodayAir service with special emphasis on weather ingestion and mobile requests. Make the findings reusable by readers and coding agents.
AC1: Evidence-linked overall components, runtime modes, persistence and external boundaries.
AC2: Detailed schedules, fetch/normalize/persist operations, retry and failure behavior, and historical vs active collection paths.
AC3: Mobile entrypoints, URL/query construction, cache/retry behavior, API assembly, and missing gateway wiring stated explicitly.
AC4: Three Archify diagrams with JSON, delivery/browser/visual evidence; canonical AGENTS.md plus a thin Claude adapter, verified for representative tasks.
Exclude product changes, external API calls, credentials, deployments, skill installations, commits and remote publication. Current source is evidence of implementation, not live infrastructure or provider availability.

## 2026-09-20 amendment: AWS/code correlation
AK supplied an AWS architecture report and requested review against code and integration into this analysis. Subsequent explicit authorization permits necessary read-only AWS CLI access with the existing account 141248341265 credentials at ~/workspace/TodayWeather/.aws/credentials. This supersedes the earlier no-external-requests limit only for required read-only AWS queries and retrieval of deployed Lambda source. No AWS/resource/config mutations, credential-file changes, Lambda invocations, SSH/SSM execution, app probes, publishing, commits or deployment are authorized.
Continue AC1–AC4: connect verified DNS/CDN/API routing and deployed source to repository call paths, contrast cache and KAQ schedules, update diagrams/shared guidance, and clearly label current AWS control-plane evidence, supplied snapshot, checked-out source, downloaded Lambda source and unresolved runtime behavior. Keep outputs local and exclude credential literals, signed download URLs and environment values.
