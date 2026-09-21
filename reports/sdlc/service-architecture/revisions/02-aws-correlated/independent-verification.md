# Independent verification — AWS/code correlation revision

Verdict: **PASS**. All four findings below are resolved; no unresolved Must Fix finding remains.

Verifier: `/root/architecture_verification`, the existing independent native-agent context, distinct from builder `/root`. Base/HEAD: `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`. Final candidate: `sha256:db0c828e4bacdb6f24e035e617cc1f643971d363bf67e073f1ebecbfb7ae2597` (19 primary files, individually rehashed by this verifier).

Scope: independently review changed documentation, sanitized AWS evidence, deployed business excerpts, shared guidance and diagrams against local source. This verifier made no AWS call, opened no credentials or private deployment bundle/configuration, invoked no application/provider/Lambda, and changed only this report. Main owns shared SDLC ledgers. The user's read-only AWS authorization covers the builder's evidence collection; it does not imply cloud write or runtime-probe authority.

The [original independent report](revisions/01-source-only/independent-verification.md) remains the evidence for unchanged source-only assertions and prior isolated VM executions. Its obsolete missing-gateway conclusion is superseded by this report and the timestamped AWS evidence. Original retry/scheduler checks were not relabeled as newly run.

## Acceptance assessment

| Requirement | Result | Evidence and scope |
| --- | --- | --- |
| AC1 architecture | PASS | Reconciled sanitized CloudFront origin/behavior records, Route53 configured records, service-instance public IP match, API deployed export, function metadata and selected target settings. Diagrams separate configured/deployed-source routing from unknown EC2 process/revision/database wiring. DynamoDB geocode cache is correctly outside Express/Mongoose inventory. |
| AC2 collection | PASS | Compared EventBridge rule/target and recorded copier source with repository Manager and KAQ consumer. Confirmed producer minute 5/hour 23 versus consumer minute 7/hour 13, matching S3 naming, unverified live bucket, GIF pixel/frame interpretation, station hourly forecasts and separate map-case writes. Log symptom is distinguished from unknown OCR cause. |
| AC3 client/API tracing | PASS | Exact eight GET paths now match exported parameter names; deployed excerpts establish KR KMA-address/world DSF-coordinate selection, version precedence, query forwarding, language extraction, 3-second/three-attempt backend retry, geographic enrichment and address-handler application 501. HTTP success caches are distinguished from coordinate record expiry, address cache behavior, stage cache and app memory gate. |
| AC4 artifacts/instructions | PASS | 150 local links; 36/36 showcase checks; all four source/HTML/browser bindings current; four viewports each. Three changed diagram captures independently inspected. Canonical entrypoint resolution rerun and three representative decision evaluations repeated below. |

## Findings and reviewer resolution

All findings were sent to the builder before final approval. Severity here reflects mandatory source/evidence accuracy, not a production incident classification.

| Severity | Category | Location | Finding / evidence / impact | Reproduction | Requirement | Confidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LOW | Exact contract | aws-code-correlation.md and mobile-api.md path tables | Coordinate API parameter was documented as `{geocode}`, while exported routes and deployed handler use `{loc}` / `pathParameters.loc`; this could misdirect handler edits. | Compare eight export GET paths and coord2geoInfo excerpt. | AC3 | High | RESOLVED: all exact public route entries now use `{loc}`. |
| MEDIUM | Cache semantics | aws-code-correlation.md cache prose/table | 30-day record expiry was described as a general Lambda DynamoDB policy; excerpt shows `_isExpired` only on coordinate cache hit and no such address-hit check. | Compare coord2geoInfo and addr2geoInfo branches. | AC3 | High | RESOLVED: coordinate-only expiry and absent established address expiry are explicit. |
| MEDIUM | Evidence provenance | aws-code-correlation.md timeout claim; AWS JSON | Claimed 29-second API timeout had no support in deployed export (`timeout_ms=null`). | Compare original export and added current-resource records. | AC1/AC3 | High | RESOLVED: sanitized `current_resource_integrations` now records 29000ms for eight GET integrations with get-resources --embed methods provenance; document explicitly distinguishes current resource configuration from deployed-stage export omission. |
| MEDIUM | Collection/data semantics | AWS/collection documents and KAQ diagram | KAQ consumer output was called image metadata; main path decodes GIF frames/pixels into station hourly pollutant forecasts and upserts them, with separate map-case records. | Trace do -> _updateModelImgList -> _updateModelImg -> _updateHourlyForecast -> _updateDustInfo -> _updateForecastList -> _updateDb; inspect image parser/controller. | AC2/AC4 | High | RESOLVED: prose describes forecast derivation and persistence; diagram says GIF pixels to forecasts / Station hourly forecasts, regenerated and rechecked. |

## Independent checks actually executed

