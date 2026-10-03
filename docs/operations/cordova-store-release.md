# Cordova store release — TodayWeather 1.1.0 (#2605)

TodayWeather uses the existing Cordova npm build scripts. This release excludes widgets and purchases, keeps AdMob, and requires physical-device notification/advertising checks. TodayAir is outside scope. Do not use the old product Gulp release tasks to prepare this version.

## Release order for the next version

Follow this order from a clean checkout of the reviewed release commit. Keep the original working tree and previous release artifacts intact. A document update, successful upload, saved track configuration, review approval and tester availability are different completion states.

1. **Freeze scope and versions.** Record the Git SHA, package/bundle ID, Android version code, iOS marketing version/build number, target/minimum OS, target tracks and intended testers. Read existing store versions before choosing unused version numbers. Rebuild after a source change; do not relabel an older binary. Check upgrade behavior and the OS support lost when excluding legacy APKs.
2. **Restore credentials and validate access.** Restore the established private release backup using its manifest and restore instructions. Keep the Android keystore/signing configuration, Google JSON, Apple API key, iOS certificate/private key or encrypted P12, P12 password and provisioning profile outside Git. Use separate build and store environment files. Run authenticated metadata exports before building. The current Google identity can manage the app/test tracks but has no production-release role; prepare an explicitly authorized production change through an already authorized operator, rather than silently widening the service account.
3. **Check packaging and signing before upload.** Inspect Play App Signing enrollment. This legacy app used a self-signed APK because enrollment was absent; an AAB build alone does not establish upload eligibility. On iOS, confirm a valid distribution identity with its private key and an App Store profile matching the bundle ID, team and production push entitlement. Renew only missing/expired assets; ordinary releases should reuse valid signing material.
4. **Complete content and declaration prerequisites.** Export current descriptions, screenshots and declarations. Reconcile widget/purchase removal, provider notices and the actual SDK behavior with the binary. Check Play Data safety, health, ads/advertising ID, app access, government/financial and applicable permission forms. Check Apple privacy, age rating, app access and required account actions separately. A missing account system does not make weather coordinates or SDK data uncollected. Use the privacy worksheet; do not copy every previous answer without checking the new version. Publish approved policy changes first, verify HTTPS and all required languages, then save and verify the store URLs. A saved URL or draft label is not evidence of a finalized policy.
5. **Build and verify artifacts.** Install client dependencies from the lockfile and use the release scripts below. Record build-tool versions and command-local Android SDK/JDK and `DEVELOPER_DIR` settings. Verify Android signing certificate continuity, package/version/minimum/target SDK and permissions. Verify iOS code signature, embedded profile, bundle/version, entitlements and compiled privacy defaults. Confirm real AdMob app IDs/units and Firebase configuration, absence of removed SDK/features, and that bundled application code corresponds to the release SHA. Record artifact SHA-256 and preserve the signed binaries.
6. **Stage Android testing.** Upload an eligible APK/AAB once, select the intended testing track, and inspect the exact version-code list before committing. The open-testing API track is `beta`; `alpha` is the existing closed-test track. Do not copy production into a test release or change unrelated tracks as a routine operation. When replacing a removed/noncompliant legacy release, inspect *all* active tracks and, within the separately authorized replacement scope, exclude affected old artifacts. Commit with manual-review handling and read the resulting configuration through a fresh edit. Abort a failed temporary edit; do not claim its accepted upload persisted.
7. **Request Google review, then control publication.** In Publishing overview, inspect the exact pending rows, including metadata changes saved after the binary. Keep managed publishing enabled when production must wait for beta acceptance. Confirm pre-review checks complete and the intended changes are under review. After approval, inspect which changes the publish action will publish; release only the authorized test scope when the Console permits it. If production is bundled in the same action, keep it held and resolve the scope first. Verify the open-test countries/eligibility, tester opt-in page and an actual Play installation of the intended version. API `completed` describes rollout configuration and does not prove review approval or public availability.
8. **Upload and activate internal TestFlight.** Export a correctly signed IPA and use the API-key upload lane. Poll the specific build until processing is `VALID`. Resolve any export-compliance question using the current binary and operator-confirmed classification; do not copy a past answer mechanically. Read the existing internal group settings and attach/enable the build only as necessary. Verify both the build's internal testing state and group membership before retrying a write. Keep external beta review and App Store production submission separate from internal testing.
9. **Accept the beta on physical devices.** Check upgrade/storage preservation, current-location and city weather, notification registration/delivery/tap, real ads and consent/withdrawal, and startup/crash behavior. Read back the tester-installed version. Record failures against the exact artifact. Production publication requires this acceptance; TestFlight availability and Play review approval alone are insufficient.
10. **Close the release record.** Post a sanitized result to #2605, link any documentation follow-up to #2660, and commit maintained source/runbook changes. Retain private manifests, hashes, previous metadata and exact artifact versions. Back up newly issued/changed credentials privately and verify recovery, rather than creating fresh keys each release. Keep generated exports and receipts under ignored reports per the [artifact policy](../development/artifact-retention.md).

