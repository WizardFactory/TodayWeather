# SR-6 local provider rehearsal

The November 20–21, 2026 recovery run collected a full day and recovered its final evidence. A quota renewal defect in the local S3 fixture limited sustained acquisition, so this day cannot establish the cost or resource needs of the corrected candidate. Qualification remains open. The scope was the configured coordinate observations plus a direct KMA address request every 15 minutes. The comparison origin was a local peer. [Rehearsal guide and commands](../../../operations/server2-shadow-supervisor.md#local-24-hour-provider-rehearsal)

## Fault and recovery evidence

On November 19, the isolated Linux host recorded the injected 401, 403 and 429 provider responses at the destination, continued sampling and passed all 19 assertions in each scenario. The initial stall check passed 17/19. The fixture waited 180 seconds for the selected request, which first appeared after 182.85 seconds on replay. With a 240-second observation window, all 19 stall assertions passed. The candidate timed out in 3,003 ms, its trace reached the local state bucket and a later paired slot completed. These checks exercised a cold candidate route.

Two early November 20 attempts stopped on sustained candidate-origin failure at approximately 45 minutes. The later recovery reached its independent deadline on November 21 at 14:00:57 KST. All 1,441 scheduled samples covered 24 consecutive hours, including KST and UTC midnight. Maximum sample drift was one second. Eleven terminal checks passed. Final generation 26 had 901 candidate captures and 895 comparison captures. Independent verification matched 3,592 retained files and all 4,157 object versions present in the fixture's latest-only inventory. The guest was stopped after export.

The address probe returned 96 HTTP 200 responses. Temperature was present for 88 and missing for eight consecutive samples. The last reported current publication was November 20 at 23:00 KST. The observed provider responses included 875 HTTP 401s. Storage authorization failures and paid-provider units were zero. The quota witness inventory contained 12 of 13 API authorities on November 20 and 10 of 13 on November 21. Absent witnesses leave actual use unknown.

## Sizing the observed day

| Candidate counter | 24-hour observation | 7-day projection | Twice the projection |
| --- | ---: | ---: | ---: |
| S3 reads | 80,955 | 566,685 | 1,133,370 |
| S3 write/list attempts | 14,891 | 104,237 | 208,474 |
| S3 PUT body bytes | 5,293,127 | 37,051,889 | 74,103,778 |

The final cumulative guard estimate was USD 80.016718, including a USD 78.98 carry. The repeated-day model gives USD 86.285768 against USD 286 available after the USD 14 finish reserve. These modeled amounts cover the observed acquisition rate. The maximum candidate resident memory was 398,430,208 bytes. Minimum free disk was 29,295,550,464 bytes.

The Rust client consumed its initial 50-unit grant, then failed to parse the stored quota object when renewing. The candidate fixture supplies a JSON content type on GET and HEAD for authorities and witnesses. With the correction, the actual client acquired two 50-unit blocks through loopback, wrote both witnesses and rejected unit 101. The measured replay at the former 900,000-read cap exited before running any seeds. The revised cap is 1,140,000 reads. The replay grant for this measurement is 1,133,370. Representative sizing still requires observing sustained renewal in the measured workload.

| Retained evidence | SHA-256 |
| --- | --- |
| Initial Linux provider fault report | `8fb5c0490a2d4627012885892ce6a02cda11138362c1ad2c60d078a3321f0182` |
| Linux stall rerun | `8ccaea46b76564d25bedd3b33a38cba858bff01e9668b0902c11919feafda6a9` |
| 24-hour measurement | `e0ac64de515e742d46413a50f72fa511b10406821d317c95d2531858cd979ec1` |
| Private retained archive | `da3f65d5578849f959bdc1d0ac722877da031909ab3c7ba2c999b99f6d54103f` |