1. `python3 reports/sdlc/service-architecture/guidance-check.py`: exit 0, including final candidate. `CLAUDE.md` is exactly `@AGENTS.md` and resolves the same canonical file. Required common rules and navigation links remain present.
2. `python3 reports/sdlc/service-architecture/document-check.py`: exit 0 on final candidate. Observed output: 150 local links, four evidence source/spec/HTML/browser bindings, 36 showcase checks, original product files and README content preserved.
3. Additional independent Python sweep over AGENTS/CLAUDE/root README and all architecture Markdown: 150 local links exist. Recomputed SHA-256 of every one of the 19 candidate files; all match candidate.json. Independently checked all four browser receipt artifact hashes against actual HTML and 16 passing viewport measurements. This inspected builder browser execution receipts; it was not a second browser launch by this verifier.
4. Additional evidence assertions (exit 0): all eight exported GET paths appear exactly in correlation prose; eight current-resource integrations have 29000ms; API stage cache is disabled; all five recorded AWS base64 `CodeSha256` values decode to their declared downloaded ZIP hex hashes; final mobile sequence has eight messages. ZIP consistency is an internal declaration check, not independent re-download or hashing of private ZIP files.
5. Read deployed business excerpts: `_geoinfo2url`, `_makeUrls`, `_requestRetry`, `byCoord`, unsupported `byAddress`, response wrapper, coordinate/address cache branches, `_getDate`, `_getDateOfKaqfsImage`, upload/list and retry methods. Compared them to sanitized control-plane targets and repository route/consumer names. Claims requiring omitted bundled defaults/provider adapters rely on builder's timestamped deployment inspection and selected evidence; this verifier did not inspect full bundles.
6. Read repository KAQ controller through do/update/query paths, relevant image-controller pixel conversion, Manager UTC schedule and configured bucket variable names. No modules were loaded, jobs drained or product endpoints called.
7. Independently viewed final service overview 1440x900 dark, mobile sequence 2048x1320 light, and corrected KAQ pipeline 1440x900 dark screenshots. Observed readable main paths/cards, no clipping or overlaps, no duplicate mobile return, appropriate unknown-runtime labels, corrected forecast output and dashed unverified bucket/database edges. Other viewport/theme inspection remains builder evidence. The unchanged domestic collection artifact retains earlier verification.
8. Narrow sensitive-pattern scan over AGENTS, architecture Markdown and sanitized AWS JSON found no AWS access-key ID pattern, private-key block, JSON private_key field or signed-download URL signature. Manual review found sanitized routing/resource identifiers and selected nonsecret settings rather than full environment maps or raw logs. This is not an exhaustive secret-detector guarantee.

Final observed command output:

```text
PASS: 150 local links; 4 evidence sources/specs/HTML/browser bindings; 36 showcase checks; original product files and README content preserved.
PASS: Codex AGENTS.md and Claude @AGENTS.md resolve one canonical source; required rules and links present.
INDEPENDENT_FINAL: 19 candidate file hashes, 150 local links, 4 matching browser receipts / 16 viewport measurements PASS
```

## Changed-evidence interpretation

The sanitized evidence timestamps cover the stated 2026-09-20 observation. DNS configuration and IP equality support the configured service destination; they do not verify nginx/listener or a running repository revision. The deployed export supports route-to-Lambda mapping; separate current-resource configuration supports the timeout claim without pretending that omitted export fields were observed.

Recorded metric sums are weather 5169 invocations/0 Errors/0 throttles and copier 24 invocations/24 Errors/0 throttles in the precise recorded window. Forty first-page matching log events, with pagination remaining and 32 recognized `_getDate` frames, are not forty distinct invocations. `_getDate` dereferences the first text annotation's description; the error localizes the symptom but does not prove why OCR was empty. Application HTTP 501 is returned through a successful Lambda callback, so zero Lambda Errors does not prove HTTP success. No runtime/root-cause repair claim is made.

## Separate behavioral evaluation of shared instructions

Method: read current AGENTS.md directly and through its exact CLAUDE.md import, run the actual filesystem resolution checker, and independently choose actions for each simulated task. The following are actual decision evaluations in this verifier context, not a real Claude CLI launch, host discovery execution test, cross-provider review or live provider test.

