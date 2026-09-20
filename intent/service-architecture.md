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

## EC2 SSH amendment — 2026-09-20
AK explicitly authorized connection to ec2-user@ec2-13-124-25-12.ap-northeast-2.compute.amazonaws.com using local .aws/aleckim.pem and requested internal architecture analysis, documentation update, and added/refreshed diagrams. Necessary remote filesystem/process/socket/configuration inspection is authorized read-only, including noninteractive privileged reads if available. No host changes, app/database/provider probes, daemon/process starts, deployment, lateral SSH or secret disclosure. Preserve private key and current user changes. AC1 adds observed host topology and deployment identity; AC2 distinguishes active workers from source-only collectors; AC3 traces public port through host proxies to processes/database; AC4 adds host diagram and refreshes affected views with artifact/browser/perceptual verification.
