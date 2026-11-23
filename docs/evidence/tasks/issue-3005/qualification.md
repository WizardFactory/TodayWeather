# SR-7 decision on the November 21–22 local rehearsal

**Hold the cloud canary and the live 168-hour run.** The candidate collected domestic weather for a full day and its retained evidence passed the integrity check. The comparison origin served synthetic responses, so the run cannot establish parity with production. The canary and week require separate owner decisions.

On November 23, the integrated evaluator read the recovered SR-6 finish directory using the reader pinned at launch. It produced the same result as the handoff evaluation for all eight criteria. The observation policy was prepared for retrospective analysis. Its family minima are unset. It cannot serve as a pre-approved policy for either cloud stage. [Machine results](qualification-summary.json) · [Exact observation policy](criteria.observation-only.json) · [Scoring definitions](../../../../server2/tools/shadow/qualification_criteria.md)

| Criterion | Result | Observation and decision boundary |
| --- | --- | --- |
| C1 · Evidence integrity | Pass | The evaluator reconciled the launch, reader, ledger and paired files from the recovered bucket evidence. The first full export timed out. Recovery used the original journal and verified 13,111 fixture versions and 3,592 paired files. |
| C2 · Coverage | Unassessed | Of 56 planned cases, 46 had attempts. There were 895 complete two-sided slots and 1,796 admitted attempts, with zero pending. Each origin had 53 slots the evaluator could not account for. The policy specifies no family coverage minima. |
| C3 · HTTP and response sections | Unassessed | All 96 ordinary Seoul address requests to the candidate returned HTTP 200 with temperature. The four domestic coordinate cases produced 387 expected HTTP 501 responses in the rehearsal. A fixture response cannot establish the production status or section contract. |
| C4 · Weather values | Unassessed | The address observations spanned 24 consecutive hourly publications and nine short forecasts. Production values aligned by location, unit, publication and forecast time are missing. |
| C5 · Error rate | Unassessed | Across 901 candidate attempts, 598 returned 501, 50 returned 404, and 48 returned 500. The direct address GET had zero errors across 96 attempts. No production control or approved error-rate bound was supplied for these populations. |
| C6 · Latency | Unassessed | For the 96 successful candidate address GETs, reader wall-time p50/p95/p99 was 2,554/2,606/2,703 ms. The run supplies neither an approved latency bound for this population nor a comparable production baseline. |
| C7 · Operational margin | Unassessed | The measured workload fits the corrected allocation and the modeled cost ceiling below. The evaluator reads paired evidence. It does not attest cloud identity, retained-bucket duration and spend, or recovery on an actual cloud host. |
| C8 · Control variability | Unassessed | No repeat-production sample was taken. The local peer cannot establish baseline variability. The existing 6,000-read ceiling per origin applies. |

## Cost and recovery margins

At the end of the 24-hour run the cumulative cost estimate was **USD 82.472313**. The week model carries USD 82.48 forward and ends at **USD 99.684278 cumulative**. After protecting USD 14 for finish under the USD 300 ceiling, modeled headroom is **USD 186.315722**. These estimates apply to the measured request mix. The disk model requires 11,960,033,280 starting bytes including twice the weekly loss and the 6 GiB reserve. The measured starting-hour minimum was 29,443,330,048 bytes.

The corrected read cap of 1,740,000 leaves **1,648 reads** beyond twice the projected 869,176 reads. On the reviewed SR-6 candidate, all 20 offline seeds reached 168 simulated hours and recovered complete evidence before cleanup. The threshold was 19/20. The local run used a fixture object store and an isolated comparison origin. [SR-6 measurement and recovery](../issue-3004/verification.md) · [Allocation and cost inputs](../issue-3004/allocation-plan.json) · [Reviewed replay](https://github.com/WizardFactory/TodayWeather/pull/3126)

## Evidence needed for the next decision

Before requesting a canary, freeze the production comparison origin, route and method mix, minimum usable pairs per family and observation window, expected sections and units, alignment keys, value tolerances, and absolute error and reader-latency bounds. Identify how conditional responses and missing samples count. Record the owner, date and policy digest before collecting the comparison. The rehearsal's local percentiles and error counts cannot set those thresholds retrospectively.

The cutover policy already specifies gateway 501 rate at or below baseline, p95 at or below 110% of baseline, at least 99.9% of requests within 9 seconds, and cold assembly p95 at most 2.5 seconds. Applying these limits requires the corresponding gateway or assembly measurements and an approved observation window. The local reader measures a different interval. [Cutover decision bounds](../../../operations/server2-cutover.md#5-rollback-decision-and-ordered-recovery)

For the week decision, review canary coverage and results against that policy, the remaining provider and storage grants, and evidence for the intended cloud identity, cleanup, retained-bucket lifetime and cost. A canary approval covers only its specified scope. [Operator procedure](../../../operations/server2-shadow-supervisor.md#offline-qualification-decision)
