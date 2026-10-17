# S19a native API release recovery
Problem: existing rollback tests return to legacy and cannot prove a legacy-free recovery path.
Desired outcome: a repeatable owned-loopback current -> previous -> current native API rehearsal, with shared authoritative S3, exact response/header comparison and cache revalidation.
Scope: geocode, domestic partial/missing-data contract, overseas weather/air S3 restore and notice read API. No push worker equivalence or complete S19/cutover readiness claim.
Acceptance: NATIVE no legacy configuration or legacy HTTP; RECOVERY different identified binaries restore identical observed API bytes, ETag/304 and durable S3 after weather providers stop; EVIDENCE bounded execution, exact artifact/report identities and clear unsupported-family limits.
Constraints: no .env/private credentials/real provider/AWS/notifications/deploy; no new runtime verification flag, no production source change. Previous artifact is an explicitly identified candidate, not a qualified production fallback. User authorized proceeding and reviewed main integration in the existing sequence.
