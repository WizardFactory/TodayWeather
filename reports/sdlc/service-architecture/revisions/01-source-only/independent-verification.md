# Independent verification — service-architecture

Verifier: `/root/architecture_verification`, a separate native agent context from builder `/root`.
Scope: local documentation, diagram semantics, shared instructions, and read-only source/receipt checks. No authored file edits, application startup, provider calls, database access, commits, publication, installation, or further delegation.
Base and inspected HEAD: `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`.

Verdict: **PASS**. No unresolved Must Fix findings or missing mandatory local verification remain. Final candidate: `sha256:316b77b3a5ca92a6f115f396d61bd577b422e768b276bbb5bf105b498f0790cb`; independently recomputed all 14 listed file hashes against `candidate.json`. The builder self-verification artifact now exists and the independent final link sweep passes all 128 targets.

## Acceptance evidence

| Requirement | Result | Independent evidence |
| --- | --- | --- |
| AC1 overall architecture | PASS | Compared Express mounts and startup branches in `server/app.js`, listener/config, v000903 reuse, Mongo/DSF model, widgets and historical Travis/Gulp recipes. Mode controls background workers, not HTTP route visibility; no public weather/geocode rewrite is established. Product tracked diff is empty. |
| AC2 collection | PASS | Read Manager schedule, task drain, self-HTTP, startup/scrape, recursive fetch/save selectors, collection GETs, DSF cache/requester and legacy collector. Checked UTC minute/hour expressions, LIFO pop into async.series, 30-second post-completion delay, 17-task exit, direct dispatch, startup force exceptions, explicit DB versions, request-time DSF/AQI and absent doCollect invocation. |
| AC3 client/API tracing | PASS | Checked client URL/query builders, latitude truthiness, geolocation, canLoadCity, reload and parser selection; exact KMA and DSF router middleware; external geocode retry/redirect; storage and widget constants. Distinguishes ten-minute state refresh from two-second overlapping HTTP timers and per-attempt timeout. |
| AC4 diagrams/instructions | PASS | JSON references exist (15 source references across architecture diagrams); three artifact validations report 9/9 with zero errors/warnings. Browser receipts match current HTML hashes and each has four passing desktop viewports. Independently viewed three representative actual captures. Canonical guidance resolution and three distinct task evaluations are below. |

## Executed checks

- `python3 reports/sdlc/service-architecture/guidance-check.py`: exit 0; Codex entrypoint and Claude import resolve exactly one canonical file, required rules and instruction links present.
- Independent Python Markdown-link sweep over root AGENTS, CLAUDE, README and all architecture Markdown: 128 local targets checked; one temporary missing target, `reports/sdlc/service-architecture/self-verification.md`. JSON walk: all 15 source paths exist. No external URL validation was claimed.
- Final additional executions: `python3 reports/sdlc/service-architecture/document-check.py` and `python3 reports/sdlc/service-architecture/guidance-check.py` both exit 0; independent link/hash sweep also reports 128 targets, zero missing, and all 14 candidate hashes matched.
- `git rev-parse HEAD`: matches declared baseline. `git diff --name-only -- server client tw.ios ta.ios applewatch`: empty. `git diff --check`: exit 0. README diff adds only architecture navigation and preserves existing content.
- Actual-source isolated Node VM evaluation (exit 0): extracted `_retryGetHttp` and `_getHttp` directly from `client/www/js/service.weatherutil.js`, supplied fake timer, `$http` and deferred implementations, and asserted slow attempts at `[0,2000,4000]` milliseconds with 10000ms each. A first error followed by another request's success retained rejected state. Immediate initial error left attempts `[0]`. This is mocked source-function execution, not Angular/device/network integration.
- Actual-source isolated Node VM schedule evaluation (exit 0): extracted `Manager.prototype.checkTimeAndRequestTask`, supplied UTC Date/log/request mocks, enumerated all 60 minutes and 24 hours without running queued jobs. Observed current `[2,12,22,32,42,52]`, keco `[3,13,23,33,43,53]`, kecoSido `[4,14,24,34,44,54]`, shortest `[4,14,48,54]`, short `[13]`, station hit rate `[50]`, sunrise/set `[55]`; healthday enqueued only at UTC09:10. Static inspection separately verifies startup forcing and KAQ hour list including literal 13.
- Reviewed validation receipts for overview, collection and mobile: each `ok=true`, 9 checks, zero composition errors/warnings. Independently recomputed current HTML SHA-256 and matched each automated-browser receipt. Four viewport records each are `ok=true`; do not confuse those records with dark-theme screenshots.
- Independently inspected actual screenshots: service-overview 1440x900 light; weather-collection 1440x900 dark; mobile-weather-request 2048x1320 light. Labels, arrow directions, conditional/provider flow, gateway uncertainty, legend and navigation appear without clipping/overlap. Text is compact at overview scale, with working artifact zoom supplied by the viewer. This is perceptual inspection of existing captures, not a separate browser launch by this verifier. Other screenshots and full browser execution remain builder evidence.

