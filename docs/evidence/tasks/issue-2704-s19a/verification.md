# Native API release recovery verification

Observed 2026-10-17 UTC on macOS/aarch64. Both are actual release
`loopback_server` test examples: current server2 source29ab51fc and previous
171472c5. Source comes from the current checkout and a tracked-only Git archive,
not legacy. The corrected Python tool was uncommitted during this run; its exact SHA256 is
recorded below. No production main, private .env, AWS, live provider, push or paid
translation execution is claimed.

| Phase | Native APIs cold/warm | VC / air provider calls | S3 raw GETs | Peer connection refusals |
| --- | --- | --- | --- | --- |
| current | 4 / 4 | 1 / 2 | 3 | 0 |
| previous, providers unavailable | 4 / 4 | 0 / 0 | 2 | 0 |
| current, providers unavailable | 4 / 4 | 0 / 0 | 2 | 0 |

Bodies/status/full functional-header union match. Revalidation of the three
ETag-bearing cases returns304/empty across both release changes. VC uses a
verified disposable disk copy across processes; the two privacy-excluded air
raws are reread from authoritative S3. One owned S3 and disk root are maintained
throughout; no canonical data resets occur. Notice is read-empty only and KMA is
partial/missing data. This does not qualify push workers, state mutations,
warning delivery, summaries, CloudFront/EC2 or full production rollback.

The earlier persistent test-peer variant observed real connection refusals under
its unchanged16-slot cap and intermittent KMA501. Two older diagnostic runs
returned PASS while counting refusals; they remain unchanged historical results,
not evidence of the current zero-refusal gate. Separate KMA501 runs returned FAIL
and are also retained. This small workload uses the shared peer's default close-after-response
behavior; its cap/timeouts and all runtime code remain unchanged. Zero refusal
is now an assertion. No response/status/deadline comparison was relaxed.

Other setup history is retained: missing synthetic data.go.kr key, sandbox socket
refusal, initial manifest/parser setup errors, and identical old/current Cargo
output refusal. The two-region air-call expectation was corrected after actual
paths proved distinct Seoul and London cells, not duplicate London calls.
Original expectations/failures were not relabeled PASS. The current verified
pair below was produced after cleaning only the eligible server2 package output
under the shared build lease, with previous executable/hash preserved first.

Ten Python controls cover artifact fields/revision/hash/profile, mandatory ETags
(the old equal/no-ETag comparison failed its new regression control), notice
without an ETag, and response
or acquisition mismatches. Existing shadow31 tests pass separately. No repeated
whole Rust suite was needed for Python-only tooling; required CI remains a
separate current-commit gate. Full S19/S20 readiness remains open.

- current release: `f9c13dede12cd64d2431e5bc106423435467a6cf8e3cf10d071346ae70a1b60b`.
- previous release: `b8946fdd2af2e3a7820edc0ecb22c13fd523b8b1fbdc910654843bb9ca0f033d`.
- verification tool: `b1772b0abeaddd893683f9a23d4b52765f3260060feb7144988009e17e59f1d1`.
- actual report: `4fa7d47f75d77036c9060c4eee10ba1259e93ef85e720339a6b410ddb41fb0be`.

[Operator guide](../../../operations/server2-native-recovery.md), [actual output capture](recovery.png).
