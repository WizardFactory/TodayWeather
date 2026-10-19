# F1 final registration copy with deletion reconciliation

Task: `issue-2819-final-registration-copy`; parent [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819), S20 [#2705](https://github.com/WizardFactory/TodayWeather/issues/2705). Baseline `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1`; branch `fix/final-registration-copy-2819`. Endpoint **pre-merge**, merge authority false. Current activity is preparation only pending root gate.

AK authorized the ordered follow-up and parallel implementation preparation. F1 preserves user unregister/deletion and latest acknowledged edits across a final legacy→server2 registration copy. Existing `migrate::plan_import` merges only input rows: its `deleted` count protects server2 tombstones and does not delete prior imports absent from a later export. Retain that API and its semantics.

Provide a bounded, auditable dry-run/apply tool using the existing S18 state journal. It binds a complete final source snapshot, prior import ownership, current native state revision and exact plan digest; any invalid, incomplete, superseded or stale input fails closed before state mutation. Preserve unrelated/native-changed records, existing tombstones and failed/unknown delivery claims. Do not overwrite state snapshots, start a parallel writer service or introduce a new deployment/control framework.

The maintained procedure must distinguish source-code checks from actual operational evidence: all legacy sender processes must have exited and all registration-writing ingress/background writers must be frozen before final export; a Boolean attestation cannot prove those facts. Original Mongo documents stay unchanged. Actual operational execution, S3 application, traffic routing, live sends and quota2724 measurement are excluded. F2 rainfall input decision/runtime wiring is separate and remains pending AK's answer.

Acceptance IDs:

- **COPY-1:** Complete source/import identity, revision, count and digest validation; no deletion from partial/rejected/replayed/superseded inputs.
- **COPY-2:** Preview accurately identifies source-owned absence deletions and retained native records/tombstones, with no write.
- **COPY-3:** Apply the exact approved plan through one bounded durable journal CAS, preserving native edits and claims across conflict/failure/unknown/restart/rollback.
- **COPY-4:** Cold restore verifies the actual final state and operation identity; aggregate receipts contain no tokens, secret values or personal payloads.
- **COPY-5:** Checkable sender-stop/edit-freeze/final-copy procedure and exact placement/documentation boundaries; local proof never becomes operational approval.

[Spec](../specs/issue-2819-final-registration-copy.md), [plan](../plans/issue-2819-final-registration-copy.md), [exact declaration](../server2/config/tasks/FinalRegistrationCopy.json). Root alone owns stages, shared notebook and integration. No test/build/code/commit/PR action is authorized by this preparation file.
