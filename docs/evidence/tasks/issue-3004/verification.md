# SR-6 local provider rehearsal

The November 21–22, 2026 rehearsal measured the isolated Linux candidate against real domestic providers for 24 hours. It used a local comparison origin, local S3 and the issue-specific public-data key. The reader kept its coordinate cases and sent a native Seoul KMA address request every 15 minutes. The measured rates and cost projection apply to that workload. [Rehearsal guide](../../../operations/server2-shadow-supervisor.md#local-24-hour-provider-rehearsal)

## November 21–22 measurement

The independent timer stopped collection at 17:47:10 KST on November 22. All 24 hourly bins were complete. Samples crossed both KST and UTC midnight. The final reader generation contained 1,796 completed attempts, with no pending attempts or capture failures.

All 96 quarter-hour Seoul address responses returned HTTP 200 and included a temperature. The responses contained 24 consecutive hourly current publications and nine short forecasts. The four domestic coordinate cases recorded 387 candidate HTTP 501s. The comparison peer was synthetic. The quota records showed second-block renewal for 12 API/day combinations and advancing stored publications. Provider-side successful request totals are unavailable. Only the approved public-data API endpoint used the external provider connection. The public-web loopback fixtures returned 894 HTTP 401s (816 for KMA routes, 74 for AirKorea and four for MFDS). Paid units, storage authorization failures and recorded HTTP 429s were zero.

| Candidate S3 counter | Measured day | Seven-day projection | Grant at twice the projection |
| --- | ---: | ---: | ---: |
| Reads | 124,168 | 869,176 | 1,738,352 |
| Write/list attempts | 23,742 | 166,194 | 332,388 |
| PUT bytes | 20,988,468 | 146,919,276 | 293,838,552 |

Candidate RSS peaked at 455,622,656 bytes, with at least 29,079,822,336 bytes of free disk. The day used 2,143 host CPU seconds and 10,771,383,569 bytes of external TX. Including fixture PUT payloads gives a seven-day TX estimate of 75,736,573,745 bytes. The cumulative guard estimate closed at USD 82.472313. Carrying USD 82.48 into the modeled week gives USD 99.684278 cumulative, leaving USD 186.315722 after the USD 14 reserve under the USD 300 ceiling.

The measured binary had a read cap of 1,140,000. The replay candidate raises it to 1,740,000 to accommodate this workload. The rehearsal's original 180-second finish timeout expired during the full fixture export. At that point the bucket audit had recovered the final generation and verified its paired files. The original driver exited with an incomplete report. The operator resumed the original finish journal with networking isolated and host capture data hidden. The remaining four checks passed. Independent verification of the recovered archive matched all 13,111 synthesized versions in the latest-only fixture inventory and 3,592 paired files. Both original and recovered archives were preserved. The recovered hourly input differs from the first checkpoint only in its terminal completeness flag. The revised full-inventory test harness gives the fixture finish CLI up to 30 minutes after collection.

The resume receipt SHA-256 is `c9923ee3d05760c76df1f6f6fbf231a8a0153c2f6e0eb769937eda7dc3721621`. The host log creation and final write span 400 seconds (17:52:51 to 17:59:31 KST) for the resumed operation. The 1,800-second limit is a bounded allowance for full fixture export. The short fixture retains its 180-second timeout.

The first hourly disk minimum was 29,443,330,048 bytes. Counting each decrease and one extra 30,605,312-byte transition per day gives 394,113,024 bytes of daily modeled loss and 2,758,791,168 bytes over seven days. Twice that loss plus the 6 GiB reserve requires 11,960,033,280 starting bytes. These figures apply to the observed workload and filesystem.

Use the [hourly measurement](hourly-measurements.json) and [bound allocation plan](allocation-plan.json) as the simulator inputs. The recovered measurement SHA-256 is `8bb3c01149a56eefebbf3c4e21588f823473e9848620345afcaabebe89f49cd2`. The recovered archive SHA-256 is `44b7ecb4ad11951bd766a1a79d678aec5f5d8537cf73e8e4fddb471721e0fc7b`.

## Earlier fault checks and November 20–21 recovery

On November 19, the isolated Linux host recorded the injected 401, 403 and 429 provider responses at the destination, continued sampling and passed all 19 assertions in each scenario. The initial stall check passed 17/19. The fixture waited 180 seconds for the selected request, which first appeared after 182.85 seconds on replay. With a 240-second observation window, all 19 stall assertions passed. The candidate timed out in 3,003 ms, its trace reached the local state bucket and a later paired slot completed. These checks exercised a cold candidate route.

Two early November 20 attempts stopped on sustained candidate-origin failure at approximately 45 minutes. The later recovery reached its independent deadline on November 21 at 14:00:57 KST. All 1,441 scheduled samples covered 24 consecutive hours, including KST and UTC midnight. Maximum sample drift was one second. Eleven terminal checks passed. Final generation 26 had 901 candidate captures and 895 comparison captures. Independent verification matched 3,592 retained files and all 4,157 object versions present in the fixture's latest-only inventory. The guest was stopped after export.

The address probe returned 96 HTTP 200 responses. Temperature was present for 88 and missing for eight consecutive samples. The last reported current publication was November 20 at 23:00 KST. The observed provider responses included 875 HTTP 401s. Storage authorization failures and paid-provider units were zero. The quota witness inventory contained 12 of 13 API authorities on November 20 and 10 of 13 on November 21. Absent witnesses leave actual use unknown.

## Earlier diagnostic sizing

| Candidate counter | 24-hour observation | 7-day projection | Twice the projection |
| --- | ---: | ---: | ---: |
| S3 reads | 80,955 | 566,685 | 1,133,370 |
| S3 write/list attempts | 14,891 | 104,237 | 208,474 |
| S3 PUT body bytes | 5,293,127 | 37,051,889 | 74,103,778 |

The final cumulative guard estimate was USD 80.016718, including a USD 78.98 carry. The repeated-day model gives USD 86.285768 against USD 286 available after the USD 14 finish reserve. These modeled amounts cover the observed acquisition rate. The maximum candidate resident memory was 398,430,208 bytes. Minimum free disk was 29,295,550,464 bytes.

The Rust client consumed its initial 50-unit grant, then failed to parse the stored quota object when renewing. The candidate fixture supplies a JSON content type on GET and HEAD for authorities and witnesses. With the correction, the actual client acquired two 50-unit blocks through loopback, wrote both witnesses and rejected unit 101. The measured replay at the former 900,000-read cap exited before running any seeds. The first revision raised the cap to 1,140,000 reads. The replay grant for this measurement is 1,133,370. The November 21–22 measurement above supersedes this diagnostic projection.

| Retained evidence | SHA-256 |
| --- | --- |
| Initial Linux provider fault report | `8fb5c0490a2d4627012885892ce6a02cda11138362c1ad2c60d078a3321f0182` |
| Linux stall rerun | `8ccaea46b76564d25bedd3b33a38cba858bff01e9668b0902c11919feafda6a9` |
| 24-hour measurement | `e0ac64de515e742d46413a50f72fa511b10406821d317c95d2531858cd979ec1` |
| Private retained archive | `da3f65d5578849f959bdc1d0ac722877da031909ab3c7ba2c999b99f6d54103f` |
