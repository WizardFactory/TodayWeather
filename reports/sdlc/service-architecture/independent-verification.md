# Independent verification — service EC2 internals

Verdict: **PASS**. One mandatory evidence finding is resolved; no unresolved Must Fix remains.

Verifier: `/root/architecture_verification`, existing separate native-agent context from builder `/root`. Final candidate: `sha256:c373d00c03953b5d8eec776b3cdd05517c163312a699010e2561411c6e444f73` (27 files individually rehashed). Repository baseline: `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`; inspected deployment Git identity: `5bca4073255b41f55a8654b3de395cb033a06f03` plus documented host config/logger edits.

This review covers the EC2 amendment and affected architecture/guidance. [Previous AWS review](revisions/02-aws-correlated/independent-verification.md) and [source-only review](revisions/01-source-only/independent-verification.md) retain unchanged evidence. This verifier performed local reads/checks only: no SSH/AWS call, key access, private raw configuration read, application/provider/database execution, or mutation of authored artifacts. Only this report was written.

## Acceptance and findings

| Requirement | Assessment |
| --- | --- |
| AC1 observed host structure | PASS: timestamped nginx/process/listener/PM2 metadata supports public port 80, loopback 3000 and ten application workers. Configuration AST plus preserved selected environment absence supports static service/DB2.0 resolution. Host-loaded heap and effective nginx configuration are not independently attested. |
| AC2 collector boundaries | PASS: service-mode startup does not launch Manager gather/scrape/push loops; mounted collection routes and request-time DSF/AQI effects remain possible. Service KAQ bucket configuration is not evidence of a running scheduled consumer. Separate gather host remains uninspected. |
| AC3 request/database path | PASS: AWS/deployed-Lambda path connects to observed service listener; selected Express files match. One hundred TCP sockets to configured `172.31.19.0:16652` are distinguished from database authentication, query/health/freshness or remote-engine inspection. |
| AC4 diagrams/shared guidance | PASS: six source/HTML/browser bindings, 54 showcase checks and 182 links pass. Updated guidance resolves through one canonical source. New host/infrastructure screenshots independently inspected; remaining visual coverage uses builder receipts. |

| Severity | Category | Location | Finding / evidence / impact | Verification | Requirement | Confidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MEDIUM | Evidence completeness | ec2-readonly-evidence-2026-09-20.json | Initial JSON preserved configuration fallback AST but not explicit absence of process environment overrides, leaving the central service/DB2.0 inference unauditable. | Compare selected override names/PIDs with PM2 workers and captured config hash. | AC1/AC2 | High | RESOLVED: 15:10:34 UTC `selected_process_environment_check` records all 12 selected overrides absent for each of the same ten worker PIDs, matching prior config SHA. Document states follow-up time and static resolution limits. |

The recommended kernel provenance improvement is also resolved: the follow-up evidence preserves the kernel string matching the document.

## Checks actually performed

