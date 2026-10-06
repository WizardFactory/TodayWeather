# Push reliability intent
Owner: root / OpenAI Codex. Source: AK's 2026-10-06 consolidated request; #2683 under #2626, with #2677 regression verification. Revision 2.

A dispatcher timeout permanently stops a Firebase project's future admissions. Restore future eligible delivery without resending the possibly delivered original request. Keep S3 registrations and one coordinator.

- AC1: A delayed original send remains ambiguous and is never retried; a fresh eligible job submits after bounded recovery without restart.
- AC2: Never-settling requests remain charged to physical capacity; recovery probes are limited, while rate caps, 429 cooldown, registration guards and warning reservations hold.
- AC3: Health/metrics distinguish registration readiness, project pause/recovery and transport readiness using only safe aggregate state/reasons.
- AC4: Combined tests preserve preparation retries, token rotation/re-registration fencing and warning priority; record source-derived registration/release findings, weather-latency evidence and per-issue pending device/production checks.

Scope covers implementation, local tests/smokes, commit/push, one PR, CI and independent review/correction using configured GitHub and reviewer accounts. Endpoint is pre-merge: merge_authorized=false. Excludes auto-merge/queue, deployment, restart, production registration mutation, real push, credential writes/disclosure, new accounts or permission-setting changes. Do not auto-close #2626/#2677 or open a speculative iOS issue. #2627/#2589 are closed background.

AK recalls receipt on the older iOS app early last week; exact timestamp/version/device/token is unknown. Current enabled records with disabled token generations do not establish a client defect. Do not force-enable invalid tokens or require an app update without evidence.

Risks: late FCM outcome is ambiguous; retaining hung slots may require operator action when bounded probes/capacity are exhausted. Origin weather latency and native release identity remain evidence questions, separate from transport slowness. Device receipt requires controlled approved verification.

2026-10-06 scope amendment: AK explicitly requested issue-history lookup and read-only S3 backup inspection. Read private release configuration only to compare identity/hash and inventory categories; retain no secret values or private recovery paths in maintained/public artifacts. No backup writes or credential replacement. Acceptance criteria and pre-merge endpoint are unchanged.
