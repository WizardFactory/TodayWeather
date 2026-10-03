# Policy evidence reconciliation specification

Inputs: [intent](../intent/issue-2660.md), [privacy worksheet](../docs/operations/store-privacy-review.md),
[retention controls](../docs/operations/store-data-retention.md).

Update the four operating documents consistently for AC1–AC3. Distinguish approved
retention standards, unverified deployment/settings and effective published policy.
The evidence map identifies source-review revision, policy section numbers, store
classification questions, nine existing drafts, named owner and final-device scenarios.
The retention runbook covers MongoDB, SQLite, S3 device metadata/object versions,
retry/restart re-creation and exact ownership checks; no device-deletion command is added.
Raw logging/prefill observations remain tracked gaps; Analytics whitelist does not
sanitize general logs. Preserve existing draft banners and all public HTML bytes.

No interface, data model, route, collector, response or storage behavior changes.
No diagram source regeneration or app manual/PDF is needed because there is no design,
flow or UX change. Existing source references support documentation; compiled/network
runtime and provider contract conclusions remain open release gates.

Check links/content/scope and staged/outgoing artifact policy. Reuse the existing 41
consent/monetization tests as contextual source evidence, not a device/network PASS.
The independent PR reviewer challenges accuracy, acceptance scope and all code links.
Rollback consists of reverting the document commit; no customer-data rollback exists.
