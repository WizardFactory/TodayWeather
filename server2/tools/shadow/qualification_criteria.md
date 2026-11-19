# SR-7 offline criteria, schema 1

Before requesting a cloud run, freeze the exact criteria JSON and launch/reader digest together. Preserve the policy digest, author, decision date, response family, stage (canary or week), expected units and source of each chosen bound in the operator record. The evaluator records the input digest. A matching digest alone cannot establish who approved it or when. This preparation supplies a scoring method. Production thresholds still require a run-specific policy.

Run from the repository root with a fresh private output path:

```sh
python3 -I server2/tools/shadow/qualification_evaluator.py --criteria criteria.json --evidence finish --out qualification.json
```

Exit 0 means a report was written. Read its recommendation. A failed required check produces `no_go`. Incomplete qualification produces `hold`. Neither result authorizes a launch.

| ID | Measure and denominator | Required input and interpretation |
| --- | --- | --- |
| C1 | Launch pins reader, candidate and sampler. Reconcile captures with the ledger. Replay final bucket versions or inspect stopped SSH files. | Changed bytes or inconsistent identity fail. Incomplete finish or missing holdings are unassessed. Local file integrity does not establish independent custody. |
| C2 | Per family and case, planned slots are the ceiling of duration divided by interval. Report admitted, pending, skipped and unaccounted per origin. A usable pair has the same expected 2xx and no transport/capture or declared shape failure. | Supply a family count minimum or null. Zero usable pairs leave coverage unassessed. The status covers the count only. Freeze per-case geography and period representation separately for each stage. Missing days, midnight boundaries or a route with no samples require review. |
| C3 | Report matched HTTP statuses, missing status, disagreement and 304 limitations per family. For ordinary GET, validate each declared section path and JSON type per origin on expected successful captures. | Freeze expected statuses for every case. Inspect HEAD status/headers separately. Conditional validators are origin-specific. A captured 304 lacks retained request-validator context. GET JSON rules on HEAD or conditional cases invalidate that binding. An unexpected HTTP status or required shape violation in the production profile fails. |
| C4 | For each pair of valid GET bodies, compare the small declared set of user-visible scalar fields at identical non-null alignment keys. Count within tolerance, different, missing value, invalid type, missing alignment, unaligned and unsupported precision separately. | Bind location, units, publication and target time as applicable. Exact comparisons are type-sensitive. Numeric tolerance is inclusive and in the captured units. Unaligned values supply no evidence of parity. Same-publication required field differences in production fail. Arrays require a family-specific row adapter before a value verdict. |
| C5 | Distinct known errors divided by all admitted attempts, with pending included in the worst case. Track transport, truncation, unexpected status, capture failure and malformed/invalid contracted HTTP 200. | Per family and origin pin maximum basis points and minimum admitted. Exceeding the bound with known errors fails. A pending-sensitive decision remains unassessed. Establish the overall maximum/error window with AK. The cutover 501 limit requires a comparable baseline. |
| C6 | Per-origin reader wall time, nearest-rank p50/p95/p99 of expected usable 2xx and fraction of **all admitted** within a frozen millisecond bound. | Pin minimum admitted and within-bound basis points. Compare both extremes of pending. The cutover gate requires ≥99.9% within 9 s, p95 ≤ comparable baseline +10%, and assembly-only cold p95 ≤2.5 s. Reader wall time includes subprocess and transport. Owner acceptance of the 9 s mapping and separate cold/cache/assembly evidence remain outstanding. |
| C7 | SR-6 hourly rates, seven-day projections, allocations ≥2× projections, measured-rate simulation ≥19/20, all early stops explained, projected spend below remaining ceiling including finish reserve. | Require actual SR-6 receipts, prior spend and retained bucket disposition/cost. Report install/IAM startup risks. Retention may outlive the host. Synthetic transfer counts do not measure provider or cloud spend. |
| C8 | Optional repeat-production control on frozen same-route/method/period subset. | Current ceiling is 6,000 per origin. Production variation remains unquantified. Additional reads require AK's separate decision. |

## Run-specific JSON

Required keys are `schema: 1`, `profile` (synthetic, local_peer or production_shadow), `run_id`, `launch_sha256`, `cases` and `minimum_usable_pairs`. Case IDs must exactly match the pinned reader. Each case declares `family` and `expected_statuses`. A count minimum of null represents a pending bound.

Optional ordinary GET case member (illustrative synthetic paths and tolerance only):

```json
{"json_contract":{"sections":{"current":"object"},"alignment":["publication","location","units"],"values":{"current.category":"exact","current.temperature":{"absolute_tolerance":1}}}}
```

Paths traverse object keys separated by dots. Supported section types are object, array and string. Presence checks type and permits empty containers. Up to ten sections and values combined per case. Numeric rules accept finite decimal units. Values outside the supported exact-ratio exponent range are counted as unsupported. Keep one versioned measure set per family and use distinct families for different unit or public route contracts. Verify domestic current/forecast sections, overseas hourly/daily/AQI and geocode place fields against the actual frozen routes before supplying paths. A missing body contract leaves shape and values unassessed.

Optional family/origin maps are `absolute_error_limits` (maximum_error_bps, minimum_admitted) and `reader_elapsed_limits` (maximum_ms, minimum_within_bound_bps, minimum_admitted). Omission leaves the corresponding threshold unassessed. Synthetic profiles expose observations only for C3–C6. Local-peer C5/C6 can assess the candidate with explicit bounds. Peer observations cannot establish production parity. Production profile is criteria-declared and needs independent origin provenance. C3/C4 never grant overall parity from partial coverage.

## Sources

- [SR-7 issue](https://github.com/WizardFactory/TodayWeather/issues/3005) and [SR-6 rehearsal contract](https://github.com/WizardFactory/TodayWeather/issues/3004).
- [Cutover rollback bounds](../../../docs/operations/server2-cutover.md#5-rollback-decision-and-ordered-recovery) and [shadow supervisor operations](../../../docs/operations/server2-shadow-supervisor.md).
- [Reader](paired_read.py), [retained bucket audit](../../deploy/shadow/evidence_audit.py) and [finish](../../deploy/shadow/provision.py).
