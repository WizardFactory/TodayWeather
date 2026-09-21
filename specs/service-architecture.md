# Architecture documentation specification
Inputs: intent/service-architecture.md and reports/sdlc/service-architecture/investigation.md.
AC1: Describe logical components, mode startup table, persistence, platform variants and historical deployment evidence, with relative source links and no live-topology claims.
AC2: Explain UTC schedule, LIFO/direct dispatch, KMA request/parse/save versions, retries, scrape timing, auxiliary data, DSF/AQI request-time cache and legacy collector boundaries.
AC3: Enumerate current client methods/URLs/queries, locate external gateway mismatch, detail KMA/DSF middleware and response conversion, cache/retry/error behavior and widget divergence.
AC4: Deliver English Archify overview/collection architecture and mobile sequence JSON+HTML, 9/9 showcase validation, real desktop browser measurements and perceptual review. Root AGENTS.md is canonical, root CLAUDE.md imports it without common-rule duplication. Link docs from README.
Preserve app code. No provider calls, production startup, config replacement or release commands. Verify local links, source references, diagram receipts and representative agent decisions; browser checks use installed Chromium. Product runtime tests are not applicable to unchanged product behavior.
Alternatives: a single dense diagram would obscure the gateway uncertainty and ingestion/request distinction; use three complementary views.

## AWS continuation acceptance
Preserve AC1–AC4 and source-only archive. Add timestamped, sanitized AWS evidence and a report-to-code correlation document; connect verified deployed Lambda routing, DynamoDB cache and KAQ production to local controllers. Update diagrams and canonical guidance to distinguish live control-plane/deployed source from unverified EC2 runtime. Record address-handler 501, cache layers, schedule mismatch and observed copier failures without asserting provider root cause. No cloud changes or application runtime execution.

## SSH host continuation acceptance
Add ec2-internals.md and sanitized host evidence. Trace nginx public80 -> loopback3000 ->10PM2 cluster workers -> observed configured Mongo endpoint16652. Identify boot/logging/deployed checkout, file parity and effective config derived from static source plus PM2 override absence. Do not claim remote Mongo process/query success or gather-host verification. Update obsolete service-host unknowns in existing documents/guidance and AWS/service/mobile views; add internal diagram. Preserve historical AWS snapshot, key ignore rule, all HTML/JSON and PNG-only ignore behavior. No runtime changes or provider probes. AC1–AC4 continue.
