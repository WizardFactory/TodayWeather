# S20a runtime services intent
Task issue-2705-s20a / #2789; owner S20a builder 3f7316e0; 2026-10-16.
Authority: AK's explicit bounded PRE-MERGE assignment, configured accounts only. Implement, test, commit, push, task issue/PR updates and independent review permitted. No merge, auto-merge, deployment, private.env, real provider/AWS/Mongo, OAuth/FCM, paid translation or sends.

Connect selected native APIs through one production constructor, reusing the existing S3 admission/credentials and native weather services. Ordinary SERVER2_NATIVE_FAMILIES selects push/notice. Public weather selection stays independent from push's native dependencies. No new modes or endpoint env variables.

- AC1: Actual public HTTP push registration persists through restart; notice latest/null/cold503/language/headers hold; unselected coexistence retained and native-only startup needs no legacy URL.
- AC2: Typed in-process fetch preserves KMA/DSF versions, units, language and bounded deadlines; strict allowlist, zero legacy/self-HTTP/remote-origin fallback.
- AC3: Shared request-driven WarningStore/feed publishes durable successful warnings only, with existing failure/restart semantics and no startup collection.
- AC4: Relevant tests, separate real HTTP smoke, fmt/clippy/placement/artifact, manual PDF/diagram checks, independent review and exact-head CI support readiness.

Delivery schedulers, FCM account validation, supervised worker shutdown and full production activation remain S20b/#2705. Existing 5s listener drain is not global durable-work drain. Root owns integration and parent planning. Initial base 20cd322 contains core a943; root merged identical core tree at eafd169; no reset/rebase required. Final notice-main integration must be normal merge before final CI.
