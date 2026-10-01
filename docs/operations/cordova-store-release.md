# Cordova store release — TodayWeather 1.1.0 (#2605)

TodayWeather uses the existing Cordova npm build scripts. This release excludes widgets and purchases, keeps AdMob, and requires physical-device notification/advertising checks. TodayAir is outside scope. Do not use the old product Gulp release tasks to prepare this version.

## API authentication and local setup

Use Ruby 3.2 or later; macOS system Ruby 2.6 is insufficient for the installed Fastlane dependency set. From `client/`, run `bundle install` and copy `fastlane/.env.example` to `fastlane/.env`. The example contains file paths and identifiers only. Keep Google credentials and Apple `.p8` files outside Git. `client/.env` is the existing **build** configuration; `client/fastlane/.env` is separate **store** authentication.

- `TW_PLAY_JSON_KEY`: service-account JSON authorized for the existing `net.wizardfactory.todayweather` Play application.
- `TW_ASC_KEY_ID`, `TW_ASC_ISSUER_ID`, `TW_ASC_KEY_FILE`: App Store Connect API key identifiers and local private-key path.
- iOS signing remains in Xcode per the existing maintainer decision. The lane accepts an exported, signed IPA; it does not generate certificates or modify provisioning.

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

## Build and upload for testing

```sh
cd client
npm run build:android:release
npm run store:upload:android -- aab:/absolute/path/to/app-release.aab
npm run build:ios:release
# Archive/sign/export an IPA with Xcode, then:
npm run store:upload:ios -- ipa:/absolute/path/to/TodayWeather.ipa
```

Android always uploads to the `internal` track with `release_status: draft`. It preserves existing listing text, images, screenshots and changelogs; the draft must subsequently be reviewed and activated before testers receive it. An extra `track:production` argument does not change the lane's destination.

iOS uploads the binary to TestFlight and returns without waiting for processing. It does not submit external beta review or distribute externally. This lane does not prevent App Store Connect's existing internal-group settings from making a processed build available to internal testers. Check processing/upload validation afterward.

The text validation lane reads the existing production release because Supply requires a release even for metadata-only validation. It requests no binary upload, rollout, promotion, screenshots/changelog upload or commit. Google currently rejects its validate step for this removed app with a manual-review requirement (`changesNotSentForReview`); do not describe that as successful validation. The temporary test edit was discarded after the investigation. Internal drafts set `changes_not_sent_for_review: true` explicitly.

No production promotion, committed metadata-upload or App Store submission lane is configured in this initial step. Add these after inspecting the current listing, fixing the Play enforcement cause and reviewing provider/privacy conditions. A successful upload does not establish review approval or production availability.

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

For Play, use Fastlane Supply's existing API client: begin an edit for the fixed package, read/backup `phoneScreenshots`, clear only the three explicit locale sets, upload ordered files, then compare returned SHA256 hashes. Commit with `changes_not_sent_for_review:true` and automatic review fallback disabled. Abort on failure; after success, read through a fresh edit and compare again, then abort that read edit. Do not modify text, icons, graphics or tracks. The initial Data safety declaration must be completed before retrying this release's rejected commit; toggling the review flag does not bypass that requirement.

For Apple, use the authenticated App Store Connect API through Spaceship: select the exact editable version and primary locale, retain a manual-release draft, and prove screenshot sets are separate from the live version before replacing them. Use `APP_IPHONE_67` for these6.9-inch frames and `APP_IPAD_PRO_3GEN_129` for13-inch frames. Reserve each screenshot, upload all specified operations, commit the uploaded file and poll processing. Read back ordered sets, require `COMPLETE` and compare `sourceFileChecksum` with local MD5. Keep errors/receipts private. Do not select a build, change review credentials or submit review in a screenshot operation. Preserve the old exported bytes for an explicit rollback.

Do not advertise push delivery before #2626 passes on physical devices. Remove widget claims and screenshots from every locale. Keep imagery consistent with the widget-free binary. Maintain actual data-provider identity when a fallback serves an observation.

## Provider and privacy review

### Privacy/support hosting on the landing site

