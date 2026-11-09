# Plan for client validation

Task declaration: `server2/config/tasks/KMA-CLIENT-VALIDATION.json`. Follows the EC2 restart comparison of #2866 and #2872 and AK's definition of 2026-11-07.

1. Write `server2/tools/verification/kma_client_validation.py` with the `capture` and `compare` commands, standard library only.
2. Test both with synthetic bodies, recorded legacy bodies and a loopback server in `test_kma_client_validation.py`, and add it to `server2/tools/ci.py`. CI did not run the `tools/verification` tests before: `run_isolated.py 'test_*.py'` discovers only `server2/deploy/benchmark`.
3. Correct the documents that present a `kma_client_eval.py` pass as complete delivery.
4. Open a draft PR and take it through CI and cross-provider review. AK decides on the merge.
5. Use the tool on the EC2 parity run (server2 master on an empty bucket and the production API, same paths and times) to list what server2 does not provide; the fixes are separate tasks.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| Developer | Know whether a server2 answer gives the client everything it gets today | A server2 body and a production capture of the same path within the same publications | `compare --reference prod.json --candidate server2.json` | Exit 0, or exit 1 with each missing row, field and value by path | Different publication times: exit 2, recapture | COMPARE, EXCLUDED |
| Developer | Record what the app receives | Network access to the production API | `capture --path /weather/v000903/coord/37.566,126.978 --out dir` | Body and metadata with time and cache headers | HTTP error or non-JSON: recorded, exit non-zero | CAPTURE |
| Developer | Check a restart's first answer | A steady answer of the same process as reference | `compare` with the steady answer as reference | Missing current observations and past days listed; missing UV listed under excluded parts for the restart check to count | Restored parts arrive later: the steady answer shows them | COMPARE, EXCLUDED |
