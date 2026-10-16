Task: issue-2703-s18a; owner: S18 builder (Anthropic Claude); base: 1d60f728e2bf4498da5ef82b3de6080f5cda9124; date: 2026-10-15.
Authority: AK authorized S18 on 2026-10-15 (endpoint pre-merge, no merge, no live push sends); AK
authorized read-only copies of the legacy push registrations during development (2026-10-14/15).
Criteria: CONTRACT (AC1), DURABLE (AC2), ORDER (AC3), COPY (AC4), PLACEMENT (AC5).
Issue update assessment: [intake and split](https://github.com/WizardFactory/TodayWeather/issues/2703#issuecomment-6193985870); one readiness comment at the end.

# Intent

Serve the used push registration API from server2 with server2-owned state, so that legacy
MongoDB can be retired after the registrations are copied once (AK, 2026-10-14; D03 superseded).

- CONTRACT (AC1): `POST /v000705/push`, `PUT`/`DELETE`/`OPTIONS /v000902/push` and
  `POST /v000902/push-list` keep the legacy validation, status, body, header and error contracts;
  the pinned legacy oracle's recorded requests give the same wire bytes and stored documents.
- DURABLE (AC2): a state change is answered with success only after it is durable in S3; an empty
  memory restores every acknowledged change; a change that cannot be made durable is answered with
  the route's legacy store-error response and is not applied.
- ORDER (AC3): one writer orders concurrent changes; ambiguous S3 outcomes are reconciled, never
  silently duplicated or lost; another writer's committed entry is applied before planning.
- COPY (AC4): an offline converter turns a `mongoexport` of `pushes`/`alertpushes` into an import
  file and reports malformed documents (no values); an importer merges it by `_id`; a re-run changes
  nothing; a read-only production copy converts and restores locally with every record equal.
- PLACEMENT (AC5): every changed path matches `server2/config/tasks/S18a.json`; no runtime import,
  include, symlink or file read reaches legacy assets.

Out of scope (split): S18b delivery (alarm/alert sends, provider adapter without hidden retries,
delivery ledger, sanitized diagnostics, no automatic resend; also the S12-deferred push warning
feed) and S18c notices (no legacy route or store exists; #2623 is open; needs an AK decision).
Also out of scope: process wiring and cutover (S20), merge, AWS resources, production imports.

## S18b-1 scheduled alarm delivery (2026-10-16)

Task: issue-2703-s18b-1; base 915978bb (started on a9b3a23d); authority: AK 2026-10-16 (continue S18b as separate PRs;
no live push/FCM/APNs sends; test doubles only). Declaration: `server2/config/tasks/S18b-1.json`.

Deliver the registered daily alarms from server2 exactly as the legacy alarm worker built them,
without ever sending one delivery twice.

- PARITY (B1): for the pinned legacy oracle's cases, the weather/geocode requests, OAuth request,
  FCM request bytes and outcomes match; a scheduled minute selects, filters, sends and cleans up
  like `sendPush`.
- ONCE (B2): at most one provider request per delivery; no retry after a failure or an unknown
  outcome; a restart, a second process or a repeated tick never resends a claimed minute; a later
  minute is delivered independently.
- RECORD (B3): every minute's claim and per-delivery outcome are in S3; an unregistered token's
  alarms are disabled through the S18a writer.
- PRIVATE (B4): ledger objects and diagnostics contain no token, coordinate, name or message text;
  nothing is written to local disk.
- PLACEMENT (B5): every changed path matches the S18b-1 declaration.

Out of scope: conditional alerts (S18b-2), the S12-deferred push warning feed (S18b-3), notices
(S18c), process wiring (S20) and any live provider call.

## S18b-2 conditional alerts (2026-10-16)

Continue the authorized S18 delivery scope with the legacy conditional worker's selection,
weather/air transitions, localized message and registration-state updates. This slice builds
on S18a and S18b-1; warning feed (S18b-3) and notices (S18c) remain separate. Endpoint is a
reviewed PR awaiting root integration, without deployment or live FCM/OAuth/APNs calls.

## S18b-3 warning feed (2026-10-16)

Parent authorization follows merged S18b-1/#2774 and S18b-2/#2778. This is a new,
separate pre-merge PR scope with its own `issue-2703-s18b3` lifecycle; prior findings,
receipts and counters remain preserved. Root owns actual integration.

- **WF1:** Port the actual legacy warning feed's silent first baseline, deterministic
  identities, 24-hour event head/50,000 fingerprints, five-minute new-event gates,
  grouping, active-zone selection and localized warning message.
- **WF2:** Store feed publications and per-endpoint delivery claims in S3 before one
  submission. Failed, cancelled or uncertain work and process replacement never
  trigger automatic resubmission or startup broadcast.
- **WF3:** Publish only S12 successfully persisted source rows; consume server2 state,
  zone mapping and configured server2 geocoding routes without legacy runtime reads.
- **WF4:** Establish actual legacy oracle parity, fault/concurrency/restart coverage,
  additional synthetic HTTP smoke, maintained manual/PDF/diagram, eligible review and
  fresh CI. No actual push/FCM/OAuth/APNs, deployment or production database write.

The feed and worker remain libraries until S20 installs them together with the
alarm and conditional workers. This does not claim a running push process or device
receipt. Later **S18c is a separate backend/API + publishing CLI + S3 PR** following
#2623; it excludes client/web popups and supersedes the SQLite storage proposal.
