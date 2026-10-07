# S06: complete S3 catalog publication and recovery

Owner /root/s05_raw_records; 2026-10-07; baseline `4864c9368e78061fbc65b57ac0abaaa3b9408eff`.

Weather consumers need the same result after an empty memory cache or interrupted publication. S05 stores immutable exact provider bytes, but a raw PUT does not make a multi-page, multi-partition acquisition complete. S06 implements identity catalogs, group declarations, verified publication and full bounded repair without persisting normalized weather.

## Observable acceptance

- **AC1:** Readers expose only checked complete acquisitions. A new A catalog with healthy old B excludes the partial new group and preserves previously complete groups. Deterministic earliest/latest/absent-only field merge/list replacement produces identical derived results across arrival order and cold reads; pages remain ordered.
- **AC2:** Fully paginated relevant-prefix repair finds every valid revision, including orphan records behind a healthy old catalog. Limits, corrupt/missing members and incomplete scans never become a complete empty/provider miss. Repair recovers a full group to the same result.
- **AC3:** Real loopback HTTP conditional catalog writes preserve concurrent revisions through CAS union. Unknown raw/catalog writes, conflicts, cancellation and deadlines never acknowledge partial groups; bounded streaming/CPU/I/O and all S05 regressions remain.
- **AC4:** Exact path placement, maintained task/operator documentation, validated root-owned Archify artifacts, actual scenario screenshot/PDF, checks/CI and independent Claude review support current pre-merge readiness.

## Scope and authority

AK's “진행” authorizes S06 implementation/test/local smoke, commits/push/PR/CI and material task/PR comments, with actual root-dispatched independent Claude review via existing configured accounts `paseo:codex-default` (OpenAI builder) and `paseo:claude-default` (Anthropic reviewer). Scope ends at **pre-merge**, `merge_authorized:false`. Account labels are configuration identities, not runtime proof. Root verifies actual reviewer provider/model/medium/auto and separate context.

No merge/auto-merge/queue, issue closure, deployment, live AWS/provider/Mongo/push calls, secrets transfer, new accounts or permission/settings changes. Existing managed sandbox review remains effective. No SQLite, disk serving store, shared-instance cache, quota accounting, response route port/cutover, packs or weather normalization persisted. S07 owns cache/resolution and S08 owns provider budget arithmetic/admission.

O-5 immutable raw/no deletes, versioned identity catalog CAS and O-9 raw plus complete catalog publication before new success are recorded approved directions. All server-equivalent assets reside under server2; exact paths were declared before edits at [the task declaration](https://github.com/WizardFactory/TodayWeather/issues/2691#issuecomment-6031233006). Root exclusively edits shared architecture/diagrams/parent plan; the builder consumes its validated design before runtime build.

## Risks and constraints

S3 has no cross-object transaction. Completeness comes from immutable member/partition/page declarations and pinned sibling validation, never a stored trusted complete bit. One immutable raw identity has one group affiliation: no retroactive conversion of ungrouped/differently grouped metadata. Descriptor hashes exclude their own group reference. Caller-effective monotonic deadlines include all operations and credential waits. Local peers prove wire behavior, not actual AWS SigV4/IAM/versioning/latency; staging S09 retains those gates.

A missing or healthy catalog cannot prove there are no orphans. Only a fully bounded, fully paginated explicit scope scan establishes empty coverage. Partial recovery is structurally distinct from complete absence. Existing API parity/cold-cell fallback gates remain; no data is invented. Consumers: specification, builder, root diagrams and independent reviewer.