## Findings and resolution

| Severity | Category | Location | Finding and evidence | Impact / reproduction | Requirement | Confidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MEDIUM | Source accuracy | weather-collection.md, KMA persistence item 5 | Original text implied any non-2.0 value used legacy saves. Manager getSaveFunc has only explicit 1.0 and 2.0 branches, no generic fallback/callback. | Could misdirect storage-version investigation; compare Manager 1979–2013. | AC2 | High | RESOLVED: independently reread corrected explicit 1.0/2.0 text and unsupported-value behavior. |
| LOW | Diagram consistency | mobile-weather-request.json conditional-flow card | Original card said “Dashed mapping” but message step-1 uses default solid variant. | Misidentifies visual convention; compare card, message variant and rendered screenshot. | AC4 | High | RESOLVED: card now states unresolved external dependency without asserting dash style; corrected text visible in inspected screenshot. |
| LOW | Artifact completeness | docs/architecture/README.md verification link | Builder self-verification record absent during first link sweep. | Broken local navigation until artifact exists. | AC4 | High | RESOLVED: builder self-verification artifact exists; independent final sweep passes 128/128 local targets. |

## Separate behavioral instruction evaluation

Method: this verifier read the canonical AGENTS.md, resolved the exact `@AGENTS.md` import from CLAUDE.md and executed the resolution check; then independently selected concrete next actions for each simulated request using those resolved rules. The effective repository instruction text is identical through both entrypoints. This evaluation tests decision guidance in a separate context; it is not a real Claude CLI invocation, host auto-discovery integration test, or different-provider review.

### Scenario 1: “Change the mobile coordinate API”

Selected actions for both entrypoints: communicate with AK in Korean; inspect status and preserve unrelated edits; read available shared SDLC policy and use its development workflow. Read architecture index, mobile API and evidence pages, then `client/www/js/service.weatherutil.js`, state/storage consumers, `server/app.js`, v000903 index and KMA router, reused v000902 DSF router, `controllerTown24h.coord2addr` and native widget constants. Distinguish public `/weather/v000903/coord` from implemented KMA/DSF routes and the external geocoder. Do not fabricate gateway routing. Preserve coordinate order, middleware order, units, sentinels, yesterday handling, both storage versions and older/native contracts. Implement in shared client source only when build evidence confirms intended ownership; inspect Gulp before assuming platform copies are disposable. Choose relevant regression plus separate isolated functional checks, inspecting integration tests before execution. Update affected architecture Markdown/JSON, regenerate through installed Archify and validate artifact/browser/visual evidence. Avoid production startup/collection or release/deploy operations without separate scope. Result: PASS; no conflicting canonical/adapter action.

### Scenario 2: “Investigate collection freshness”

Selected actions for both entrypoints: inspect existing changes; read shared policy, architecture index, weather collection and evidence. Trace config/server modes, app startup, Manager UTC due checks and LIFO/direct dispatch, routeGather, KMA requesters/scrapers, publication/cleanup/versioned models and read-time merging. Examine product timestamps and errors, not just HTTP 200; `/gather/current` can return empty success despite logged errors. Check current DSF/AQI request-time caches separately from unwired legacy doCollect. Source inspection suffices for initial investigation; never probe `/gather/*` as health checks. Use `/health` only in an already authorized appropriate runtime context; startup itself can collect in default local mode. Future reproduction uses isolated dependencies and appropriate fixtures with provider/DB prerequisites explicit. Distinguish queue loss, shared-array consumers, UTC/non-modulo hour quirks and stale merge possibilities from measured production incidents. Result: PASS; no conflicting canonical/adapter action.