### Automation coverage and remaining work

| Operation | Maintained implementation | What still needs explicit handling |
| --- | --- | --- |
| Build-input recovery | `npm run release:fetch` | Downloads five configured build files, preserving existing files unless forced; it does not restore Apple API/signing keys or store-auth files |
| Store metadata export | `store:export:android`, `store:export:ios` | Policy enforcement and some declaration/review details require Console inspection |
| Android build | `build:android:release` | Produces an AAB; use the legacy APK branch below until enrollment changes |
| Android upload | `store:upload:android` | Accepts **AAB only**, fixed `internal`/`draft`; it is not an APK/open-beta/promotion lane |
| iOS preparation/upload | `build:ios:release`, `store:upload:ios` | Xcode archive/export, processing, compliance and internal-group verification remain separate |
| APK/open-beta and all-track recovery | Verified during the 1.1.0 recovery through scoped API operations and Console | No maintained lane yet; use the documented transaction/review checks, not a missing script from another machine's ignored reports |
| Final review/publication | Operator-controlled Console steps | No maintained production/App Store submission lane; account-holder actions and policy forms are not universally covered by public APIs |

To reduce future browser work, the next automation increment should add tested APK/internal-or-beta upload, read-only track/build status, existing-group TestFlight activation/readback, and a private release manifest. Keep production promotion separate. Require fixed app identity, explicit track allowlists, artifact hashes, abort-on-error, fresh readback and safe retry handling. Do not label the current workflow fully automated before these commands exist in the repository.

### Troubleshooting

