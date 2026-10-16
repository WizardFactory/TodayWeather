Task: issue-2703-s18a; source: [intent](../intent/issue-2703.md); base 1d60f728; date 2026-10-15.

# Specification: server2 push registration state (S18a)

## Legacy behavior ported (source revision 1d60f728)

| Legacy source | server2 port |
| --- | --- |
| `server/app.js` middleware order (cors, session, body-parser json/urlencoded, routers, 404 to Express `finalhandler` 0.4.1 with `NODE_ENV=production`) | `server2/src/push/express.rs` |
| `server/routes/v000705/routePushNotification.js` (POST/PUT/DELETE), `server/routes/v000902/route.push.update.list.js`, version routers' `decodeURI(req.originalUrl)` | `server2/src/push/routes.rs`, `express.rs` |
| `server/controllers/controllerPush.js` (`updatePushInfo`, `makeRemoveSelector`), `server/controllers/alert.push.controller.js` (`updateAlertPush`, `removeAlertPush`, token renames), `server/lib/unitConverter.js` (`initUnits`) | `routes.rs` |
| `server/lib/pushStore/mongo.js` (`keyQuery`, `tokenQuery`, upsert, `multi` renames, `find` then `save`/`update`, `remove`) | `routes.rs` (`TxnBackend`), `store.rs` (MongoDB equality matching, natural order) |
| `server/models/modelPush.js`, `server/models/alert.push.model.js` with Mongoose 5.1.2 (strict schemas, casts, `CastError` text, query/update casting order, document construction, `minimize`, `__v`) | `server2/src/push/mongoose.rs`, `js.rs` (V8/`util.inspect` text) |
| MongoDB 3.4 write-command replies (`{n, upserted?, nModified, ok}`, delete `{n, ok}`) | `routes.rs` |

## Contract rules

- Mounts: `/v000705/push` and `/v000902/push` (POST, PUT, DELETE), `/v000902/push-list` (POST);
  case-insensitive, one trailing slash; sub-paths and other methods are `404 Not Found\n` after body
  parsing; OPTIONS on any of them is the `cors()` preflight (204).
- Body parsing errors: invalid JSON or a non-object/array JSON top level 400; over 100 kb 413;
  non-`utf-*` JSON charset, non-UTF-8 form charset or unknown content encoding 415 (identity, gzip,
  deflate supported); a malformed `decodeURI` URL 500. All via the final handler (status text + `\n`,
  `X-Content-Type-Options: nosniff`, no ETag). Bodies of other content types are `{}`.
- Success answers: `res.send` JSON with a weak ETag (`W/"<len hex>-<md5 base64>"`); error answers
  `res.status(n).send(message)` as `text/html; charset=utf-8`.
- The `geo` `2d` index: a point outside [-180, 180) is a write error (message
  `point not in interval of [ -180, 180 )`, wording not re-verified on a live MongoDB 3.4).
- Store errors keep their legacy route mapping: POST `/push` 500, PUT 500, DELETE 501 with the
  message; `push-list` swallows them (`null` item, or `{ok:0,n:0,nModified:0}` for a failed alert
  update, as `Model.update` passes it). The S3 failure message is `push state storage unavailable`.
- Deliberate differences: update operators in bodies are dropped; operator query values are cast
  errors; a castable body `_id` is ignored; duplicate keys inside one `push-list` apply in order; no
  session cookie; replica-set reply metadata is not reproduced; date strings follow the ECMAScript
  date-time format and Mongoose's millisecond rule, while V8's legacy free-form date text is a cast
  error (only client-supplied `precipAlerts`/`airAlerts.pushTime`, which the app never sends).

## State and durability

- Records: legacy documents (fields, BSON kinds, `_id`, natural order) per collection; memory keeps
  each encoded document plus key fields and token indexes.
- `index/v2/push/state/journal/{seq:012}.json` (`If-None-Match: *`; header line + change lines),
  `snapshot/{seq:012}-{nonce}/{part:04}.json` (`If-None-Match: *`), `head.json` (`If-Match`).
- Writer: settle any unknown outcome; read the next sequence (another writer's entry is applied
  first); plan in an overlay; no change answers at once; otherwise commit at `seq + 1`:
  200 committed (apply, answer); 409/412 conflict (apply the other entries, plan again, at most 3
  attempts); other 4xx or credential failure rejected; transport/timeout/5xx read back (ours:
  committed; absent: void entry, failure; undecided: unsettled, failure until settled).
- Removals keep the record `_id` (journal line, snapshot line); the importer never re-creates it.
- Bounds: S3 operation 2 s (snapshot part upload 8 s); request wait 9 s; queue 64; snapshot every
  1,024 entries in 2 MiB parts (retried after the next commit while failing); restore reads at most
  8 objects at once and retries every 5 s while unready.
- No local-disk copy of state or tokens; no logs with tokens (counters only).

## One-time copy

- Converter input: `mongoexport` lines or `--jsonArray`; `$oid`, `$date` (ISO, `$numberLong`, number),
  `$numberInt`, `$numberLong`, `$numberDouble`. Malformed: not JSON, no ObjectId `_id`, duplicate
  `_id`, model field of the wrong kind, unsupported type, no token. Report: counts, positions,
  reasons; import file mode 0600.
