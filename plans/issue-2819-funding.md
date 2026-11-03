# #2819 B1 implementation plan

One coordinator owns this branch, state and shared build scheduling. Existing execution notebook: 2026-10-13-server2-next-sequence-after-s10. Base master1e31ac1e, branch fix/geocode-attempt-funding-2819, independent runtime scope from C1 PR2820.

1. Freeze old behavior and a per-provider/key Quota spy with owned HTTP peers. Demonstrate complete Korean Kakao lookup blocked by Google quota and old whole-chain charges. Keep the original failure.
2. Remove all-possible demands from Inner::acquire. Fund the chosen provider/key in Inner::call immediately before HTTP, including allowed key rotations. Preserve existing S08 ownership and request caps; do not mutate allowances or production settings.
3. Renew gateway/budget/wire/cache/in-flight tests; preserve old assertions apart from deliberate unused-key cost expectations. Add an integrated example exercising real Geocoder/FundedQuota over an owned provider and volatile S08 transport with exhausted Google and successful Kakao.
4. Update the affected architecture/funding contract and selected verification, validate/browse/inspect illustrative flow; declare every path and check placement and artifact retention.
5. Commit/push PR, current CI and independent review to pre-merge. No merge or production operation. Keep original C1 CI limitation separate.

Scenarios: F1 Korean client uses Kakao with Google spent, sees unchanged projection and no Google attempt/debit; F2 client needs Google supplementation or address fallback, funds only selected keys in actual order; F3 caller faces exhausted keys/cancellation, sees bounded failure or joined result without unfunded/duplicate HTTP; F4 operator runs owned smoke and regressions, retains hashes and scope limits. Map to AC1/2/3/4 respectively, with cache/parity checks throughout.

Risks: wrong key index after rotation, quota rejection losing fallback/metrics, funding IO exceeding remaining deadline, tests retaining obsolete whole-chain accounting, and confusing logical block ownership with actual HTTP. Do not rewrite old quota evidence or claim measured production headroom. Shared target is retained for both task consumers, builds scheduled serially unless an explicit platform/resource budget permits otherwise.
