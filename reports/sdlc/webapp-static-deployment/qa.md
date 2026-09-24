# Independent static deployment QA

Verdict: **PASS / PROCEED** for the frozen local candidate. No required source changes identified. This is independent implementation verification, not cross-provider PR approval, deployment confirmation, or merge readiness.

## Candidate and isolation

- Candidate: `sha256:3e4f4b7cb4083344b0c836fd1edec91f562c8fc0674ec09bd80665af0adeab88`.
- Manifest SHA-256: `8ae1861a1dc0c8fe97ff6c51255af33e75ccff43e8ef8df4f4a7e57a374e153a`.
- All 27 changed source/test/config/document files match the manifest; tracked/untracked source diff scope matches exactly.
- No changes to `client`, legacy `server`, `tw.ios`, `ta.ios` or `applewatch`.
- Verifier `/root/static_qa` changed no source, tests, generated app bundles or shared SDLC state. Only these QA reports and isolated `/tmp` probes were written.

## Independently executed checks

- `npm test`: all **52** tests passed, including legacy domain/API/notification/storage compatibility and new direct transport/static hosting checks.
- `npm run typecheck`: passed.
- Actual production build served by the static-only server: all **14 Chromium scenarios** passed. External weather/geocode replies are raw synthetic fixtures; the fixture also rejects any `/api/` request. Coverage includes units/settings, mobile favorites/location, offline recovery, malformed snapshots, worker upgrade/first claim, external error recovery and freeform geocoding.
- Additional isolated uploader execution probe substituted a fake local AWS CLI: a matching destination produced 14 ordered calls (read guard, assets before shell, index before worker, invalidation last); alias mismatch stopped before upload; the first synthetic asset failure stopped before shell/invalidation. **No real AWS call or mutation occurred.**

The initial default-sandbox execution probe was unable to spawn Node (`EPERM`). The authorized local-only rerun passed; this environment limitation is not treated as an application failure.

## Source and operational assessment

AC1–AC3: Default settings are direct/live. Fixed endpoint mapping performs browser normalization with canonical physical units, selected air standard, JSON/2 MB checks, omitted credentials and abort propagation. Local catalog/capabilities work without backend; static notifications are explicitly disabled. Demo/proxy are opt-in, and failed live calls cannot silently choose fixtures. Existing snapshot behavior and proxy deletion semantics remain covered.

AC4: The template defines a new private/versioned S3 bucket, scoped CloudFront OAC reads, supplied us-east-1 ACM certificate, HTTPS policy, optional Route53 app alias, CSP permitting the existing public API, known-navigation function and error responses without HTML fallback. The function source matches its template copy. Uploader defaults to dry-run, rejects unsupported release descriptors, validates destination before writes, retains old assets and orders publishing correctly. The runbook distinguishes artifact readiness from provision/upload, covers DNS, cache propagation and full-artifact rollback, and states static notification/provider limitations.

AC5: Local evidence supports proceeding to the user-authorized commit/push. Main live-browser evidence separately records successful unmocked public reads and no local API requests; it was reviewed rather than rerun by this verifier. Actual remote push/CI results remain the parent agent’s subsequent responsibility.

## Release boundaries

No AWS resources, DNS/ACM records, production uploads or new Node runtime were created by this QA. CloudFormation syntax validation and local simulation cannot certify actual deployed bucket policies, edge propagation, app.tdywx.xyz CORS or installed iOS/Android behavior. The optional proxy runtime is covered by unit/API contracts, not the static browser suite. Existing stale/missing provider data and unavailable static web push remain disclosed limitations.

Evidence: [unit/API](qa-tests.txt), [typecheck](qa-typecheck.txt), [browser](qa-browser.txt), [uploader probe](qa-upload-probe.txt), [structured result](qa.json).
