# S18c specification

Task issue-2703-s18c, base f32386cb, owner /root/s18_conditional_alerts. Consumes intent/issue-2703-s18c.md and #2623 backend contract. N1–N4. Separate notices library, exported Axum router, operator CLI; process mounting belongs to S20. No SQLite/client/web/runtime legacy dependency.

## N1 — public read

`GET /v000903/notice/latest?lang=<tag>` yields `{"notice": null}` or a notice with numeric `id`, `title`, `body`, nullable `linkUrl`, selected `lang`, UTC `startsAt`, nullable `endsAt`. Active means not withdrawn and startsAt <= now, endsAt absent or now < endsAt. Choose highest startsAt then highest ID. Query primary language subtag takes precedence; otherwise supported Accept-Language primary subtags in wire order (q=0 excluded). Select available requested text, then English, then Korean. Unknown query language falls back English/Korean. Seven keys en/es/ja/de/pt/fr/ko only. Header `Cache-Control: public, max-age=300`, `Vary: Accept-Language`. No write HTTP routes.

Read S3 control on each request with a two-second bound; validate before replacing memory. Missing object is an empty verified state and null. Cold unavailable/corrupt state gives503 and no-store; a previously verified state stays usable on transient/corrupt reads and emits a sanitized class-only diagnostic. Selection uses current clock even for an old verified state. No precollection or verification mode.

## N2 — durable operator state

S3 `index/v2/notices/state.json`, schema1, monotonic nextId, retained records and operation identities. CAS with If-None-Match for initial creation or If-Match for current ETag; all operator writes validated and complete before success. Object limit8MiB, record count10000, refuse further growth explicitly; never prune acknowledged operator history automatically. Existing checked-in S03/S10f index/v2 permissions apply; no actual-role/AWS verification claim.

CLI `server2-notice add` reads JSON stdin. `update <id>` merges metadata and, when texts is supplied, replaces texts with that operator input. `withdraw <id>`, `list`, `show <id>`, `latest [lang]`, `translate <id>` are supported; no delete. Invalid input leaves durable bytes unchanged. Text has nonblank title<=100/body<=2000 Unicode scalar characters, no HTML tags/control characters except normal body newline/tab; ko or en required, language keys exact supported values, optional link absolute HTTPS. UTC RFC3339 times normalized; endsAt must exceed startsAt. Creation defaults startsAt to now; update preserves absent fields, numeric IDs never reused.

One unique operation identity travels through bounded CAS conflicts/unknown-result reconciliation. Readback containing that identity means committed, even after another writer; an unchanged base can retry identical CAS body, while a changed base without the identity proves its old precondition cannot commit. Failed readback returns an explicit uncertain error, never false success; no hidden transport retries. All applied identities retained under the object limit. No source or credentials appear in diagnostic errors. S3 version history is operator recovery, not request fallback truth.

## N3 — publication-time translation

Use source Korean, else English, from validated manual input. Preserve provided languages. Fill missing supported texts through one Responses REST attempt per language; no automatic retries. Default model `gpt-6-luna`, env `OPENAI_SECRET_KEY`, `TRANSLATION_LLM_MODEL`, `TRANSLATION_LLM_REASONING_EFFORT` (default none; explicit empty omits reasoning). No key means no call and publish original texts with reported missing languages. No dry-run/mock/live mode or test endpoint environment setting. API request path never invokes translation.

Official guide supports Responses `text.format` strict JSON schema and `reasoning.effort`; request uses store:false, bounded output and a natural everyday-wording prompt. Accept only completed output text JSON with valid title/body. Refusal, incomplete, HTTP failure, malformed or overlimit output is reported without blocking original notice publication. Stored generated text carries translated:{from,model}; manual text has no invented provenance. If source changes in update, generated translations from old source are discarded by explicit texts replacement and missing languages translated for the new source. Metadata-only updates retain texts.

Translations run before CAS mutation; when another writer changes source, refuse applying stale generated text. For `translate`, merge only still-missing languages against the same source fingerprint, never overwrite manual/concurrent translations. Tests inject a transport, real CLI production construction uses fixed official HTTPS address; no actual paid API request in verification.

## Verification and boundaries

Red→Green for API selection/languages, CLI validation/durable mutation, CAS races/unknown outcomes, corrupt read fallback/cold503, no request-path translations, partial failed translation/source races. Actual localhost S3+Responses+HTTP smoke uses synthetic notices and no real `.env`. Tests assert no submitted paid/device request and no write-route exposure. Existing Cargo dependencies reused; no new build/runtime manifest changes. Manual/PDF/screenshot and editable source-pinned diagram required. Root merges; S20 installs router/CLI. Clients remain unimplemented by this task.