### Scenario 3: “Install a shared skill”

Selected actions for both entrypoints: inspect and preserve existing skill/config/instruction state; use repository `.agents/skills/<name>/` or user `~/.agents/skills/<name>/` as the single canonical copy according to requested scope. Link both Codex and Claude skill directories, configure any required hooks in both CLIs, verify discovery and execution in the intended scope before claiming completion. Keep CLI adapters thin and avoid duplicating shared guidance. Read applicable installer/creator skill and shared policy. Do not overwrite preexisting canonical content or claim Claude execution from links alone; unresolved execution capability must be reported. The simulation authorizes no installation in this documentation task, so no skill/hook mutation was performed. Result: PASS; no contradiction between canonical AGENTS and its one-line adapter or shared user instruction.

## Limitations

This is a local independent evaluation by a distinct agent context, not a cross-provider PR review. No real Claude session was launched. No application runtime, live provider, database, mobile build, deployment, gateway, production topology or present provider viability was verified. Existing product integration tests were not run; unchanged product code is verified by diff, and the isolated VM checks cover only extracted functions with mocks. Automated browser receipts were examined and bound to hashes, not independently regenerated. The builder owns shared SDLC stage ledgers and final completion.

## Inspected candidate hashes

SHA-256 at report generation; documentation/JSON/HTML changes after this list require corresponding reevaluation.

| File | SHA-256 |
| --- | --- |
| `AGENTS.md` | `8082585dfb4f5c5d86f1e31d2decb93bce4bc254b2ca167619f6677e3fc13b20` |
| `CLAUDE.md` | `336cc4fbf19beaada7ccf9986414fa91851a8d7a07dfb3ccbe800a69eed0ab49` |
| `README.md` | `1ea5502e5f3de422d883c74520ccae6c5da2176370ac8705cf492c4eccfe6325` |
| `intent/service-architecture.md` | `6c1ef44b64df7c188987482e8a017f6e7d1edebf7cfcdbea4b5638e7966a30b0` |
| `specs/service-architecture.md` | `51b9929c862b1be592954c69a66684a42131f3d38baecbbea1b98468b91fb25c` |
| `plans/service-architecture.md` | `c992a95421bf0fa4b1994a2b5ecf2d7c40ab13e2b285847f6cb5552ed8d93b4f` |
| `reports/sdlc/service-architecture/test-plan.md` | `4c816e27b3932916bccc7cee6f9cb9f06ec5b593724dfc6aa6763b39b055dbe6` |
| `docs/architecture/README.md` | `f6ac7bdf5378794d5086fe03867a200166b251a30a8d49bd583379bd416c63d4` |
| `docs/architecture/evidence.md` | `ad5f25e99144ff4534163ad96720cba3437efceacdedd061ea90270f39231322` |
| `docs/architecture/mobile-api.md` | `a3d15996a385329688fea0c47c29896f3c65331d7d79d99846ce7a5278ccb01c` |
| `docs/architecture/service-overview.md` | `4b86577c0aa5ba7b310ef03a77954ff90aeb8b22021d9ea3cdc2944219c58150` |
| `docs/architecture/weather-collection.md` | `b2064102d5e6d0d2650f49a5c88c71ac7dbde63cb2adffefc6eb80b276d4600e` |
| `docs/architecture/diagrams/mobile-weather-request.json` | `39bce13bb25404d247b0a9f4b774d4e0c1414526e11a7695600e92482cf30c9b` |
| `docs/architecture/diagrams/service-overview.json` | `fc298c98f152b1ffd51b24cf33f618243aa9ab57ee1654dcef61fc6fc8fbd5fb` |
| `docs/architecture/diagrams/weather-collection.json` | `49e34714eee6f5829190776d36b66a2e60abb66e622292b014606cd4350de838` |
| `docs/architecture/diagrams/mobile-weather-request.html` | `91d7902f4741547d712c0c4f7b7a29743db919d38035cd9656a44dac4da69985` |
| `docs/architecture/diagrams/service-overview.html` | `cac46d079512a6dc8c61d84cc4b60758b1e263453463cd23360f6cd76db9549c` |
| `docs/architecture/diagrams/weather-collection.html` | `7cdcb106ab5dc887889d0bb4cffc27696dfa6ca52b8c86bf353e876719f56c06` |

