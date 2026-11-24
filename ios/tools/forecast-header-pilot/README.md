# Forecast header pilot

Compare the [selected run](../../../.github/workflows/ios-forecast-header-pilot.yml) and [full verification](../../../.github/workflows/ios-release.yml) on the same commit. The [pilot plan](../../../plans/issue-3089.md#forecast-header-pilot) defines eligibility and assessment. The current [visual merge rule](../../../docs/development/ci-tiers.md#ios) applies throughout the trial.

Review the entire PR diff and affected consumers before classifying a head as eligible. Use full verification for shared changes or uncertain scope. Dispatch both workflows from the reviewed branch at its exact head after the pilot workflow reaches the default branch. Follow the maintainer procedure in the visual merge rule for fork heads.

```sh
gh workflow run ios-forecast-header-pilot.yml --ref <branch> -f ref=<full SHA>
gh workflow run ios-release.yml --ref <branch> -f ref=<full SHA>
```

PRs that change the workflow or pilot tools run both workflows on GitHub's test merge commit. This pair qualifies the harness. A normal experiment uses two manual runs on the same PR head. Follow the current merge rule for any additional evidence needed on that head.

Record the run links and compare the selected `inventory.json` with the full `ios-full-tests.json`. Use `inventory.py expected.json <full-report.json>` on successful runs to verify that the full run also passed the expected cases. Inspect failed test records to identify failures. Keep the runner image from each job log and Xcode and simulator versions from the summaries. Record the workflow creation time, job starts and completion times. Compute queue time and execution time separately for each job. Sum macOS job durations for cost. Record the time to the full gate for the actual pilot and the time to both the PR checks and the selected pass for the proposed gate.

For a local run use an isolated checkout containing `ios/` and an iPhone 17 simulator. Run from `ios/` with an absolute output directory that does not contain an earlier selected result bundle.

```sh
bash tools/forecast-header-pilot/run.sh 'platform=iOS Simulator,id=<UDID>' /tmp/forecast-header
```

Run the missing, duplicate and skipped case tests with `python3 tools/forecast-header-pilot/test_inventory.py`. The workflow artifacts retain the executed test report, selected case inventory and Xcode log. The selected result bundle contains test attachments. Compare at least three eligible PR heads, plus the failure trials in the plan, before making an adoption decision.
