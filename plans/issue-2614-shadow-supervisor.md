# Shadow supervisor implementation plan

One coordinator owns shared interfaces and state. This is one integration PR stacked on the paired-read sampler bb75a6d. Do not merge or launch a partially connected supervisor.

| Slice | Outcome | Dependencies | Owned paths | Checks |
|---|---|---|---|---|
| SS1 | Durable run identity, deadlines, mutation intent, precharged generations, typed result classification | settled spec/design | deploy/shadow/state.py; integration/test_shadow_supervisor.py | reopen, conflicting identity, rollback, failed/unknown launch, concurrent owner, exact error typing |
| SS2 | One common opt-in S3 attempt/PUT allowance, defaults unchanged | SS1 and declared runtime paths | six transport adapters plus shared settings/startup owner (declare before edits) | every physical send, concurrent final reserve, pagination, cancellation/error and no implicit retry |
| SS3 | Bound real host/process, reader and lifecycle; original evidence export and exact cleanup | SS1 + SS2 | deploy/shadow/coordinator.py, provision.py, remote.py, guard.py, bootstrap.sh | isolated AWS and Linux fixtures, original bytes and hashes, deadline/process loss/unknown outcome cleanup |
| SS4 | Complete operator user path and prelaunch policy | SS3 | CI, operations guide, manual and diagram | separate CLI smoke, placement, artifact policy, manual visual inspection, independent PR review/CI |

SS1-SS3 implementation is connected. SS4 verifies the final candidate; paid rates must match enabled APIs, and actual Linux checks, independent review and CI precede cloud enablement. No independent implementation workers own shared files. Existing sampler tests/review are reused unless its source changes.

## User scenarios

1. **Resume after coordinator crash (LIFETIME, BUDGET):** AK has an initialized run. Close/reopen the actual journal after recording an uncertain launch. Expect unchanged original expiry, unchanged spent allocation and no new launch permission for the old generation. A conflicting identity or clock rollback stops acquisition.
2. **Concurrent operator (LIFETIME):** With the first coordinator holding the journal, start a second process. Expect rejection without AWS calls; after owner death the next process can reopen existing state without resetting it.
3. **Failure during cleanup (CLEANUP):** Supply AccessDenied, timeout, malformed output and successful-empty fixtures to actual result classification. Expect unknown rather than absent. Only the expected service error or correctly shaped successful inventory may prove absence.
4. **Generation spend (BUDGET):** Reserve S3 read/write/PUT-byte allocations, including a launch with lost acknowledgement. Expect no refund, atomic compound allocation, no fourth generation and no dispatch after acquisition ends.
5. **One bounded host (BIND, SOURCE):** Using offline AWS/Linux fixtures, exercise plan, initial acquisition, duplicate-start rejection, source export and cleanup. Expect exact process/artifact linkage, original-source hashes, no device sends and independent absence proofs. Live acquisition remains disabled until this integrated scenario and policy checks pass.
6. **Maintainer validation (PLACEMENT):** Run declared-path and artifact checks on the full candidate; inspect manual captures and docs. No legacy source dependencies or root runtime assets may be introduced.
