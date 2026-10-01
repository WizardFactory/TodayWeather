# Cordova privacy/consent verification — 2026-10-01

Scope: dirty release checkout based on6ec6c68c, with preserved measurement changes and new#2660 privacy choices. This is not a tested final integrated release commit or a public app rollout.

| Check | Actual result |
| --- | --- |
| Consent regression |36/36Node tests across privacy, measurement, payment-removal and provider-notice suites; Red cases reproduced before implementation |
| Android native build | Debug APK compiled successfully; merged manifest has6false Analytics defaults. AD_ID permission remains present and must be included in SDK/disclosure review |
| Android functional UI | Dedicated Android36AVD: initial off, optional grant, grant persisted after restart, withdrawal to off. Withdrawal also persisted after a final restart; no real ads/customer locations used |
| iOS native build | Clean simulator build on Xcode26.5 succeeded;7collection/consent/IDFV/ad-network flags false in compiled plist, no ATT description, no GTM/IdentitySupport frameworks in compiled app |
| iOS request configuration | Guarded after_prepare patch compiles SDK requests withnpa1 and publisher first-party-ID disabled; unsupported plugin anchors or GTM container fail the hook |
| Policy drafts |9KO/EN/JA privacy/terms/support HTML files: relative links, no active content, approved identity/contact and visible draft status checked |
| Policy rendering | All9pages at390×844: no horizontal overflow; Japanese/Korean screenshots inspected |
| Public hosting | User explicitly approved exact9drafts including business identity/contact. Public HTTPS200 HTML bodies match source SHA256; original landing root unchanged;9paths invalidated, existing S3versions retained |
| Store state | No Data safety/Apple privacy declaration, binary upload or review submission. Play screenshot commit remains blocked by missing Data safety; Apple1.1 screenshot draft preserved |

Native installer variables were insufficient for iOS defaults: artifact inspection caught missing plist keys, then explicit config.xml values and a clean rebuild verified the correction. Selecting Core Analytics alone was also insufficient while unused GTM transitively included IdentitySupport; generated-package dependency removal and compiled-framework checks verify this boundary. Neither library absence nor lack of ATT is a whole-app tracking certification. Physical upgrade and network/SDK receipts remain necessary.

Retained [retention/deletion proposal](../../../operations/store-data-retention.md) distinguishes proposed periods from deployed settings. Prospective artifact policy/diff checks passed with117scoped/existing dependency files, without changing actual staging. No customer-record purge, log retention or GA4/BigQuery configuration was applied. Exact processor/country/legal-basis and authenticated deletion details remain unresolved.

## Pre-integration architecture artifact

- diagram_type: sequence
- output: [Cordova advertising/consent flow](../../../architecture/diagrams/cordova-advertising.html)
- validation:9/9showcase checks,0errors,0warnings on final delivered source
- browser_evidence: failed; automated Chrome exitedSIGABRT in this environment. This is not a skipped or passed command.
- Manual CUA inspection: light/dark screenshots reviewed at2048×1320; diagram text/arrows/cards readable. Measurements at1440×900,1600×1000 and1920×1080 require vertical scrolling;2048×1320 fits. No horizontal overflow measured.
- visual_review: failed for the strict first-screen desktop containment requirement; readable artifact retained with this limitation.
- correction_rounds:2; compression attempts failed minimum28px spacing/artifact checks. Restored the last valid complete semantic source and redelivered; no stale failed candidate is represented as validated.

- specification_sha256: `9694c4888b02ec305d280e2927817a8b7d16a61e6af3686f55c7f1647b27dbad`
- artifact_sha256: `7e8c51ad6eaf779318cbe88cf8300e87e6187b7f452e1e5acc4fad92efababa5`

## Latest-master integration (2026-10-01)

The release worktree is based on upstream4ba9c3bb and preserves the already merged#2659HTTP outcome, finalized RemoteConfig, serialized rotation and native5second reload fixes. The original dirty checkout stays intact. Scoped three-way reconciliation used23837d96as the measurement baseline for shared files and6ec6c68cfor release-only files; no existing measurement feature files were wholesale reverted.

Red regression reproduced loss of the latest screen after explicit consent while the native enable call was pending. The merged gate now drops all pre-consent screens and retains only the latest fixed route after explicit consent; withdrawal clears it and stale acknowledgements cannot reopen collection.48/48client tests and8Ruby tests/43assertions passed in the integration worktree. All existing newer advertising/config/HTTP regressions remain in the suite.

This phase does not revalidate a final signed native binary or publish app/store changes. Earlier native build/device observations above belong to the pre-integration candidate. Final physical upgrade/network/retention/deletion and store disclosure gates remain open.

The merged diagram JSON/HTML was regenerated with9/9artifact checks,0errors and0warnings. Supplementary CUA browser measurements on the exact integrated HTML retain the documented vertical-scroll limitation at three smaller desktop sizes;2048×1320fits. Both themes were visually inspected and remain readable. This is not an automated-browser pass or strict first-screen containment pass.

Integrated diagram specification SHA256: `7ad40e88687adcd4926126e2e565ddb9aae36334cdc449daea69154e72d31df4`

Integrated diagram artifact SHA256: `8934cc04d0bb915d65a2cefeda93e4d2e42d4eab1c206f2731e0f56ddbf48b5b`
