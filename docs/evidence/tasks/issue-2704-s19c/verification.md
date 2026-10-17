# Paired release recovery — selected local verification

Current: `16f3dfde76efe2d0bc491f65847a596edbd96128`; previous: `0fc0442dcf31e9786823f5528bd3b06a41906338`. Each bundle has eleven distinct corresponding release executables with verified hashes. Dirty-build/source-to-commit mappings are retained locally; no historical build receipt was rewritten. The logging correction after this current release is separate; this run does not claim to execute that later candidate.

Actual command: `python3 server2/tools/shadow/release_recovery.py --artifacts <explicit pair manifest> --out <new output>`. macOS arm64, Rust1.99 release inputs, owned loopback peers, synthetic key/account, injected clock and recorded NativeFetch. No live provider, AWS, device or deployed host action.

| Layer | Observed |
| --- | --- |
| Family contracts | Nine fixed checks per release; eighteen PASS. Existing assertions/counts retained; selected subset, `full_coverage: false`. |
| Native API | Three current/previous/current phases; legacy HTTP 0; restored weather calls 0. Shared S3/disk, exact bodies/headers/ETags retained. |
| Durable workers | Fourteen PASS: seven failure/success stages starting with each release. Opposite and original releases actually attempt claim admission, restore existing registrations and preserve exact claim bytes. |
| Mixed-release overlap | 1 owned post, 1 claim owner, 2 observed claim attempts. |
| Admission/report controls | Thirteen PASS, including corrupt unselected role blocked before child, unsupported production scope, reused output refusal, child failure and missing/no-op result cannot become PASS. |

Unknown sends remain unknown; no claim is replayed on restore. Claim-before-send cancellation may leave an unsent claim by existing at-most-once policy. Successful alarm/conditional sends are provider acceptance, not device delivery. Restored registrations were modified as existing records, not silently upserted.

Intended admission Red reached a complete valid pair and failed the unsupported initial implementation. A separate intended report Red proved an empty/no-op run was incorrectly accepted before assessment was implemented; Green and post-refactor thirteen controls pass. Fake executables appear only in admission controls, never as product proof.

## Identity and limits

Functional report SHA-256: `b094d454c4fff6fbe95814732cb56f014534366bcb12a1f860e7f90717d27409`.
Tool SHA-256: `d01cb32b09db35e8e120d2c7a9a6d199412f10951da512db0ee467e2c00d345d`.

The API layer uses four bounded cases (geocode, partial KMA, world air and empty notice), not complete mutation/history coverage. Worker entrypoints use production lifecycle with injected NativeFetch and compile-time checkout fixtures. The current harness drives both releases; these are not portable standalone release packages. `whole_service_eligible` stays false. Production activation, host/config compatibility, live shadow, device reliability and #2724 quota measurements remain outside this task.

[Actual selected report capture](recovery.png), [operator guide](../../../operations/server2-release-recovery.md), [PDF](../../../operations/server2-release-recovery.pdf). Full generated evidence stays under ignored reports; this summary/capture is maintained.
