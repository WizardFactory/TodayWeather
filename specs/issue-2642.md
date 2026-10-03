# Server payment retirement specification
Read [intent](../intent/issue-2642.md).
Delete receiptValidation and each /check-purchase mount only; remaining router order and app fallback stay intact. Remove config.platforms after checking every member: its six settings are exclusive to the validator. Keep Google geocoding and push credentials.
Remove SDK dependency and its exclusive nested jwt-simple; preserve shared dependencies. Delete obsolete live receipt test.
No tombstone handler: GET and POST following middleware reach the app's existing Error(404). Express default error handler renders HTML; the existing three-argument error handlers are not Express error middleware. v000803 unauthenticated POST still returns its existing auth response before matching.
No data migration or entitlement compatibility (no paid users). Rollback is code/dependency restoration, separately deployed by an operator.
Verification: static consumer/lock/config regression, exact remaining mount list, real Express application/routers with explicit offline collaborators, loopback HTTP former routes versus unmatched controls, adjacent functional smoke and existing weather/gateway/push regressions. No live provider or production assertion.
Update mobile API/service overview and an Archify sequence documenting retirement/fallthrough. This is removal, no new feature or UI manual/PDF.
