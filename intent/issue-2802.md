# Structured operational diagnostics for server2

AK selected issue2802 together with remaining S19 recovery verification and emphasized fast incident resolution. Operators must reconstruct an operation across request handling, shared acquisitions, queues, background workers and durable state: cause → action → outcome. Preserve HTTP bytes, timeouts, quotas, retries, delivery ownership and no-retry semantics.

- AUDIT: maintained subsystem inventory maps current gaps to implemented coverage or reasoned exclusions.
- TRACE: generated nonsensitive trace/operation/parent IDs survive async/blocking handoffs and queues; shared-work joins explicitly link to the owner rather than falsely reparenting it.
- DIAGNOSE: normal/failure/retry/fallback, cancellation, external acceptance versus confirmed completion, and existing reconciliation/void compensation produce safe classified events.
- PRIVACY: typed/allowlisted event fields never accept URL/query/body/credential/token/coordinate/notification text or registration identifiers; tests use synthetic sensitive values.
- BOUNDS: bounded events/queue/rate, nonblocking producer, independent drop/loss counters, runtime verbosity and documented stderr/rotation/retention/access handling. Logging failure cannot alter business outcomes.
- PLACEMENT: all runtime/config/tests/tools under server2; exact docs exceptions declared in server2/config/tasks/Logging.json.

Authority: AK “2번은 진행하지 않음. 1,3번 진행해줘 특히3번…”; continues scoped implementation, commits/PR/reviews/CI and reviewed main integration. Task code/evidence may reach configured independent reviewers. Explicitly exclude #2724 quota measurements, deployment, live-provider calls, live shadow, device sends, credentials disclosure and permission/account changes. Logging does not qualify operational rollback or cutover.
