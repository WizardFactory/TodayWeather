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

### Initial new-branch CI audit

The [initial push artifact audit](https://github.com/WizardFactory/TodayWeather/actions/runs/36823088741) on29a0a786failed because a newly created branch supplies an all-zero previous SHA. The conservative checker then includes existing side-branch history after its policy boundary. Its reported legacy snapshots already belong to upstream/master4ba9c3bb; generated reports present in those historical commits are not part of this release diff. The actual staged snapshot and complete outgoing series from4ba9c3bbpassed locally, and the PR artifact job passed on the scoped base/head range.

No artifact checker/workflow exemption or historical Git rewrite was applied. Keep this historical audit finding distinct from the release snapshot result; future initial branch pushes from the same history can still encounter it. This follow-up records the observed CI boundary and preserves the existing checks. Final-head CI must be checked again after this documentation commit.

Reported historical snapshot commits: `27f42364cf72`, `481aa49dbd96`, `daf504b32758`, `ddde368cd67c`.

## Grok review round1 follow-up

[Grok round1](https://github.com/WizardFactory/TodayWeather/pull/2662#issuecomment-5931018758)
reported one required fix and four recommendations on e67090d6. Root reproduced
four failing regressions before changes: failed withdrawal left a stored grant,
restart could override native opt-out, consent callbacks overlapped, and failed
enabling left native consent granted. The installed FirebaseX 2.0.2 code confirms
collection setters persist the same preference read by the collection query;
Android returns 1/0 and iOS boolean. Native consent/collection jobs run in background.

Accepted fixes: invalidate stale stored grants; corroborate restoration with native
preference; serialize/coalesce consent operations and failure compensation; restrict
legacy opt-out to withdrawal; report absent/failed ad privacy bridges. Added stateful
native/restart and actual settings controller grant/refusal/dismissal regressions.
Android defaults continue to use pinned plugin variables; duplicate manifest tags
were not added solely for a string assertion. Compiled/device evidence remains a
release gate. Privacy failure copy asks to retry without asserting native success.

Verification: 56/56 Node tests across four client suites, 8 Ruby tests/43 assertions,
JSON locale parsing and diff checks passed. Diagram generation passed 9/9 showcase
checks (0 errors/warnings). Automated browser rendering now runs but visual-check
fails the existing vertical-overflow requirement at three smaller desktop sizes;
2048x1320 fits in both themes. No geometry repair or strict visual pass is claimed.
Source specification SHA256: `0097acd86cf57dc222c4efaf82a2bd39bbcf0ee7502b7c16d41d5a77575f4296`.
Generated artifact SHA256: `83ddcd994d7cd0ce90477337cdd7c3d4687647069b7a9ee618970dcfcd888b70`.

If both WebView persistence and native withdrawal fail, durable opt-out remains
unverified and the UI reports failure. This code review does not certify native
network behavior, final signed builds, historical data deletion or store forms.
