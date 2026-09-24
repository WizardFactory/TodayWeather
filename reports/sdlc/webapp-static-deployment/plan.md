# Implementation plan

1. Add transport/deployment regression tests and capture intended failures.
2. Implement browser transport and explicit configuration; keep optional proxy mode and default dev static.
3. Serve production assets using a static-only harness; adapt existing browser regressions to raw upstream fixtures and add no-BFF/error/search proof.
4. Add CloudFormation and safe dry-run deployment tooling with app.tdywx.xyz runbook; update CI and current architecture/Archify artifacts.
5. Typecheck, all unit/API tests, production build, static browser suite, deployment/template and diagram validation; bounded live browser smoke when available. Independent QA verifies frozen candidate; fix substantive findings.
6. Commit and push feature branch, inspect remote CI. No merge, DNS/resource mutation or upload to production.

Riskiest boundaries: double unit conversion, offline demo/network semantics, late geolocation IDs, optional notification cleanup, SPA fallback masking API/assets, cache headers and mixed-version uploads. Preserve existing fixture/provider timestamps and last-known screenshots separately.
