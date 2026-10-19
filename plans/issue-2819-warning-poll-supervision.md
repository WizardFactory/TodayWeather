# E3b warning polling execution plan

[Spec](../specs/issue-2819-warning-poll-supervision.md). Exactpaths declared in
`server2/config/tasks/WarningPollSupervision2819.json`. Root uses the existingprimarynotebook.

1. On unchanged runtime, construct real RuntimeServices/Workers with owned HTTP S3 and
   synthetic account configuration. Replace only warning-worker Clock with a test-only
   panic-once clock. Scheduler/otherworkers use the normal clock. Observe first task failure,
   advance to next5s tick, and require a later poll. Quiesce/drain/drop allownedwork BEFORE
   asserting intended failure. Keep an error-return/healthy control separate. Capture actual
   source/test/bin/log/exit; setup failure is not Red. Do not change runtime first.
2. Use actual JoinSet warning task Id instead of bool, compare normal and failed identities,
   release only matching warning. Preserve incomplete accounting/diagnostic/stop/drain.
   Run focused Green plus unrelated-failure/live-warning admission control.
3. Full runtime-services, delivery, library and affected state tests; fmt/all-targetClippy/
   optimizedmain+integrationartifact, sourceprojection/declaration/dependencies/policy.
4. Additional retained optimized integration CLI uses real time (not paused time), actual
   RuntimeServices/worker/owned HTTP S3 and test-only fault. Observe first warningpanic,
   nextregularpoll/~5s recovery, no actual provider/FCM/device, no deliveryclaim replay.
   Record source/bin/fixtures andretireownedports/processes; no fullmain/hostqualification.
5. Maintain current operator/nativeverification/architecture/selectedevidence and sequence.
   Existingfeature bugfix, no newUI/APIendpoint/manualPDF. Finalexistingdiagram refresh
   pinsverifiedcodecommit beforefirstpush/review, actualartifact/browser/scopedvisual.
6. Nativeindependentcurrentreview, selectedcorrection, exactparent/currentCI andfreshremote/
   authority/coupling/source gatebeforepremerge. No merge/cloud/deploy/liveprovider/device.

Full E3 readiness endpoint/S3/credentialsourcehealth remainsopen. C5 acquisition lane is
separate. Recovered polling never authorizes replaying failed/unknown sends or state rewind.
