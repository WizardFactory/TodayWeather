# Ordered #2819 correction plan

Execution notebook: existing named server2 next-sequence plan owned by the coordinator. Issue status remains on #2819. Current base: 1e31ac1e. One coordinator owns shared interfaces and build scheduling.

1. **Safety2819 (ready frontier): C1 durable state safety and writer readiness.** Base master, fix/push-state-safety-2819. Paths declared in server2/config/tasks/Safety2819.json. Compact document reads become fallible; validate all changed records before durable writes and atomic state application. Drop releases writer readiness. Test two reproduced HTTP paths, depth/size/dotted names, direct commit bypass, corrupt mixed journal, and valid restart/typed compatibility. Additional owned-loopback smoke. Preserve original bad journal; no silent skips.
2. **Funding/publication:** B1/B2/B3, D1 and narrative error cache; separate task/declaration/base after Safety2819 or independent master only if no shared dependencies. Pin publication provision offsets before frozen-clock assertions.
3. **Notification scheduling:** C2-C6 plus warning panic ownership. Preserve failed/unknown no-retry; test minute crossing, idle acquisition and bounded 5,000-recipient work.
4. **Capacity/observability/config/CI:** D2/D3, S3/CPU fairness, aggregate private readiness, production effective config, G1/G2 and scope-safe operations docs F1/F2. No account quota lookup or implicit live-role probe.
5. **Requalification:** freeze candidate/recovery pair preserving narrative and all capabilities; renew affected parity/deadline/cache-loss/process checks before final seven-day shadow.

Each item is a coherent PR with its tests and affected documentation, not a claim that #2819 is complete. Dependent PRs target their unmerged parent; reconcile after integration. No merge or production authority is inferred.

## User scenarios / test map
- AC1: unauthenticated caller submits malformed units; receives store error, no new journal entry, then valid registration succeeds. Repeat through an existing alert update with malformed precipAlerts.
- AC1/AC4: ordinary client uses supported units/dates and dotted update syntax; parity and typed restore remain valid.
- AC2: operator restarts against a mixed valid/invalid acknowledged entry; reports not ready without applying a prefix, advancing past it, rewriting bytes or panicking.
- AC3: process owner stops or loses writer; readiness becomes false and work is not acknowledged.
- AC4: concurrent owners and lost-write response use unchanged conditional sequences/void reconciliation and retain accepted state after restart.

Risks: internal API error propagation, accidental partial entry application, changed wire error shapes, overbroad EJSON validation and compact-state memory regression. Reject storing fully decoded copies for every record or silently dropping bad records. Reuse compact encoded state and propagate errors. Changes are proven by Red/Green state tests, neighboring delivery/parity suites, loopback smoke, clippy/build and independent review.