- Importer: restore; merge by `_id` with the sha256 of the legacy document recorded at import
  (insert / removed in server2 stays removed / unchanged / only server2 changed: kept / only legacy
  changed: replaced / both changed: newer legacy `updatedAt` replaces, otherwise kept); 1 MiB journal entries; re-plan after a conflict or void;
  snapshot when anything changed. The converter refuses an existing output path (no reused
  permissions or symbolic-link targets) and creates the import file 0600.

## S18b-1 scheduled alarm delivery (base 915978bb)

| Legacy source (revision 915978bb) | server2 port |
| --- | --- |
| `server/app.js:140-147` (`SERVER_MODE=push` starts the worker), `server/controllers/controllerPush.js:1236-1244` (`start`, 60 s interval), `:1170-1234` (`sendPush`), `:1137-1160` (`_filterByDayOfWeek`), `:1085-1129` (`_removeOldList`) | `server2/src/push/deliver/alarm.rs` |
| `server/lib/pushStore/mongo.js:60-65` (`disableByFcm`), `:70-115` (`removeDuplicates`), `:138-147` (`getAlarmsByTime`, `removeDuplicateAlarms`); `controllerPush.js:68-117` (`updatePushInfo`, `makeRemoveSelector`) | `deliver/ops.rs`, `store.rs` (`due`, key fields), `service.rs` (internal writer operations) |
| `controllerPush.js:989-1026` (`requestDailySummary`), `:622-719`, `:851-906`, `:907-988` (KMA, DSF, geocode requests), `server/config/config.js:81-85` (`SERVICE_SERVER`, `API_SERVER`) | `deliver/weather.rs` |
| `controllerPush.js:221-614`, `:720-842` (message builders), `server/lib/aqi.converter.js`, `server/locales/*.json` (i18n 0.8.3) | `deliver/text.rs`, `deliver/locales.json` (subset, per-file sha256) |
| `controllerPush.js:1031-1083` (`sendNotification`), `:181-208` (`sendFcmNotification`), `:151-220` (node-gcm), `server/lib/pushProviders.js` (two Firebase apps); firebase-admin 5.13.1 `lib/auth/credential.js` (assertion, token endpoint), `lib/messaging/messaging-api-request.js:24-160` (timeout, error code), `lib/utils/error.js:258-262`, `:685-` (client codes), `lib/utils/api-request.js:278-300` (one retry after a network error) | `deliver/fcm.rs`, `deliver/alarm.rs` |

Rules:

- Minute: UTC boundary; time = seconds of day of the minute; duplicate removal, then due records
  (`pushTime === time`, `enable !== false`, natural order), weekday filter (`dayOfWeek[day]` truthy
  with `timezoneOffset` present), claim, deliver (6 in flight), result, 60-day removal and
  `updatedAt` stamp. Skip (no claim) while the state is not restored or nothing is due. The
  removal applies only while the selected record (number, `_id`) is still older than 60 days or
  was changed only by this worker's disable; the stamp only while it still has no `updatedAt`.
- Ledger: `index/v2/push/delivery/alarm/{YYYYMMDD}/{HHMM}.json` with `If-None-Match: *` before any
  send (`schema`, `kind`, `minute`, `claimedAt`, `claim` nonce, record `_id`s); 409/412 taken;
  other 4xx unavailable; unknown outcome read back (own body owned, other taken, unreadable
  unavailable); 4 s bound. Result `....result.json` (`If-None-Match: *`) with `_id`, `outcome`,
  `class`, `status` per delivery, best effort.
- FCM: one `POST {fcm}/v1/projects/{project_id}/messages:send` (`content-type: application/json`,
  `access_token_auth: true`, `Authorization: Bearer`), body
  `{"message":{"notification":{"title","body"},"data":{"cityIndex":String(cityIndex)},"token"}}`,
  10 s bound, no redirects, reqwest retries disabled. OAuth: RS256 JWT
  (`{"alg":"RS256","typ":"JWT"}`; claims `scope`, `iat`, `exp = iat + 3600`, `aud`, `iss`),
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` to `https://oauth2.googleapis.com/token`
  ([Google service-account flow](https://developers.google.com/identity/protocols/oauth2/service-account));
  cached per app until less than 60 s remain; 10 s bound.
- Classification (firebase-admin 5.13.1): `text/html`/`text/plain` answers map by status; other
  bodies by `error` string, `FcmErrorCode` detail, `status` or `message` through
  `MESSAGING_SERVER_TO_CLIENT_CODE`; 2xx without error accepted; `NOT_FOUND`/`NotRegistered`
  unregistered (token's alarms disabled before the outcome is reported; class suffix
  `;disable-failed` when the disable was not committed); timeout or transport error after connecting unknown;
  connect failure, credentials or OAuth failure not sent. The
  [FCM error reference](https://firebase.google.com/docs/cloud-messaging/error-codes) documents
  `UNREGISTERED` as 404 and backoff for `UNAVAILABLE`/`QUOTA_EXCEEDED`; D02 sends no retry.
- Not sent: iOS without `fcmToken`, Android with only a GCM `registrationId` (legacy FCM API
  deprecated 2023-06-20, shut down from 2024-07-22), unknown type, unknown package, weather or
  geocode failure (status >= 400, transport, 30 s bound), builder exception.
- Diagnostics: per non-accepted delivery `minute`, `_id`, outcome, class, status; per skipped
  minute a note; counters. No token, coordinate, name, address or text; no local-disk writes.
