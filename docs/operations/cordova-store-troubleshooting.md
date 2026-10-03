# Cordova store release troubleshooting

Use this guide when a release step fails. Start normal deployments with the [release runbook](cordova-store-release.md#release-order-for-the-next-version). Cases below derive from the TodayWeather 1.1.0 recovery on 2026-10-01–02; verify the current account, artifact and service behavior before applying a remedy. Current automation coverage is documented in the [runbook](cordova-store-release.md#automation-coverage-and-remaining-work).

## Before retrying

On an API error, preserve a sanitized cause and the edit/build identifier, abort an uncommitted Play edit, and read current store state before retrying. An unknown outcome is not proof of failure: check whether the artifact, track change or group association already exists. Reuse the accepted artifact when appropriate instead of consuming or re-uploading its version number blindly.

Keep exported listing/assets and previous website object versions for scoped restoration. A new binary fix needs a new store version code/build number. Do not use a production rollout to test a fix. Play's completed-release halt can fall back to an older release, so it is not a safe way to remove all affected legacy APKs; inspect the fallback before acting. Credential revocation, signing-key transfer and production release are separate operations from upload recovery. See [Google's release-halt behavior](https://support.google.com/googleplay/android-developer/answer/16285429).

## Find the symptom

| Symptom | Start here |
| --- | --- |
| API disabled, permission denied, export cannot access the app | [API access](#api-access) |
| Missing signing/Firebase files or AdMob app IDs | [Release inputs](#release-inputs) |
| Play refuses an AAB because App Signing is not enabled | [AAB rejected](#aab-rejected) |
| Manual-review restriction or missing declaration blocks a commit | [Review and declaration blockers](#review-and-declaration-blockers) |
| Background-location declaration persists after removal from new build | [Legacy artifacts](#legacy-artifacts) |
| Xcode archive/export has no usable distribution certificate/profile | [iOS signing](#ios-signing) |
| P12 import fails despite the expected password | [P12 import](#p12-import) |
| Uploaded build is unavailable to TestFlight testers, or group write returns 422 | [TestFlight availability](#testflight-availability) |
| Privacy page, store URL and repository content differ | [Policy document drift](#policy-document-drift) |
| Upload/track says completed but open beta is not available | [Publication state](#publication-state) |
| Fastlane fails before any API request with a Ruby dependency error | [Ruby environment](#ruby-environment) |

## API access

**Symptom:** Play export/upload fails because the API is disabled or the identity cannot access TodayWeather.

**Check:** Identify the failed API and the configured service-account identity without logging the JSON contents. Check API enablement in its project and app-specific Play permissions separately. Authentication success alone does not prove app access.

**Resolve:** Use the existing approved identity. Have an authorized operator enable the missing API or grant only the required app/testing permissions. Production actions require separate release permission; do not add it merely to make an export work. On Apple, distinguish API access from certificate/provisioning authority.

**Verify:** Run the [metadata exports](cordova-store-release.md#inspect-current-store-state-first) and confirm actual exported files. A permission change without a successful readback is not recovery evidence.

## Release inputs

**Symptom:** The build reports missing private files or AdMob app IDs; only ad-unit IDs are available.

**Check:** Read environment variable names and file existence, not secret values. `client/.env` controls the build; `client/fastlane/.env` controls store authentication. An AdMob app ID uses the app-level identifier, not the banner unit's identifier.

**Resolve:** Restore the existing private backup with its manifest. `npm run release:fetch` restores the five configured build inputs and preserves existing files by default; it does not restore store keys or iOS signing material. Resolve local paths and verify the app association of the configuration. Do not use test IDs to make a release build pass.

**Verify:** Release configuration checks pass, real IDs are present in the final artifact, and the signing certificate matches the expected existing app. Record hashes; keep keys/passwords outside Git.

## AAB rejected

**Symptom:** Play refuses the AAB because the app is not enrolled in Play App Signing.

**Check:** Read actual enrollment and legacy-app eligibility before selecting a package format. A valid AAB signature is not evidence of enrollment.

**Resolve:** For the verified legacy TodayWeather route, build an APK using the same release configuration and existing signing key, following the [APK instructions](cordova-store-release.md#build-commands-and-upload-boundaries). Enrollment/key transfer is a separate operator decision. The maintained `store:upload:android` lane accepts AAB only and targets internal/draft; passing an APK through `aab:` does not implement the fallback.

**Verify:** Inspect the APK package/version/SDK and signing certificate, then verify the accepted version in a saved release. An upload accepted inside an edit that was later aborted did not persist.

## Review and declaration blockers

**Symptom:** Validation requires manual review, or a commit names a missing Data safety, financial, health or advertising declaration.

**Check:** Distinguish the validate endpoint from edit commit and read the specific Console prerequisite. Preserve the error class/reason privately. Check actual SDK behavior and the corresponding form rather than inferring every answer from the absence of login.

**Resolve:** Complete accurate required forms with the operator where needed. Use `changes_not_sent_for_review: true` for the verified manual-review commit path and disable automatic fallback (`rescue_changes_not_sent_for_review: false`). The validate endpoint cannot accept the commit flag. Neither flag removes declaration requirements. Abort a failed temporary edit.

**Verify:** A fresh read shows the intended release/metadata, and Publishing overview shows the correct pending rows. Submit those rows explicitly and distinguish pre-review checks, review in progress and approval. Do not repeatedly upload a binary while the named prerequisite remains unresolved.

## Legacy artifacts

**Symptom:** A new binary has no background-location permission, but Play still asks about background access by Android 9 or older APKs.

**Check:** Open the affected-artifact list and inspect version codes across production, open and closed testing. Review retained artifacts in each replacement. The form can refer to old APK behavior; the new manifest cannot answer that question.

**Resolve:** Establish the old behavior from source/artifact evidence or the operator. If retiring old versions is approved, prepare compliant replacement configurations for all affected tracks and put old APKs under “Not included.” Account for lost device support. Do not submit an unsupported compliance claim, and do not substitute an unrelated track mutation for authorized scope.

**Verify:** Read back each intended version-code list and refresh the declaration page. In the 1.1.0 recovery, excluding 9612/9972/100089 from the three replacement configurations resulted in “no permissions to declare.” That result did not itself publish the replacements or establish review approval.

## iOS signing

**Symptom:** Automatic export cannot use cloud signing, or no usable Apple Distribution certificate/App Store profile is available.

**Check:** Inspect the selected Xcode installation, signing identities and private-key presence, certificate/profile validity, bundle/team match and entitlements. An App Store Connect API key is not the native signing private key; successful metadata access does not grant certificate issuance authority.

**Resolve:** Restore valid existing signing material first. If missing or expired, an authorized account holder/admin handles issuance. Import the matching private key/certificate and install the App Store profile, then archive/export with explicit matching signing settings. Do not raise API-key roles or revoke old certificates as a routine workaround.

**Verify:** Strict code-signature validation, embedded profile, bundle/version and production push entitlement match the intended release. Only then upload the exported IPA. Preserve the certificate/private-key or encrypted P12, password and profile in the private recovery set.

## P12 import

**Symptom:** macOS rejects a P12 import with a MAC/password-style error even though the expected backup/password was selected.

**Check:** Verify the selected file and password source, certificate/private-key match and format compatibility. Do not assume every such error means corruption or overwrite the original backup.

**Resolve:** The observed recovery used a temporary compatibility-format P12 for import while retaining the encrypted original backup. Keep the transport file private, never log the password, and remove the temporary copy after successful import. Do not weaken the stored backup or broadly change keychain access controls.

**Verify:** The imported distribution identity includes its private key and can sign/export the expected app. A successful certificate-only import is insufficient.

## TestFlight availability

**Symptom:** Upload succeeded but testers cannot see the build; processing/compliance remains unresolved, or linking a group returns 422.

**Check:** Query the exact app/version/build and processing state, compliance state, existing internal-group build membership and automatic-distribution settings. Read back after an ambiguous write; a 422 alone does not prove either successful association or propagation delay.

**Resolve:** Wait for processing to finish, resolve the actual build's compliance requirement with the operator, and attach/enable the build for the intended existing group only if necessary. The 1.1.0 recovery's immediate group write failed; subsequent readback showed the build already in the group and testing, so no duplicate write was needed. Escalate a persistent error with its actual detail instead of repeating the mutation. External beta review remains a separate workflow.

**Verify:** Processing is `VALID`, the build is internally available (`IN_BETA_TESTING` in the observed API), group membership is present, and an eligible tester can install the intended build. Refresh tester counts rather than reusing an earlier response. The maintained upload lane skips processing waits and does not perform all these checks.

## Policy document drift

**Symptom:** The store points to an old company URL, translations use different periods, or public content differs from the repository.

**Check:** Compare the saved store URL, actual public HTTPS document and versioned source in each supported language. Identify whether the change is saved, submitted or published. A source edit does not update S3; an S3 upload does not submit a store change. Review draft notices and unresolved fields separately.

**Resolve:** Apply the operator-confirmed change to the affected translations and worksheet. Back up existing object bodies/version IDs, upload only reviewed `mobile/` paths, invalidate the same paths and commit the source update. Then save the intended store URL and inspect the review list. Do not change unrelated provider periods, remove draft labels or bypass TLS checks to satisfy a URL field.

**Verify:** Public HTTP 200 and body hashes match source, the landing root is unchanged, and the exact URL appears in the expected store-review state. The confirmed 90-day request/error-log wording does not demonstrate every provider's deletion behavior or finalize the draft.

## Publication state

**Symptom:** API `completed`, an upload success message, or a “ready” section is mistaken for a public beta release.

**Check:** Inspect Publishing overview's exact rows, approval state and managed-publishing setting, plus the test track's countries/eligibility and tester opt-in page. For a removed app, read the dated policy notice; a persistent removal banner alone does not identify a new rejection.

**Resolve:** Complete the named review prerequisite and wait for approval. With managed publishing enabled, inspect the scope of the final publish action. Publish only the authorized test scope when supported; if production changes are bundled, keep them held and resolve that scope before proceeding. Do not publish production solely to make beta installation work.

**Verify:** An eligible tester can opt in and install the intended Play version. Track configuration, Google approval and actual tester availability must be recorded separately. Production remains subject to beta acceptance.

## Ruby environment

**Symptom:** Fastlane fails before an API request because Homebrew Bundler loads libraries through macOS system Ruby 2.6, for example a `rubygems/uri` load error.

**Check:** Compare `ruby -v`, `bundle exec ruby -v` and executable paths. The repository requires Ruby 3.2 or later. Confirm the client Gemfile and installed bundle are selected.

**Resolve:** Use a consistent supported Ruby PATH, or explicitly invoke the same Ruby executable through Bundler. Do not change store credentials or repeat uploads for an interpreter startup failure.

**Verify:** The [existing store lane contract tests](../../client/test/store-release.test.rb) pass and `bundle exec fastlane lanes` loads. These are local checks, not proof of store authentication or deployment.

## Adding the next incident

Record the release SHA/version, environment/date, redacted symptom and failed stage, evidence supporting the cause, bounded correction, verification result and remaining risk. Add a symptom-index link and an issue/PR reference. Distinguish an observed fix from an untested hypothesis; leave an unresolved case explicitly unresolved. Keep credentials, private reviewer data, precise locations and raw logs in restricted evidence, not this guide or public issue comments.

## Dated evidence and limitations

The build source was merge commit `dc2cc9fc6068772d983645a3721e4ec261e79e2e`; Android was 1.1.0/100090 (minimum API 24, target 36), iOS was 1.1.0/build 1. At the last 2026-10-02 Console observation, the three Android releases and privacy URL/Data safety/health changes were under review, managed publishing was enabled, and no open-beta or production publication was verified. Internal TestFlight was available. Physical-device acceptance, policy finalization and final listing reconciliation remained unfinished. These are dated observations, not live status or a blanket compliance conclusion.

Evidence: [replacement and review request](https://github.com/WizardFactory/TodayWeather/issues/2605#issuecomment-5942179691), [latest observed review list](https://github.com/WizardFactory/TodayWeather/issues/2605#issuecomment-5946376982), [policy wording verification](https://github.com/WizardFactory/TodayWeather/issues/2660#issuecomment-5944363100). Platform guidance: [Android signing and legacy eligibility](https://developer.android.com/studio/publish/app-signing), [Google review and managed publishing](https://support.google.com/googleplay/android-developer/answer/9859654), [internal TestFlight groups](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).
