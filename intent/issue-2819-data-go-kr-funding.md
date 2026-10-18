# Fix DataGoKr attempt funding (#2819 B2)

A valid first-key call currently depends on reserving an unused next key and2units on the first key. A known local exhaustion also aborts before the next configured key can run. Fund one logical unit immediately before each DataGoKr HTTP attempt; rotate on known local Exhausted only, and remember the key actually used.

- AC1: a first-key successful call with1available unit completes, reserves only1logical unit on that key, and never touches unused key budget or HTTP.
- AC2: locally exhausted A advances to funded B without HTTP on A; subsequent calls retain the working key with existing parallel-safe keyring semantics. All exhausted keys fail without HTTP.
- AC3: preserve2HTTP maximum, deadline/cancellation/no-refund, ambiguous funding fail-closed, provider auth/quota/transient rules, and unchanged VisualCrossing maximum prepayment. Local exhaustion is not a provider HTTP attempt.
- AC4: regression Red/Green, existing provider/budget/format/domestic checks, separate owned HTTP+real funding smoke, docs/diagram/placement and independent review bind the candidate.

No allowance, key/account, quota-measurement, legacy runtime, new mode, live call, cloud, merge or deployment change. Pre-merge authority includes configured-account task code/evidence review transfers, not secrets or new permissions. Production allowance/capacity/shadow/cutover gaps remain.
