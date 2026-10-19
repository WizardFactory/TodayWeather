# Push state safety contract

Source: #2819, the reviewed current-master reproductions, and AK's 2026-10-18 ordered implementation request.

- Every document is bounded and valid for the owned persistent representation before commit. Embedded document keys cannot begin with `$` or contain `.`; generated typed dates/non-finite numbers remain supported. Updates retain schema-supported dotted update syntax while stored field names remain safe.
- Validation covers HTTP and direct durable/migration writes. Invalid input uses existing store-error responses, preserving unrelated acknowledged records and journal sequence. No record may be acknowledged if its future restore would fail.
- Compact stored document decoding returns an explicit error. Restore applies no part of an invalid entry and never silently skips it or rewrites acknowledged history. Existing invalid durable bytes stay preserved and the service stays not ready.
- Readiness requires restored state and a live writer. The writer relinquishes readiness on normal exit, abort or unwind. Existing public liveness is retained; production aggregate readiness/S3/credential work follows in the later readiness slice.
- No claim deletion, automatic retry or external send is introduced.

Acceptance AC1-AC4 is defined in intent. Verify actual registration insert/update, mixed valid/invalid journal atomicity, typed round trips, valid operation after rejection and restart. Use existing state and delivery harnesses and an additional owned-loopback functional smoke.