- Read current EC2 internals/evidence, affected AGENTS and architecture documents, source diagrams, authorization amendment, relevant local source and Git differences. No private collection files were opened.
- Compared PM2 entries: exactly ten `www` workers, IDs 2–11, online, cluster mode, consistent entrypoint/cwd. Two management modules are separate. Independently cross-matched database socket PID set, ten sockets per worker and total 100. Converted worker timestamps to UTC 12:17:44.709–12:17:49.531, matching prose.
- Independently recomputed local SHA-256 for eight selected host comparison entries. For all seven entries other than host-edited config, hashed local `git show 5bca407:<path>` bytes and matched the recorded host SHA. This corroborates the recorded host source identity without re-reading the host. Config is correctly identified as modified.
- `git diff --stat 5bca4073255b41f55a8654b3de395cb033a06f03 b9795125a1b7dc8a4f7602d4612a6be7d79413ad -- server` shows seven changed committed files. Read relevant diffs: Manager retry budgets 20/5 versus 70/50; DSF TLSv1 override versus commented override; added KMA `parseInt(i)>100` recvFail branch; APNs manifest ^1.7.5 versus ^2.2.0. These are source differences, not measured provider/collector outcomes.
- Independently checked follow-up presence summary: ten PIDs equal the original worker/socket set; every one has the same 12 selected keys and all flags false; config SHA equals original host-config hash. Preserved AST defaults, config mtime and process metadata support the documented inference without claiming a live config-object read.
- `python3 reports/sdlc/service-architecture/guidance-check.py`: exit 0, including final candidate. Exact `@AGENTS.md` import resolves to the canonical file.
- `python3 reports/sdlc/service-architecture/document-check.py`: exit 0 on final candidate. Output below confirms 182 links, six bindings, 54 showcase checks, preserved product/README content and intended ignore behavior. `git diff --check` also passed.
- Additional independent Python check rehashed all 27 candidate files, checked 182 local Markdown targets, and checked all six visual-check receipt hashes against actual HTML with passing viewport records. `diagram-handoff.json` and current browser-command/spec bindings were checked by document-check.py. Unchanged diagrams reuse exact prior receipts; four changed/new views have refreshed evidence.
- Independently viewed current `ec2-internals.visual-check.1440x900.dark.png` and `aws-infrastructure.visual-check.2048x1320.light.png`. Host ingress, PM2 relationship, socket destination and unresolved gather edge are legible, without clipping/overlap; limitation cards avoid claiming database query health. This verifier did not launch a browser. Builder's separate full four-diagram endpoint/theme visual coverage is retained in its report.
- A narrow sensitive-pattern scan of changed host evidence, EC2 document and AGENTS found no AWS access-key ID pattern, private-key block, signed URL signature or JSON private_key field. Evidence includes selected booleans/settings and hashes, not full environments, raw config, webhook contents, client logs or credentials. This is not an exhaustive secret-scanner guarantee.

Final outputs:

```text
PASS: 182 local links; 6 evidence sources/specs/HTML/browser bindings; 54 showcase checks; original product files and README content preserved.
PASS: HTML/JSON retained; visual-check PNGs and SSH private key ignored.
PASS: Codex AGENTS.md and Claude @AGENTS.md resolve one canonical source; required rules and links present.
INDEPENDENT_FINAL sha256:c373d00c03953b5d8eec776b3cdd05517c163312a699010e2561411c6e444f73 files 27 links 182 browser_hash_bindings 6 environment_worker_checks 10 override_keys 12
```

## Independent instruction decision evaluation

Both entrypoints select the same actions after actual canonical resolution. These are simulated task decisions evaluated by this independent context, not Claude execution or a cross-provider review.

- **Change mobile coordinate API:** read index/mobile/AWS/EC2 evidence; trace client, Lambda contract and Express routes. Preserve version/units/widget/storage compatibility. Reconcile local baseline against host 5bca407 and config/logger edits before reasoning about deployed effects. Treat nginx/on-disk config/process observations separately from successful end-to-end requests. Use isolated checks; documentation/SSH authority does not grant deployment or endpoint-probe authority. PASS.
- **Investigate collection freshness:** inspect Manager/KAQ source and actual deployment divergence. Treat the ten observed service workers as API workers, not ten schedulers; retain request-time fills and mounted side-effectful routes. Separate service bucket setting from unobserved gather-host consumer. Never use TCP socket count as proof of database health or timestamps. Do not probe gather endpoints, access other hosts or mutate processes under the read-only scope. PASS.
- **Install shared skill:** maintain one canonical `.agents/skills` copy, both CLI links/hooks and actual discovery/execution verification; preserve existing state. Current EC2-analysis authorization does not authorize a skill installation. No skill changes or Claude runtime claim were made. PASS.

## Limits and evidence reuse

The builder performed authorized SSH/proc/netstat/PM2 RPC reads; this verifier checked sanitized records and local Git/source, not the host itself. No SSH host-key attestation, nginx reload/effective-config dump, heap attestation, HTTP request, DB query, remote Mongo/gather inspection, reboot, provider check or deployment was performed by this verifier. Existing access/workspace setup instructions are preserved; their credential-copy setup was not re-executed in this review. Prior source-only and AWS findings remain archived; their unchanged runtime mocks were not rerun or presented as new checks. Final PASS is bound to the candidate below and these evidence limits.

## Inspected candidate SHA-256