For upload, signing, permission, review or tester-access failures, use the [symptom-based troubleshooting guide](cordova-store-troubleshooting.md). It records checks, bounded recovery actions and completion criteria, with dated 1.1.0 evidence. Follow its [retry boundaries](cordova-store-troubleshooting.md#before-retrying) before repeating a failed operation.

## API authentication and local setup

Use Ruby 3.2 or later; macOS system Ruby 2.6 is insufficient for the installed Fastlane dependency set. From `client/`, run `bundle install` and copy `fastlane/.env.example` to `fastlane/.env`. The example contains file paths and identifiers only. Keep Google credentials and Apple `.p8` files outside Git. `client/.env` is the existing **build** configuration; `client/fastlane/.env` is separate **store** authentication.

- `TW_PLAY_JSON_KEY`: service-account JSON authorized for the existing `net.wizardfactory.todayweather` Play application.
- `TW_ASC_KEY_ID`, `TW_ASC_ISSUER_ID`, `TW_ASC_KEY_FILE`: App Store Connect API key identifiers and local private-key path.
- iOS signing remains in Xcode per the existing maintainer decision. The lane accepts an exported, signed IPA; it does not generate certificates or modify provisioning.

Verify `ruby -v` and `bundle exec ruby -v` resolve the same supported Ruby. In the macOS release session, invoking Homebrew `bundle` followed by an unqualified system `ruby` failed before any API request; use a consistent PATH or an explicit Ruby executable. Set `DEVELOPER_DIR` to the installed full Xcode for archive/export without changing global selection.

All lanes require API credentials and fail before an upload when required files are missing. They do not fall back to Apple ID login. Operation logs contain action/result and an error class, never credential values. Fastlane itself can produce additional diagnostics; keep verbose auth/debug logs private.

Apple team keys apply to every app in the team; their app access cannot be restricted to TodayWeather. An App Manager key also carries submission/release capabilities, even when these lanes only export metadata or upload a beta. App isolation requires an individual key belonging to a user whose app access is restricted; the current lanes require a team issuer ID and would need a tested authentication change for that alternative. See [Apple API key scope](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/). Read download UI state with output suppressed and emit only allowlisted, non-secret fields. Exported review information can contain private reviewer credentials/contact details: run exports with `umask 077`, retain them under ignored reports, and never copy them into docs or logs.

## Inspect current store state first

```sh
cd client
npm run store:lanes
npm run store:export:android
npm run store:export:ios
bundle exec fastlane android validate_listing
```

Each export uses a new UTC timestamp directory under ignored `reports/store-export/android` and `reports/store-export/ios` under the repository root. They are review inputs, not approved metadata. Play's publishing API uses transient edits for listing reads; supply init does not publish a release. No previous export is overwritten. These commands do not determine a policy-enforcement reason: preserve the actual Play suspension/removal notice separately. Account verification, legal consents, reinstatement and some declarations can still require the store's console.

## Build commands and upload boundaries

```sh
cd client
npm run build:android:release
# Only after confirming Play App Signing enrollment:
npm run store:upload:android -- aab:/absolute/path/to/app-release.aab
npm run build:ios:release
# Archive/sign/export an IPA with Xcode, then:
npm run store:upload:ios -- ipa:/absolute/path/to/TodayWeather.ipa
```

For the verified legacy APK route, first run `npm run build:android:release` to enforce release configuration and signing-input checks. Then, from the same prepared `client/` checkout, build the APK with the same private build configuration (resolve its absolute path from `TW_ANDROID_BUILD_JSON` and `TW_RELEASE_LOCAL_DIR`):

```sh
npx cordova build android --release --buildConfig=/absolute/path/to/private-build.json -- --packageType=apk
```

Record and verify the emitted APK with `apksigner verify --print-certs` and the Android manifest inspector before upload. Do not pass this APK as the `aab:` argument: the maintained lane accepts only an AAB. In Console, create a release on the intended test track, upload the verified APK (or reuse the already uploaded version from the library), inspect retained artifacts, enter release notes, save, review validation, then save to Publishing overview. The equivalent API flow is begin edit → upload/reuse APK → replace the explicitly selected track's release/version-code list → commit with manual-review handling → fresh readback. A production change needs an identity that already has that permission.

The maintained Android upload lane always uploads to the `internal` track with `release_status: draft`. It preserves existing listing text, images, screenshots and changelogs; the draft must subsequently be reviewed and activated before testers receive it. An extra `track:production` argument does not change the lane's destination.

iOS uploads the binary to TestFlight and returns without waiting for processing. It does not submit external beta review or distribute externally. This lane does not prevent App Store Connect's existing internal-group settings from making a processed build available to internal testers. Check processing/upload validation afterward.

The text validation lane reads the existing production release because Supply requires a release even for metadata-only validation. It requests no binary upload, rollout, promotion, screenshots/changelog upload or commit. During the initial 1.1.0 recovery, Google rejected this validate step with a manual-review requirement (`changesNotSentForReview`); that attempt was not successful validation. The temporary test edit was discarded after the investigation. Internal drafts set `changes_not_sent_for_review: true` explicitly.

No APK/open-beta, production promotion, committed metadata-upload or App Store submission lane is configured. Add these after inspecting the current listing, fixing the Play enforcement cause and reviewing provider/privacy conditions. A successful upload does not establish review approval or production availability.

## Versioned listing drafts

`client/fastlane/metadata/android/` contains proposed six-language Play descriptions/titles/short descriptions/notes; `client/fastlane/metadata/ios/` contains names/subtitles/keywords/descriptions/notes for all five current Apple locales (`en-US`, `ja`, `ko`, `zh-Hans`, `zh-Hant`). These are local 1.1.0 drafts (Android versionCode 100090), compared against API exports but not approved or uploaded. They include widget removal, KMA/AirKorea/KASI credits, Visual Crossing credit and provisional-data/official-warning cautions. The iOS Korean keywords remove widget and unrelated Naver terms; both Chinese app names remove widget promotion, and subtitles avoid unverified notification promises. iOS copy refers to iOS widget removal only. Four old Play titles exceed the current 30-character limit; draft fields satisfy the applicable limits.

The old Korean fifth Play phone screenshot and fourth Apple screenshots promote widgets. Their replacement package was captured on 2026-10-01 from the current Cordova app with the public Seoul shortcut, without GPS permission. The [asset manifest](../../client/fastlane/screenshots/manifest.json) lists every maintained file, dimensions, hashes and capture limitations. Four views cover comparison, expanded hourly weather, daily forecasts and air quality.

| Store | Replacement assets | Verified store state |
| --- | --- | --- |
| Play | Four 1080×1920 RGB JPEG phone images each for en-US, ja-JP and ko-KR | All12 uploaded and SHA256 verified within a temporary edit. Commit rejected: `This app has no data safety declaration.` Edit aborted; original4/4/5 image hashes verified unchanged. Not reflected in the store. |
| Apple | Four 1320×2868 iPhone6.9 PNGs and four 2064×2752 iPad13 PNGs, primary ko | New1.1.0 `PREPARE_FOR_SUBMISSION`, manual-release draft contains exactly these two sets; all8 processing states `COMPLETE` and source MD5 verified. Live1.0.10 retained. No review submission. |

Play's de-DE/zh-CN/zh-TW and Apple's en-US/ja/zh-Hans/zh-Hant had no independent screenshots in the inspected exports; primary-language fallback remains. Old Apple5.5/6.5/12.9 overrides were removed only from the newly cloned draft after confirming no live screenshot-ID overlap. Icons and feature graphics were preserved. Listing text remains a separate unuploaded draft and still needs reconciliation before review.

Android promotional images use the [HTML frame](../../client/fastlane/screenshot-frame.html) around actual native app pixels. The source viewport excludes only system/test-ad regions; no weather values or app text were retouched. iOS uses full native frames, with fully opaque alpha removed and RGB bytes unchanged. Google test ad units were used throughout; these captures do not establish production consent or revenue behavior. Source weather changes naturally between captures. The source checkout includes pending release/measurement changes and is not a final integrated binary; recapture if the final visible UI differs.

### Screenshot-only API updates

Use the established store API credentials, never an owner browser login, for image uploads. Export current assets first and retain raw frames, old assets and private receipts under ignored reports. Validate the manifest hashes, dimensions, locale coverage and visual content before any write. Binary upload lanes above deliberately skip images; screenshot replacement is a separate operation.

For Play, use Fastlane Supply's existing API client: begin an edit for the fixed package, read/backup `phoneScreenshots`, clear only the three explicit locale sets, upload ordered files, then compare returned SHA256 hashes. Commit with `changes_not_sent_for_review:true` and automatic review fallback disabled. Abort on failure; after success, read through a fresh edit and compare again, then abort that read edit. Do not modify text, icons, graphics or tracks. The initial rejection required Data safety completion; that declaration was later submitted with the binary changes. A fresh screenshot readback/commit is still required before claiming the images were replaced. Toggling the review flag does not bypass a missing declaration.

For Apple, use the authenticated App Store Connect API through Spaceship: select the exact editable version and primary locale, retain a manual-release draft, and prove screenshot sets are separate from the live version before replacing them. Use `APP_IPHONE_67` for these6.9-inch frames and `APP_IPAD_PRO_3GEN_129` for13-inch frames. Reserve each screenshot, upload all specified operations, commit the uploaded file and poll processing. Read back ordered sets, require `COMPLETE` and compare `sourceFileChecksum` with local MD5. Keep errors/receipts private. Do not select a build, change review credentials or submit review in a screenshot operation. Preserve the old exported bytes for an explicit rollback.

Do not advertise push delivery before #2626 passes on physical devices. Remove widget claims and screenshots from every locale. Keep imagery consistent with the widget-free binary. Maintain actual data-provider identity when a fallback serves an observation.

## Provider and privacy review

### Privacy/support hosting on the landing site

AK selected the existing `todayweather.ai` landing S3/CloudFront on 2026-10-01. The public review drafts are [privacy](https://todayweather.ai/mobile/privacy.html) and [support](https://todayweather.ai/mobile/support.html). They visibly remain review drafts. AK confirmed the operator/contact and optional Analytics/no-iOS-tracking direction on2026-10-01. On 2026-10-02 the operator requested the Play URL change, which appeared in the review list at the last observation. The pages still carry draft notices; the URL change does not complete retention/deletion, international-processing or runtime review. The root landing page is a separate asset.

The alias maps to a private regional S3 origin with OAC, empty origin path, HTTPS redirect and no edge navigation rewrite. The actual bucket name differs from the domain. Keep verified bucket/distribution/account identifiers in private deployment inputs. S3 versioning is enabled. The initial upload contained only `mobile/styles.css`, `mobile/support.html` and `mobile/privacy.html`. The approved continuation adds KO/EN/JA privacy, terms and support pages (`{privacy,terms,support}{,.en,.ja}.html`); never use bucket-root `sync --delete` or the PWA uploader for these documents.

For future updates, review the exact allowlisted document payload and set `AWS_PROFILE`, `LANDING_BUCKET`, `LANDING_ACCOUNT_ID` and `LANDING_DISTRIBUTION` from the verified landing inventory. From the repository root:

```sh
aws s3api put-object --bucket "$LANDING_BUCKET" --expected-bucket-owner "$LANDING_ACCOUNT_ID" --key mobile/styles.css --body client/fastlane/privacy/styles.css --content-type 'text/css; charset=utf-8' --cache-control 'public, max-age=300'
aws s3api put-object --bucket "$LANDING_BUCKET" --expected-bucket-owner "$LANDING_ACCOUNT_ID" --key mobile/support.html --body client/fastlane/privacy/support.html --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=300'
aws s3api put-object --bucket "$LANDING_BUCKET" --expected-bucket-owner "$LANDING_ACCOUNT_ID" --key mobile/privacy.html --body client/fastlane/privacy/privacy.html --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=300'
aws cloudfront create-invalidation --distribution-id "$LANDING_DISTRIBUTION" --paths /mobile/styles.css /mobile/support.html /mobile/privacy.html
```

For localized updates, upload only the changed, reviewed files from the nine HTML names above and invalidate those exact `/mobile/` paths; preserve the stylesheet unless changed. Before an overwrite, preserve existing object bodies/version IDs and the root landing hash. Record source SHA256, content type, cache metadata and resulting version IDs in ignored receipts. Verify public HTTPS200/body hashes and browser navigation/styles, plus the unchanged landing root. Restore a preserved prior version/body when needed; do not change bucket ACLs, OAC, DNS or shared header policies for a document upload. Initial new review objects matched public bodies immediately, so that run needed no invalidation.

See the [current privacy/data-flow worksheet](store-privacy-review.md) and the TodayWeather-specific [privacy](../../client/fastlane/privacy/privacy.html)/[support](../../client/fastlane/privacy/support.html) drafts. These drafts retain visible unresolved fields. Do not describe them as finalized merely because a store URL has been saved or submitted. Review hosting uses the existing todayweather.ai landing S3/CloudFront, at /mobile/privacy.html and /mobile/support.html. The worksheet distinguishes SDK collection from safe custom-event fields, device linkage from account login, and candidate answers from verified declarations.

| Provider | Release condition | Official reference |
| --- | --- | --- |
| KMA | Credit the specific source and preserve applicable third-party notices; inspect non-API images/indices independently | [Copyright policy](https://www.kma.go.kr/kma/guide/copyright.jsp), [forecast dataset](https://www.data.go.kr/data/15084084/openapi.do) |
| AirKorea | Source and provisional-data caution in app, operating-account evidence, and Type 3 no-alteration review; exact directly prescribed wording still needs confirmation | [Dataset](https://www.data.go.kr/data/15073861/openapi.do), [operating guide](https://apiweb.airkorea.or.kr/common/upload.pdf) |
| KASI | Credit recommended; catalog lists no license restriction | [Rise/set data](https://www.data.go.kr/data/15012688/openapi.do) |
| Visual Crossing | Near-data credit, equivalent data-error/official-warning cautions and account permission for cache/external delivery | [Current terms](https://www.visualcrossing.com/weather-service-terms/) |
| Google Air Quality/Geocoding | Near-data branding/source and applicable third-party notices; public Terms/Privacy and permitted storage | [Air policies](https://developers.google.com/maps/documentation/air-quality/policies), [geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) |
| OpenWeather | Confirm the account license and applicable Share-Alike or business terms; visible wording, link and logo where required | [FAQ](https://openweathermap.org/faq) |
| WAQI | Project and originating-agency credits plus explicit agreement for applicable for-profit use/cache/distribution | [API terms](https://aqicn.org/api/) |
| KAQ | Confirm current institution name, image/derived-data permission and required credit; historical app text is not approval evidence | [Provider site](http://www.kaq.or.kr/) |
| Kakao | Verify active geocoding use and account agreement; comply with trademark rules without implying partnership | [Policy](https://developers.kakao.com/terms/ko/site-policies) |

Keep provider review and source/caution notices current; do not represent an unresolved item as verified. Provider presence in the code is not evidence of production activation or contractual permission. Store credits do not replace mandatory in-app notices. The client About menu now exposes the existing translated KMA/AirKorea notice in every locale. Provider-specific fallback air attribution, links/branding and equivalent Visual Crossing cautions in the app still need implementation after the provider set is confirmed. Firebase/AdMob data collection, UMP, ATT, Apple privacy declarations, age rating and Play Data safety require a separate account/binary review.

## Verification and next gates

```sh
node --test client/test/payment-removal.test.cjs client/test/provider-notice.test.cjs
ruby client/test/store-release.test.rb
ruby -c client/fastlane/Fastfile
```

The lane tests stub Fastlane store calls to exercise missing-auth/artifact failure, fixed internal destination, preservation of metadata, TestFlight distribution options and API-only metadata export. They do not contact the stores, validate account permissions or upload a binary. `bundle exec fastlane lanes` separately checks loading against the installed Fastlane.

Before release, record the build revision, device/OS, upgrade-state preservation, push-token/delivery/tap results, real ads/consent, store upload validation, current listing diff and remaining declaration decisions.

### Initial audit findings and remaining release work

The 2026-10-01 audit found an existing Play removal involving the old Fabric SDK and missing Data safety, plus target-API/Billing warnings. The 1.1.0 recovery removed Fabric/purchases, verified target API 36, completed declaration preparation and excluded legacy artifacts across affected tracks. See the dated recovery table above; approval and public availability still require separate evidence.

Apple's initial audit found incomplete privacy/age-rating fields and obsolete demo-login information. A separate 1.1.0 manual-release metadata draft was prepared for the eight replacement screenshots while live 1.0.10 was preserved. Internal TestFlight delivery did not submit that App Store version or complete its listing/privacy review. Re-read the editable version, review access, age rating and privacy status before production submission; a failed public-API privacy read is not proof that a declaration is absent.

The initial Apple locale export referenced the old company privacy and Facebook support/marketing pages. This runbook records the later Play URL update separately; it does not claim Apple locale URLs were updated. Reconcile all store locales against the finalized mobile policy/support documents. Never work around an old URL's TLS failure by disabling certificate verification.

### Operating decisions and retention proposal (#2660)

The approved operator is 주식회사 플라잉; privacy contact 김동환/제품팀; support/deletion inbox todayweather@wizardfactory.net. Documents are Korean, English and Japanese only, for Cordova TodayWeather/general audience. Analytics requires optional explicit consent with default-off and settings withdrawal; advertising stays separately governed by UMP. iOS request preparation enforces nonpersonalized ads/first-party-ID off, and removes unused GTM that otherwise adds IdentitySupport indirectly. Exact native defaults must be checked in compiled output because FirebaseX2.0.2 omits iOS plist values from its install-variable handling. See [privacy review](store-privacy-review.md) and the [retention/deletion proposal](store-data-retention.md). The operator confirmed 90-day server request/error logs on 2026-10-02; this is not verification of every logging layer or SDK deletion policy. Other proposed limits, draft finalization and physical-device acceptance remain separate. Documentation edits do not configure cleanup or publish a store release.