Generated UTC: 2026-09-20T13:32:58.483119+00:00

## Actual isolated VM command and output

Executed from the repository root with Node; exit 0. This command reads source text and executes extracted functions with in-memory substitutes. It does not require application modules or touch provider/network/database interfaces.

```sh
node <<'JS'
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('client/www/js/service.weatherutil.js','utf8');
const part=src.slice(src.indexOf('function _retryGetHttp'),src.indexOf('function _getUnitsParams'));
function scenario(earlyError){let now=0,id=0,ts=new Map(),calls=[],out={};const c={console:{log(){}},setTimeout:(fn,ms)=>{ts.set(++id,{fn,at:now+ms});return id},clearTimeout:i=>ts.delete(i),$q:{defer:()=>({promise:out,resolve:v=>{if(!out.status)Object.assign(out,{status:'resolved',v})},reject:e=>{if(!out.status)Object.assign(out,{status:'rejected',message:e.message})}})},$http:opts=>{const call={at:now,opts};calls.push(call);return {success(fn){call.success=fn;return this},error(fn){call.error=fn;return this}}}};vm.createContext(c);vm.runInContext(part,c);c._getHttp('/fixture');if(earlyError)calls[0].error('fixture failure',500);while(ts.size){let [k,t]=[...ts].sort((a,b)=>a[1].at-b[1].at)[0];ts.delete(k);now=t.at;t.fn()}if(!earlyError){calls[0].error('fixture failure',500);calls[1].success({ok:true},200)}assert.deepStrictEqual(calls.map(x=>x.at),earlyError?[0]:[0,2000,4000]);assert.equal(out.status,'rejected');assert(calls.every(x=>x.opts.timeout===10000));return {attemptMs:calls.map(x=>x.at),perAttemptTimeout:calls[0].opts.timeout,promise:out.status}}
console.log('ACTUAL_SOURCE_RETRY_SLOW',JSON.stringify(scenario(false)));console.log('ACTUAL_SOURCE_RETRY_EARLY_ERROR',JSON.stringify(scenario(true)));
const manager=fs.readFileSync('server/controllers/controllerManager.js','utf8');const fn=manager.slice(manager.indexOf('Manager.prototype.checkTimeAndRequestTask ='),manager.indexOf('Manager.prototype.startManager ='));
let minute=0,hour=0;const c={Manager:function(){},Date:class{getUTCMinutes(){return minute}getUTCHours(){return hour}},log:new Proxy({},{get:()=>()=>{}}),process:{exit(){throw Error('unexpected exit')}}};vm.createContext(c);vm.runInContext(fn,c);const seen={};for(minute=0;minute<60;minute++){const m=new c.Manager();m.asyncTasks=[];m._requestApi=(name)=>{(seen[name]??=[]).push(minute)};m.checkTimeAndRequestTask(false)};assert.deepStrictEqual(seen.current,[2,12,22,32,42,52]);assert.deepStrictEqual(seen.shortest,[4,14,48,54]);assert.deepStrictEqual(seen.short,[13]);console.log('ACTUAL_SOURCE_DIRECT_SCHEDULE',JSON.stringify(seen));const health=[];minute=10;for(hour=0;hour<24;hour++){const m=new c.Manager();m.asyncTasks=[];m._requestApi=()=>{};m.checkTimeAndRequestTask(false);if(m.asyncTasks.some(f=>f.name==='HealthDAy'))health.push(hour)}assert.deepStrictEqual(health,[9]);console.log('ACTUAL_SOURCE_HEALTH_UTC_HOURS',JSON.stringify(health));
JS
```

```text
ACTUAL_SOURCE_RETRY_SLOW {"attemptMs":[0,2000,4000],"perAttemptTimeout":10000,"promise":"rejected"}
ACTUAL_SOURCE_RETRY_EARLY_ERROR {"attemptMs":[0],"perAttemptTimeout":10000,"promise":"rejected"}
ACTUAL_SOURCE_DIRECT_SCHEDULE {"current":[2,12,22,32,42,52],"keco":[3,13,23,33,43,53],"kecoSido":[4,14,24,34,44,54],"shortest":[4,14,48,54],"short":[13],"updateStnRnsHitRate":[50],"gatherKasiRiseSet":[55]}
ACTUAL_SOURCE_HEALTH_UTC_HOURS [9]
```
