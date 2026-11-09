# AdMob eligibility remediation plan

Inputs: [intent](../intent/issue-2871.md), [spec](../specs/issue-2871.md). Execution notebook: the
named `issue-2871` plan; its owner is the root Claude Code session. Local records stay in ignored `reports/`.

## Work

1. Reproduce the journeys on an Android emulator with the installed 1.1.0
   development build: start denial, offline retry and city selection. Trace the
   causes in the plugin sources.
2. Write the failing tests first:
   - `client/test/location-permission.test.cjs`: three controllers × diagnostic 7.4.0 statuses.
   - In `monetization.test.cjs`: the load-error code, and the first-launch SDK start.
3. Implement the spec's changes in `service.util.js`, the three controllers,
   `service.admobemi.js` and `service.monetization.js`. Add `scripts/make-app-ads.mjs`
   with its test and the npm script.
4. Generate app-ads.txt from the private release env, upload the single landing
   object, invalidate its path, and verify the bytes over HTTPS and HTTP.
5. Rebuild the debug APK and rerun the journeys on a fresh install. Retain sanitized
   screenshots and update the five documents.
6. Run the client suite and the artifact checks. Commit, open the PR, get a review
   from another provider, correct, and record readiness. Do not merge.

## User scenarios

- S1 (AC3): a new user taps "Use your current location" and denies the prompt.
  Expected: a denied dialog with Close/OK; OK asks again. Failure: an endless spinner.
- S2 (AC3): a new user picks Seoul on a fresh install. Expected: weather, then a test
  banner in the first session. Failure: no Ads SDK start until a relaunch.
- S3 (AC3): an offline user uses "Find by location", reconnects and taps OK.
  Expected: a failure dialog, then recovery.
- S4 (AC2): a banner load fails. Expected: a code-only console line, and
  `ad_load_error` only with Analytics consent. Failure: a message or ad unit ID is
  emitted, or a malformed code is accepted.
- S5 (AC1, AC5): the release operator generates, uploads and verifies app-ads.txt,
  then AK updates both listings and checks AdMob. Expected: HTTPS 200 with identical
  bytes, and AdMob authorization recorded in #2871. Failure: sample or mixed IDs are
  rejected; a listing mismatch keeps the status open.
- S6 (AC4): a privacy reviewer reads the worksheet. Expected: Android `AD_ID` is
  declared for ads and iOS uses forced `npa=1` without ATT, consistent with #2660.

The scenario JSON is in `reports/sdlc/issue-2871/`. Tests: S1, S3 →
`location-permission.test.cjs`; S2, S4 → `monetization.test.cjs`; S5 →
`app-ads.test.cjs` plus the curl/cmp checks; S6 → document review. The emulator runs
S1–S3. iOS is blocked locally (`simctl` does not respond).

## Risk and rejected alternatives

The riskiest change is the location flow: three copies of the same logic. The
regression tests drive each copy with the real 7.4.0 constants, on both platforms.

Rejected alternatives:

- Moving the banner or delaying the load: there is no reproduced defect, and the
  policy effect is unknown.
- Setting `ADD_AD_ID=true`: no effect on the build.
- Serving the file from legacy EC2: server2 retires that host.