- **Change mobile coordinate API:** select Korean communication, preserve existing changes, shared SDLC intake and architecture index/mobile/AWS evidence navigation. Trace WeatherUtil, timestamped CloudFront/API mapping, deployed weather excerpts, local KMA/DSF routes and widget variants. Treat gateway implementation as outside checkout but configured routing as evidenced; preserve unversioned v000901 versus explicit v000903, address 501, units, lat/long ordering, middleware/storage compatibility. Recheck deployment evidence when needed within read-only authority and never infer EC2 revision. Use isolated relevant regression/functional checks and update Markdown/JSON/generated artifacts. Both entrypoints select the same actions: PASS.
- **Investigate collection freshness:** select weather-collection, AWS correlation, Manager/KAQ controller and parser paths. Separate producer EventBridge minute 5, repository consumer minute 7, 23/13-hour mismatch, copier OCR errors, S3 path compatibility and unknown live bucket/mode. Inspect timestamps/log summaries rather than assuming S3 upload implies forecast persistence; trace GIF-to-station forecast conversion. Do not call gather endpoints, invoke Lambda, start local default collection, SSH/SSM or change cloud configuration under read-only authorization. Both entrypoints select the same actions: PASS.
- **Install shared skill:** select one canonical repository/user `.agents/skills/<name>` copy, preserve existing content, link both CLI directories, configure any required hooks in both and verify discovery/execution in requested scope. Do not duplicate common guidance or claim Claude execution from the adapter alone. This remains a simulated task; the current documentation/AWS authority does not authorize an installation. Both entrypoints select the same actions: PASS.

No contradictory action was found between the canonical guidance and thin adapter. Old statements that gateway wiring was wholly unverified have been replaced with date-bound configured/deployed-source evidence while retaining EC2/provider limitations.

## Limits and reused evidence

This is independent local verification in a separate agent context, not cross-provider PR review. No actual Claude process, AWS call, live endpoint/provider invocation, database, deployment, device build, EC2 host inspection or current S3 freshness check was performed by this verifier. AWS assertions were checked against builder-supplied sanitized receipts and deployed excerpts, not re-queried. Product runtime was unchanged; original source-only checks and exact commands remain archived. No new isolated VM execution was necessary for unchanged client retry/scheduler functions. Final PASS applies to this exact documented candidate and its stated evidence limits.

## Inspected candidate SHA-256

| File | SHA-256 |
| --- | --- |
| `AGENTS.md` | `f0f2bb366e79e501555aaa345d0dbdbfa30970fb7e21263db82d13b02895379c` |
| `CLAUDE.md` | `336cc4fbf19beaada7ccf9986414fa91851a8d7a07dfb3ccbe800a69eed0ab49` |
| `README.md` | `1ea5502e5f3de422d883c74520ccae6c5da2176370ac8705cf492c4eccfe6325` |
| `docs/architecture/README.md` | `23c0e19ada06f2f14c8999134705eeaeaf39003cde13be9281b6f6aea963a39c` |
| `docs/architecture/aws-code-correlation.md` | `ee10495d268352ed9fb269371e8471df01aacbdf5d672a7e9cc1d76672e70f69` |
| `docs/architecture/deployed-lambda-excerpts.md` | `94ac6ed16215d4a2a8fca3430e80e9109bd22015d89490327204cce4f7b8f08a` |
| `docs/architecture/evidence.md` | `5eae709ad663d3f89258e0b958119680542208e78e2cbdf3bd309d0c47403052` |
| `docs/architecture/mobile-api.md` | `9ba4799749270d4f4e4e418d3902618777405b6c283bb53faf31c2e8cd9a5382` |
| `docs/architecture/service-overview.md` | `44a243823f18a2aff2d36428082650ee022963b8e48e3edd73350abd9234e7f5` |
| `docs/architecture/weather-collection.md` | `9cfed69ebcc78e7f4c5a909157ce71fdfae1052f6a6ccc81803ce2db039b7559` |
| `docs/architecture/aws-readonly-evidence-2026-09-20.json` | `cb40d6b2b0a00b4e0f0ca04137c3c83a7fe0b2e4ff9b4b6666a7b3a23f0d96a3` |
| `docs/architecture/diagrams/service-overview.json` | `137046ea44a8c48f82c1e72797a42b260f3a0179338ab3632cb2e25a022856bc` |
| `docs/architecture/diagrams/service-overview.html` | `bcbc0772a90d226c220e7bc7eda964b5fec3a6de539a7cee9ce7a1b79b293ca8` |
| `docs/architecture/diagrams/weather-collection.json` | `49e34714eee6f5829190776d36b66a2e60abb66e622292b014606cd4350de838` |
| `docs/architecture/diagrams/weather-collection.html` | `7cdcb106ab5dc887889d0bb4cffc27696dfa6ca52b8c86bf353e876719f56c06` |
| `docs/architecture/diagrams/mobile-weather-request.json` | `fdfdfab5ed5d3aaa108fb7ff1b8e97a6d2628fe9e0d322db6d0a1a219d166db3` |
| `docs/architecture/diagrams/mobile-weather-request.html` | `61c0354a58d8f2d4ce907359ff1b175565167a53745d3361e0d5512e731cf980` |
| `docs/architecture/diagrams/kaq-image-pipeline.json` | `472c6d39fbf1836484061c4460e8ba0ce9c8b1427778f30c2e453ce2aa96b274` |
| `docs/architecture/diagrams/kaq-image-pipeline.html` | `e3b0825423d7b4bd678d99d0c7e19bc7ac784128155915d3566377836aef2744` |

Final verification UTC: 2026-09-20T14:12:12.240890+00:00
