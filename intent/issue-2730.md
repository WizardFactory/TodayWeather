Task: issue-2730-s10b; owner: S10b builder (Claude); base: d15ea118 (origin/master); date: 2026-10-13.
Authority: AK decided the fix on 2026-10-13 and delegated S10b implementation to a reviewed, unmerged PR (endpoint pre-merge).
Criteria: AC1, AC2, AC3, AC4, AC5.

# Intent

Make the gateway's 9-second deadline response reach the client. Today the foundation's absolute connection lifetime (`SERVER2_CONNECTION_SECONDS`, default 9) closes the socket at about 9.0 s, just before the gateway writes the legacy `501 Not Implemented` (S19-GAP-1, found in #2704).

AK decision (2026-10-13): when the gateway is enabled, the default connection lifetime is 12 s, and a configured lifetime of 9 s or less is a startup configuration error.

- AC1: Gateway enabled, no lifetime override: a request that reaches the 9 s deadline receives the legacy 501 bytes and functional headers, not a closed connection.
- AC2: Gateway enabled and `SERVER2_CONNECTION_SECONDS` of 9 or less: the process exits with a clear configuration error before binding any listener.
- AC3: Gateway disabled: the 9 s foundation default and `server2/src/listener.rs` semantics are unchanged; the foundation smoke passes.
- AC4: The S19 `smoke.sh` and rollback rehearsal pass without the S19-GAP-1 exception; the S04 placement gate passes.
- AC5: Operations and architecture documents (and regenerated PDFs) describe the decided lifetime contract instead of the open gap.

In scope: server2 configuration, regression tests, S19 rehearsal tooling, affected docs/PDFs, commit/push, PR, CI, Codex review and corrections. Excluded: merge/auto-merge/queue, AWS, live providers, deployment, secrets, `plans/issue-2614.md`, and any change to `listener.rs` lifetime semantics.

Risk: a 12 s absolute lifetime lengthens the slow-header bound for gateway processes by 3 s. A keep-alive request that starts more than 3 s after connection accept can still outlive the connection; the 501 guarantee covers a request that starts within lifetime minus 9 s of accept. This is a documented limitation of the chosen option, not a new behavior.
