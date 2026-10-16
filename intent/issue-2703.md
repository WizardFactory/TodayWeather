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
