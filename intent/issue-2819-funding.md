# Fund only selected geocoder attempts (#2819 B1)

AK authorized the reviewed corrective order and continuation on2026-10-18. This independent merge unit follows C1 PR2820 and starts on master1e31ac1e; runtime funding does not depend on C1 interfaces. Endpoint is pre-merge, no merge or production authority.

Complete Korean Kakao results currently require/debit Google and unused Kakao keys because all possible demands are consumed before provider selection. Fund only the selected provider/key before eligible HTTP, preserving actual provider ordering, response projection, shared ownership, durable admission and deadlines. Do not measure actual key usage/quota (#2724 remains skipped), invent allowance values or change data.go.kr/publication policy.

AC1: complete Kakao-only lookup succeeds even when the configured Google test quota is exhausted; no Google attempt/debit. AC2: only actually selected key attempts are funded; key rotation and Google/Kakao fallback preserve existing order and wire fields. AC3: unfunded keys perform no HTTP, deadlines remain bounded and joined/cancelled waiters do not duplicate spending or refund ambiguous work. AC4: current gateway/cache/parity/budget checks, separate owned integrated smoke, documentation/placement and independent review pass.

Paths are declared before edits in server2/config/tasks/Funding2819.json. No live provider, key/account lookup, cloud, traffic mirror, sends or deployment. #2819/S19/S20 stay open.