| File | SHA-256 |
| --- | --- |
| `.gitignore` | `72affabd04d427671167b1f99b78593796f7a412a1e4ebaed6ec9d5dec2c172b` |
| `AGENTS.md` | `8e4ffa020189d4559ad2f4ebade2f1a61515ff83c274db8c0ecd7db77c8ec4fe` |
| `CLAUDE.md` | `336cc4fbf19beaada7ccf9986414fa91851a8d7a07dfb3ccbe800a69eed0ab49` |
| `README.md` | `1ea5502e5f3de422d883c74520ccae6c5da2176370ac8705cf492c4eccfe6325` |
| `docs/architecture/README.md` | `65c3d3589465edbc329c24fbbfc34824c271fe2de9405d0555e661d45d376084` |
| `docs/architecture/aws-code-correlation.md` | `571eed57076846b505d7e14295b4c58731ce4ca59556817328ae872dcacf06ed` |
| `docs/architecture/deployed-lambda-excerpts.md` | `94ac6ed16215d4a2a8fca3430e80e9109bd22015d89490327204cce4f7b8f08a` |
| `docs/architecture/ec2-access.md` | `55090eb0570e728be324937249e6f5890df48b21145f980cd5ba66a6d630b9e1` |
| `docs/architecture/ec2-internals.md` | `1327c125b9a0374c851eb28ed97c500ea61cbce9071dcb051afad297672c4f80` |
| `docs/architecture/evidence.md` | `c823f50e4c025e0893d35a2affc39ea65dfe8a329be8006304e68e153da76ee6` |
| `docs/architecture/mobile-api.md` | `6c89162a21d6d4348751255ecd34cae241cfa4a7c7808e5413bc3263f3bd9087` |
| `docs/architecture/service-overview.md` | `550eb794e4ef3645fc4d6b64d08106eebaf23dc90b7368ef2c19144e64c60263` |
| `docs/architecture/weather-collection.md` | `b697c293a08a32401aa0e07128879aadc372aaef92bc13e65dca0e7039e793a6` |
| `docs/architecture/aws-readonly-evidence-2026-09-20.json` | `cb40d6b2b0a00b4e0f0ca04137c3c83a7fe0b2e4ff9b4b6666a7b3a23f0d96a3` |
| `docs/architecture/ec2-readonly-evidence-2026-09-20.json` | `87d194d4a130a9d1ffcb6c690b05112f02c1747c544f2d8c39d27495f63f7303` |
| `docs/architecture/diagrams/service-overview.json` | `50c6756acf24bdca03cc6c0cf271ee1041d652b33b9e20580d66a45c7da2815b` |
| `docs/architecture/diagrams/service-overview.html` | `e3b8911938b53cfa78636f0236ccb894fe753b0c1f7538973a839bfd7ae2653c` |
| `docs/architecture/diagrams/weather-collection.json` | `49e34714eee6f5829190776d36b66a2e60abb66e622292b014606cd4350de838` |
| `docs/architecture/diagrams/weather-collection.html` | `7cdcb106ab5dc887889d0bb4cffc27696dfa6ca52b8c86bf353e876719f56c06` |
| `docs/architecture/diagrams/mobile-weather-request.json` | `9d0a564261c9255f8aa68576af3859400e02481a4a269fb27df50f98977c4f73` |
| `docs/architecture/diagrams/mobile-weather-request.html` | `036de95cd1e25ae3e131df60d3fd788b10d63d7c0bb0b4103487126e204fd468` |
| `docs/architecture/diagrams/kaq-image-pipeline.json` | `472c6d39fbf1836484061c4460e8ba0ce9c8b1427778f30c2e453ce2aa96b274` |
| `docs/architecture/diagrams/kaq-image-pipeline.html` | `e3b0825423d7b4bd678d99d0c7e19bc7ac784128155915d3566377836aef2744` |
| `docs/architecture/diagrams/aws-infrastructure.json` | `4eb98cbd7b2a3f2bda76633ba58b30f9a792a2565cb94d0c4269cbe387dbea6c` |
| `docs/architecture/diagrams/aws-infrastructure.html` | `a369e65a5ed63d44a4da512cdca56f167f05049ff6dde3ec83c345c403f75f38` |
| `docs/architecture/diagrams/ec2-internals.json` | `afbe50d6d54d5334b4992fddc52afec71a403bacfffc0672a56b107a49c63166` |
| `docs/architecture/diagrams/ec2-internals.html` | `a0624b792cdd4a63cb2ba01f326deb599af831bed993c4e49a4cd36b61484f4e` |

Final verification UTC: 2026-09-20T15:22:21.266966+00:00
