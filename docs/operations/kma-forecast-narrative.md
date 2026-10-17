# Nationwide forecast narrative (#2798)

The legacy special-weather endpoint adds **종합예보**, type `5`, after the unchanged
relative order `4,1,2,3`. Client presentation and multilingual support are tracked
in [#2803](https://github.com/WizardFactory/TodayWeather/issues/2803). No client
bundle or translation changes are included here.

## Acquisition and storage

The existing warning schedule polls every three minutes in `scrape`/`local`, or in
`gather` with `KMA_WARNING_ENABLED=true`. Narrative collection runs last, after
existing warning/zone work. An earlier exhausted warning quota still stops that
cycle. No new startup timer or push send is introduced.

The official [short-term notification API](https://www.data.go.kr/data/15058629/openapi.do)
uses HTTPS `VilageFcstMsgService/getWthrSituation`, `stnId=108`, `dataType=JSON`,
`pageNo=1`, `numOfRows=10`. It returns the latest announcement within 24 hours;
there is no historical-time request parameter. `wfSv1` is optional. `wn` and `wr`
are ignored. This is not the warning service's `getWthrInfo`.

`DONGNAE_SECRET_KEYS` is the existing consolidated list. Each request walks the
list at most once for auth/quota rejection and remembers a successful key. There
is no pagination or immediate retry for other failures. Strict requests reject
redirects, require HTTP200/resultCode00 and have a 30-second absolute deadline per
key, in addition to the transport timeout. The acquisition bound is key count
multiplied by 30 seconds, excluding storage latency. A same-instance overlap skips
narrative acquisition; it does not change warning scheduling.

Every row must have station108, a real 12-digit KST publication and a nonempty
string body. Only publications with `0 <= age < 24 hours` can be stored. Malformed
batches write nothing. A deterministic ObjectId (`000005` + `tmFc` + `000108`) uses
Mongo's existing unique `_id` to make publication inserts idempotent across workers.
The row is immutable: repeat acquisition does not update its timestamp or text.
A same-publication provider correction is not imported; a newer publication is.
No index migration is required. Types1–4 retain their existing identities/indexes.

The legacy collection stores KST wall time as UTC in `announcement`; readers
subtract nine hours once. Example: `202610161700` stores `2026-10-16T17:00Z` and
returns `2026-10-16T08:00Z`. Raw multiline Korean text is stored with CRLF normalized
to LF; the response escapes HTML metacharacters and preserves newlines without
legacy bullet insertion. Do not unescape this field before HTML binding.

## Response and expiry

`GET /v000903/kma/special` keeps `name`, `announcement`, `comment`. The new name is
currently the Korean literal `종합예보` for every locale. There is no claim that
provider prose has been translated. The announcement is a true UTC ISO instant.
A missing, invalid, future, expired or empty narrative is omitted. A failed optional
narrative query also omits it and logs a fixed warning; legacy query errors retain
their existing behavior. Collection failures preserve all previously stored rows.
Expiry is checked at read time, even if collection has stopped. Cache-Control is
at most300seconds and is shortened to the narrative's remaining whole seconds, so
the origin does not authorize caching a narrative past its expiry. Verify CDN
minimum TTL or overrides during rollout; origin headers alone do not prove that
public caches honor them. Historical rows are retained like existing bulletins.

## Local verification

Use isolated dependencies, not the application's live configuration:

```sh
npm install --prefix /tmp/issue2798-deps --ignore-scripts --no-audit --no-fund --package-lock=false async@2.6.4 request@2.88.2 express@4.13.4 mongoose@5.1.2 mongoose-smoke@npm:mongoose@5.13.23 mongodb-memory-server-core@10.1.4
NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-narrative.test.js
NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-warning.test.js
NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/data-go-kr-keys.test.js
NODE_PATH=/tmp/issue2798-deps/node_modules node server/test/offline/kma-narrative-smoke.js
```

The smoke uses actual request/Mongo/Express against loopback, a disposable Mongo7
and the Mongoose5.13 smoke driver. Production remains Mongoose5.1.2. Warning regressions use a fake Mongoose adapter
to load schema definitions and do not test5.1.2 casting or persistence. The smoke
does not prove production-driver compatibility or a production Mongo deployment. `TW_MONGOD` can select a local Mongo7 binary. All services close
at exit. No app startup, live provider, `/gather` route or production DB is used.
The test excerpt uses the issue-reported October16 17:00 metadata and 30–80mm
precipitation, plus synthetic text/markup; it is not the complete captured bulletin.
See the [API usage manual](kma-forecast-narrative-manual.html).

## Operator deployment and readback (separate approval required)

1. Obtain operator approval for the exact overlay and affected worker restarts.
   Inspect current deployed source/config and process modes first: production uses
   selective overlays, so a repository merge does not establish deployed behavior.
2. Preserve checksums and copies of deployed collector/requester/model/controller/
   v000903 route files and any host-only edits. Review the new helper and required
   files as one overlay; do not overwrite unrelated host changes. Confirm the
   existing consolidated key list is approved for this API without logging it.
3. Apply the approved overlay and restart only approved workers. Wait for a normal
   scheduled run; never use `/gather/*` as a health probe. Record sanitized success
   or failure and verify a type5 document, its publication and complete body in DB.
4. Read both origin and the public client path `/v000903/kma/special`. Compare the
   true UTC announcement, full normalized/escaped `wfSv1` and retained types1–4.
   Record time, revision/overlay hashes, status, publication, body hash, cache headers
   and cache behavior. Exclude service keys and key-bearing URLs. Verify no narrative
   changed zone state or sent a push. Wait out the previous300-second cache when needed.
5. Verify expiry and no-data behavior without changing production clocks/data; use
   local scenarios and subsequent natural publications. If acquisition or deployed
   readback is blocked, leave #2798 open and record the blocker. This implementation
   PR intentionally does not close the issue.

## Rollback

With separate operator approval, restore the exact saved overlay files, remove the
new helper only after all dependent code has been restored, and restart approved
workers. Old readers ignore type5 rows; no destructive DB cleanup is required.
Verify types1–4 at origin and public path after caches expire. Keep the rollback
checksums and readback result without secrets. Do not disable the warning collector
or delete valid warning/zone state merely to remove the optional narrative.
