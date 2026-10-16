# Push token callback guard specification

2026-10-16. PROCEED. Consumes [approved intent](../intent/issue-2626-null-token.md); base `915978bb`. Applies to the shared Cordova Push service on both platforms.

Before logging a callback token, calling HTTP, altering `pushData.fcmToken` or posting/saving settings, reject tokens that are not strings or whose trimmed length is zero (AC1). Trimming is an emptiness test only; preserve the exact accepted token string. Existing callback errors still return immediately.

A remembered A survives any number of invalid callbacks. The next distinct valid B passes to the existing `_updateFcmToken`; its PUT contains A/B, then the service remembers B. Another B causes no request (AC2). The first valid token retains the existing PUT and pending-settings POST/save behavior (AC3). No server routes, request fields, scheduling, token generation, units, notification handling or persistence format change.

Guarding this SDK callback is preferred to relaxing backend validation, clearing invalid-token fences or redesigning initial registration. A future failed valid-token PUT still follows today's memory/error behavior; this task does not add retry/rollback semantics. No migration is required. Rollback is reverting the guard/test/docs commit; no backend deployment is involved.

Verification: callback-driven regression with real Firebase/Push factories and isolated browser/native/HTTP adapters, existing client regression suite, and an additional real integration/native smoke. The pre-fix native trace is historical evidence, not a post-fix PASS. No new feature/UI means a new screenshot/PDF user manual is not applicable. Update the existing architecture text/JSON and regenerate HTML with Archify; no new structural diagram is needed.
