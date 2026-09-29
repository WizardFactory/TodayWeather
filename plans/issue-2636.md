# Execution plan
Owner: primary Codex. Inputs: intent, spec, investigation. Endpoint: pre-merge.

1. Add offline fixtures and isolated harness for supported AirKorea requester, parser, storage acknowledgements and nation fallback. Retain intended failing tests.
2. Add a dependency-injected, bounded AirKorea observation API module; wire only station/sido collection in kecoRequester. Add pure strict KST time helper, retain data/grade shapes, reject invalid batches, await province writes and log sanitized outcomes. Preserve unrelated forecast/metadata paths.
3. Add nation air service with fixed representative city mapping and existing airFallback API; bounded fanout and whole response deadline; attach provenance and status. Distinguish DB read errors from missing rows through additive controller callback metadata. Route uses service then existing unit conversion.
4. Run tests in UTC and non-KST zones, existing air/freshness/gather suites; run separate loopback HTTP + local Mongo collection and nation smoke. Update CI explicit offline runner and smoke job as required.
5. Update collection/mobile architecture, Archify JSON/HTML and controlled operator runbook. Verify diagram artifacts/browser/captures; verify docs/links and no credential contents.
6. Independent cross-provider verification and review using configured Paseo Claude Opus 5.5, medium, auto if actual execution is eligible. Fix mandatory findings with repeated affected tests/smoke.
7. Commit/push scoped branch, create/update PR, verify CI/current head/base/no auto-merge and record readiness. Never merge or deploy.

Blast radius: station/sido collectors and shared nation route versions. Riskiest changes: complete envelope validation and KST BSON dates; fallback point must not masquerade as province mean. No storage migration or changed coordinate fallback.
Rollback: prior code revision; disable affected gather tasks through existing task policy if current provider requests fail; no deletion of existing records. Nation rollback removes fallback entrypoint without touching shared cache. Full operator procedure recorded before handoff.
Proof: rejected payloads produce zero writes; bounded timed transport aborts; acknowledged station+aggregate rows read through real nation middleware yield correct chosen-unit grades; no fallback calls for fresh AirKorea; partial failure retains weather; late callbacks do not mutate response. Live entitlement/scheduled/device recovery remains separately authorized.