AK selected the existing `todayweather.ai` landing S3/CloudFront on 2026-10-01. The public review drafts are [privacy](https://todayweather.ai/mobile/privacy.html) and [support](https://todayweather.ai/mobile/support.html). They visibly remain review drafts. AK confirmed the operator/contact and optional Analytics/no-iOS-tracking direction on2026-10-01. Do not register them as final store policies until retention/deletion, international processing and final runtime evidence are complete. The root landing page is a separate asset.

The alias maps to a private regional S3 origin with OAC, empty origin path, HTTPS redirect and no edge navigation rewrite. The actual bucket name differs from the domain. Keep verified bucket/distribution/account identifiers in private deployment inputs. S3 versioning is enabled. The initial upload contained only `mobile/styles.css`, `mobile/support.html` and `mobile/privacy.html`. The approved continuation adds KO/EN/JA privacy, terms and support pages (`{privacy,terms,support}{,.en,.ja}.html`); never use bucket-root `sync --delete` or the PWA uploader for these documents.

For future updates, review the exact allowlisted document payload and set `AWS_PROFILE`, `LANDING_BUCKET`, `LANDING_ACCOUNT_ID` and `LANDING_DISTRIBUTION` from the verified landing inventory. From the repository root:

```sh
aws s3api put-object --bucket "$LANDING_BUCKET" --expected-bucket-owner "$LANDING_ACCOUNT_ID" --key mobile/styles.css --body client/fastlane/privacy/styles.css --content-type 'text/css; charset=utf-8' --cache-control 'public, max-age=300'
aws s3api put-object --bucket "$LANDING_BUCKET" --expected-bucket-owner "$LANDING_ACCOUNT_ID" --key mobile/support.html --body client/fastlane/privacy/support.html --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=300'
aws s3api put-object --bucket "$LANDING_BUCKET" --expected-bucket-owner "$LANDING_ACCOUNT_ID" --key mobile/privacy.html --body client/fastlane/privacy/privacy.html --content-type 'text/html; charset=utf-8' --cache-control 'public, max-age=300'
aws cloudfront create-invalidation --distribution-id "$LANDING_DISTRIBUTION" --paths /mobile/styles.css /mobile/support.html /mobile/privacy.html
```

For localized updates, upload only the9reviewed HTML names above and explicitly invalidate their9/mobile/paths; preserve the stylesheet unless changed. Before an overwrite, preserve existing object bodies/version IDs and the root landing hash. Record source SHA256, content type, cache metadata and resulting version IDs in ignored receipts. Verify public HTTPS200/body hashes and browser navigation/styles, plus the unchanged landing root. Restore a preserved prior version/body when needed; do not change bucket ACLs, OAC, DNS or shared header policies for a document upload. Initial new review objects matched public bodies immediately, so that run needed no invalidation.

See the [current privacy/data-flow worksheet](store-privacy-review.md) and the TodayWeather-specific [privacy](../../client/fastlane/privacy/privacy.html)/[support](../../client/fastlane/privacy/support.html) drafts. These drafts retain visible unresolved fields and must not be registered as approved store policy pages. Review hosting uses the existing todayweather.ai landing S3/CloudFront, at /mobile/privacy.html and /mobile/support.html. The worksheet distinguishes SDK collection from safe custom-event fields, device linkage from account login, and candidate answers from verified declarations.

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

Observed on 2026-10-01: Play removed this app on 2024-10-08 for the old Fabric SDK collecting permanent identifiers and for a missing Data safety form. The policy center also lists target API and Billing 8 warnings. The new code removes Fabric/purchases and targets API 36, but every affected store track still needs review and compliant replacement. The Data safety form must reflect the final SDKs and data flows.

The S3 release inputs were recovered through the existing named AWS profile; real AdMob app IDs were verified against the store-linked TW apps and saved only in ignored build configuration. A signed 1.1.0/100090 AAB was built locally. The old S3 Google service-account JSON initially failed on a disabled API and then on missing app permission. API enablement and TW-only access for the existing identity were completed after user approvals; a real six-locale listing/image export succeeded. Google automatically includes policy-declaration management in its app-information-management bundle; account-wide/admin/finance/orders/production permissions remain off. Apple API authentication and real five-locale metadata export also succeeded. No store release, privacy declaration or Apple legal agreement was submitted.

Apple observations on 2026-10-01: current iOS version1.0.10 is `READY_FOR_SALE`, and a separate1.1.0 `PREPARE_FOR_SUBMISSION` manual-release draft created for the8new screenshots. API review data still requires a demo login, which must be corrected for the current login-free weather flow. New age-rating fields including advertising/social media are null; null does not mean an answered “No.” The privacy page displays “Get Started” and no collection declaration; draft answers must cover the final SDK/data flows. The installed Fastlane privacy read endpoints return404 with the public API key, so they do not establish privacy publication state; the browser observation is the evidence. Account-holder-only actions must be reviewed separately before store submission.

All five locales still point to `http://www.wizardfactory.net/privacy.html` and the old Facebook support/marketing page. The HTTP privacy document returns200 but describes account/social-login/payment handling across multiple services. HTTPS for `www.wizardfactory.net` fails hostname validation, and the bare domain did not resolve in this check. Choose the scope of a current privacy/support document and restore a valid HTTPS destination before updating listing URLs; do not disable certificate validation or publish guessed retention/deletion commitments.

### Operating decisions and retention proposal (#2660)

The approved operator is 주식회사 플라잉; privacy contact 김동환/제품팀; support/deletion inbox todayweather@wizardfactory.net. Documents are Korean, English and Japanese only, for Cordova TodayWeather/general audience. Analytics requires optional explicit consent with default-off and settings withdrawal; advertising stays separately governed by UMP. iOS request preparation enforces nonpersonalized ads/first-party-ID off, and removes unused GTM that otherwise adds IdentitySupport indirectly. Exact native defaults must be checked in compiled output because FirebaseX2.0.2 omits iOS plist values from its install-variable handling. See [privacy review](store-privacy-review.md) and the [retention/deletion proposal](store-data-retention.md). Proposed limits are not yet deployed cleanup. No final privacy declaration or binary release is implied by these source changes.
