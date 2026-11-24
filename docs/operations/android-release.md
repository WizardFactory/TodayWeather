# Android release runbook

How a commit of the native Android app (`android/`) becomes a Google Play release. The first release is tracked in [#2898](https://github.com/WizardFactory/TodayWeather/issues/2898) (AN-19). This document defines the procedure; each release is recorded by its tag and GitHub Release, not here. Versions, tags and notes follow [GitHub Releases](github-releases.md); the automated checks are the release tier of [PR CI and release CI](../development/ci-tiers.md).

**Who does what.** AK is the operator: private inputs, the signing key, the Play Console and every approval are AK's. An agent may prepare the commit, run release CI and the emulator gates, draft the notes and check an APK it is given. An agent builds, signs, uploads or publishes only when AK says so for that release.

**Releases so far.** 2.0.0 (`versionCode` 200003) shipped before this runbook existed. On 2026-11-24 Play showed it in open testing and in production with the release completed (100%); when each track received it was not recorded. It was recorded afterwards as [`android/v2.0.0`](https://github.com/WizardFactory/TodayWeather/releases/tag/android/v2.0.0) by the method in [Recording a release built outside the runbook](#recording-a-release-built-outside-the-runbook). Its notes list what was and was not recorded at the time; the release CI run and the device gate were not. The next release, 2.0.1, is the first to follow every step.

**What a step proves.** A passed release CI run, a signed APK, an upload, an approved review and a finished rollout are five different states. Record each with its own evidence, and never infer a later one from an earlier one.

## Release order

| # | Step | Done when | Who |
| --- | --- | --- | --- |
| 1 | [Freeze the version](#1-freeze-the-version) | The version change is merged; its commit is the candidate | Agent or AK |
| 2 | [Release CI](#2-release-ci) | `Android release verification` passed for the candidate's full SHA | Agent or AK |
| 3 | [Manual gates on emulators](#manual-gates) | Every gate that is run passed on the candidate, evidence kept (the Cordova gates are not run) | Agent or AK |
| 4 | [Build and sign](#4-build-and-sign) | The export of the candidate is built and signed; `check-apk.sh` passes on the signed APK and its `mapping.txt` | AK |
| 5 | [Device gate](#5-device-gate) | The signed APK passed the physical-device checks | AK |
| 6 | [Tag the candidate](#6-tag-the-candidate-and-publish-its-notes) | `android/vX.Y.Z-rc.N` and its pre-release exist; `--check` passes | AK |
| 7 | [Store declarations and test tracks](#7-store-declarations-and-test-tracks) | Internal and open testing accepted | AK |
| 8 | [Production](#8-production-rollout) | `android/vX.Y.Z` released to 100%; no halt signal in the first week | AK |
| 9 | [Close](#9-close-the-release) | Notes say `deployed`; #2898 or the release issue updated | AK or agent |

A failure at any step ends the candidate. Fix on `master`, then start again at step 1 with the next candidate number and a higher `versionCode`. Keep the failed candidate's tag, Release and evidence.

### 1. Freeze the version

`versionName` and `versionCode` are in `android/app/build.gradle.kts`. Change them in a pull request; the merged commit on `master` is the candidate, so the source commit states its own version.

- `versionName` is `MAJOR.MINOR.PATCH`, the version of the tag.
- `versionCode` must be above every code on every active Play track, the Cordova builds included, and must not have been uploaded before. Read the tracks and the uploaded codes in the Play Console before choosing. 200000–200003 are spent (2.0.0); 2.0.1 candidate 1 is 200010. The default is `MAJOR × 100000 + MINOR × 1000 + PATCH × 10 + (candidate − 1)`: 2.0.0 candidate 1 is 200000, candidate 2 is 200001, and 2.0.1 starts at 200010. Play accepts a code once, so each candidate that was uploaded needs a new one.

### 2. Release CI

```sh
gh workflow run android-release.yml --ref <branch or tag at the candidate> -f ref=<full SHA>   # master, while it is the candidate
gh run list --workflow android-release.yml --limit 5
gh run view <run id> --json conclusion,jobs --jq '.conclusion, (.jobs[] | "\(.name): \(.conclusion)")'
```

The run must conclude `success` and its `Verified commit` job must name the candidate's SHA. The run's URL goes into the release notes. A nightly run of another commit does not count. What the run covers is listed in [PR CI and release CI](../development/ci-tiers.md#android).

### Manual gates

Release CI has no secret, no Cordova build, no Play Store image and no phone. These checks cover what it cannot, on the candidate commit. Each runner refuses anything but an emulator, and the offline ones keep the emulator offline while an app is installed.

The gates run debug builds, which R8 does not shrink; the first run of the shrunk release code is the [device gate](#5-device-gate).

Every runner takes the emulator from `ANDROID_SERIAL` and installs the debug and test APKs of the last build, so build for the gate you are about to run and name an output directory under ignored `reports/`:

```sh
git rev-parse HEAD                                 # the candidate's full SHA
cd android && ./gradlew assembleDebug assembleDebugAndroidTest
adb devices                                        # the emulator's serial, emulator-<port>
ANDROID_SERIAL=emulator-5554 tools/<runner> [<apk> ...] ../reports/android-release/<version>/<gate>
```

The gates need two builds, each from the candidate commit with the inputs of [Private inputs](../../android/README.md#private-inputs):

| Build | Private inputs | Gates |
| --- | --- | --- |
| Full | `app/google-services.json`, `TW_SERVER_URL`, `TW_PLACES_API_KEY_ANDROID`, `TW_MAIL_TO` | Every gate that is run but the menu hand-offs. The test application sends weather requests to the production server only in the production gates, and never sends a push request |
| Without a server | `TW_MAIL_TO`; `TW_SERVER_URL` removed from the environment and `android/private.properties` | Menu hand-offs: its runner requires a build without a server URL |

Releases do not consider Cordova compatibility (AK, 2026-11-24): the four gates that need a Cordova 1.1.1 APK (upgrade, hand-back, backup and restore, notification after the upgrade) are not run. They stay listed for the record.

| Gate | Command under `android/tools/` | Needs | Emulators |
| --- | --- | --- | --- |
| **Not run.** Upgrade from Cordova 1.1.1: state, push re-registration, token work, entry intents | `upgrade/run-upgrade-test.sh <cordova-1.1.1-debug.apk> [out] [token-a\|token-b]` | Cordova 1.1.1 debug APK signed with the same debug key; `app/google-services.json` | API 36 and API 24 |
| **Not run.** Rollback hand-back to a Cordova fallback and back | `upgrade/run-handback-test.sh <cordova-1.1.1-debug.apk> <fallback-debug.apk> [out]` | The two Cordova APKs; the fallback's `versionCode` above this build's | API 36 |
| **Not run.** Backup and restore, a Cordova backup included; entry links | `backup/run-backup-test.sh <cordova-1.1.1-debug.apk> [out]` | Cordova 1.1.1 debug APK | API 36 and API 24 |
| **Not run.** Notification after the upgrade | `emulator/run-notification-check.sh <cordova-1.1.1-debug.apk> [out]` | Cordova 1.1.1 debug APK; `app/google-services.json`; a Google APIs image | API 36 and API 24 |
| Ads, consent and analytics choice | `emulator/run-ads-check.sh [out]` | `app/google-services.json`; network | API 36 |
| Weather, air and nationwide pages from production | `emulator/run-production-weather.sh [out]` | `TW_SERVER_URL`; network | API 36 and API 24 |
| New install: position or search reaches the weather | `emulator/run-production-start.sh [out]` | `TW_SERVER_URL`, and `TW_PLACES_API_KEY_ANDROID` for the search with Google's predictions; Google Play services; network | API 36 |
| Places from production: add, swipe, delete | `emulator/run-production-places.sh [out]` | `TW_SERVER_URL`, `TW_PLACES_API_KEY_ANDROID`; network | API 36 |
| Charts against the Cordova captures of the same emulator type | `chart-reference/device-smoke.sh [out]` | An emulator of the type the references were captured on (arm64 Google APIs image): on the hosted x86_64 emulator the chart heights differed by 9 px and the comparison failed (2026-11-23) | API 36 |
| Menu hand-offs to the browser, the mail app and the store | `emulator/run-settings-handoffs.sh <out> store` | `TW_MAIL_TO`; an image with the Play Store for `store` | API 34 Play image; without `store` on API 36 |

Keep each gate's output directory under ignored `reports/`; it can show private configuration. The release notes name the evidence by a private reference, never by its contents.

### 4. Build and sign

On the operator's machine, at the root of a checkout that has the candidate commit (any branch; the checkout itself is not built). The release is built from an export of the commit in a new directory, never from a checkout: a checkout can hold changed, untracked, ignored or index-flagged files that a build would take in, and Git can convert files on the way out. Needs `python3`, the Android SDK (`ANDROID_HOME`) and JDK 17.

```sh
CANDIDATE=<full SHA>                             # the SHA the release CI run verified
BUILD=<new directory outside the checkout>       # absolute; it must not exist
PRIVATE=<directory with google-services.json and private.properties>
APK="$OUT/TodayWeather-<versionName>-<versionCode>.apk"
MAPPING="$OUT/TodayWeather-<versionName>-<versionCode>-mapping.txt"
STORE_APK=<installed-store-release.apk>
BUILD_TOOLS="$ANDROID_HOME/build-tools/36.0.0"
android/tools/release/export_candidate.py "$CANDIDATE" "$BUILD" --private "$PRIVATE" &&
  (cd "$BUILD/android" &&
    tools/release/gradle-release.sh &&           # assembleRelease with R8; refuses sample or missing AdMob IDs
    "$BUILD_TOOLS/zipalign" -c -P 16 4 app/build/outputs/apk/release/app-release-unsigned.apk &&
    "$BUILD_TOOLS/apksigner" sign --ks "$TW_ANDROID_KEYSTORE" --ks-key-alias "$TW_ANDROID_KEY_ALIAS" \
      --out "$APK" app/build/outputs/apk/release/app-release-unsigned.apk &&
    cp app/build/outputs/mapping/release/mapping.txt "$MAPPING" &&
    tools/release/check-apk.sh "$APK" "$STORE_APK" "$MAPPING")
```

The commands are one chain: a failed export, a failed build or a failed signature stops everything after it. Everything after the export runs the export's own tools, those of the candidate.

- **`export_candidate.py`** reads every file of `<SHA>:android` as a blob from Git's object database and writes it with its bytes and mode. No checkout, archive, attribute, line-ending conversion or replaced object is involved. It refuses a tree with a symbolic link or a submodule, then reads the directory back: it must hold exactly the commit's paths, each with the blob's hash and mode. Only then does it write the two private inputs as new files that only the owner can read, in a directory only the owner can enter (a commit that already has a file there is refused), and `CANDIDATE` with the SHA. It refuses a name that is not a full SHA, an unknown commit, a directory or link that exists (named with or without a trailing `/`), a path with `..` and a directory inside the checkout before it writes anything, and removes its directory when it fails.
- **R8.** The release build type shrinks, optimizes and obfuscates the code with R8 and removes unused resources (`app/build.gradle.kts`; the app's rules are `app/proguard-rules.pro` and `app/src/release/res/raw/keep.xml`). It writes `app/build/outputs/mapping/release/mapping.txt`, which turns the obfuscated names of a stack trace back into the source's. Without it the crashes and ANRs of this release cannot be read: keep `$MAPPING` with the signed APK, upload it to Play with the APK (step 7) and keep it until the release is closed and no user has it any more. A mapping fits the code of the build that wrote it; `check-apk.sh` checks that it is the uploaded APK's.
- **Crashlytics mapping upload.** With `google-services.json`, the Crashlytics Gradle plugin also uploads `mapping.txt` to the Firebase project right after R8 (`uploadCrashlyticsMappingFileRelease`), so Crashlytics shows readable stack traces. The release build therefore needs a network connection, and a failed upload fails the build. The plugin writes a new random mapping ID into the APK's resources at each build (`com.google.firebase.crashlytics.mapping_file_id`), so two builds of the same commit differ in `resources.arsc`, and each build's upload is filed under its own ID. A rebuild made only to compare bytes ([Recording a release built outside the runbook](#recording-a-release-built-outside-the-runbook)) runs `gradle-release.sh --without-crashlytics-upload`, which leaves out that upload task (`-x :app:uploadCrashlyticsMappingFileRelease`). A build without `google-services.json` (CI, tests) applies neither plugin and uploads nothing.
- **`gradle-release.sh`** runs `./gradlew --no-daemon --no-build-cache assembleRelease` in the export. The build reads each private input from the environment before `private.properties`, and JVM option variables can redirect Gradle itself, so the wrapper starts Gradle with a new environment: the variables that say where things are and how text is encoded (`HOME`, `PATH`, `ANDROID_HOME`, `JAVA_HOME`, the locale and a few more, listed in the script) and no other. Nothing else of the shell reaches the build; the wrapper prints the names it kept out. The Gradle user home is the operator's (`GRADLE_USER_HOME` or `~/.gradle`), for the wrapper and dependency caches. An init script there (`init.gradle`, `init.gradle.kts`, `init.d/`) would run in the build, so with one present the build does not start, and the home that was inspected is the one Gradle is given. When the user has a `gradle.properties` there, the wrapper names the file and shows nothing of it; read it before trusting the build.
- Record the candidate SHA, the signed APK's SHA-256, the mapping's SHA-256 and the time of the build together; the release notes carry all but the time. Keep `$BUILD` until the release is closed.
- `apksigner` asks for the keystore and key passwords; do not put them on the command line, in a file of the checkout or in a log. `TW_ANDROID_KEYSTORE` and `TW_ANDROID_KEY_ALIAS` name the existing release keystore and its key. The app is not enrolled in Play App Signing, so this key is the one users' installs are signed with: a different key cannot update them.
- `$OUT`, `$PRIVATE` and `$BUILD` are absolute paths outside the checkout (`$OUT` may be under ignored `reports/`). Keep the signed APK; the uploaded file and the checked file must be the same bytes.
- `$STORE_APK` (an absolute path) is the release users have now, 2.0.0 (200003) until 2.0.1 ships. Use the operator's copy of the previous release's signed APK. Its SHA-256 must equal the `APK SHA-256` in that release's notes. Without a copy, take it from a phone that installed it from Play (`adb shell pm path net.wizardfactory.todayweather`, then `adb pull` the `base.apk`) and compare the hash the same way.
- `check-apk.sh` verifies both signatures, compares every signer's certificate and the package with the store release, requires a higher `versionCode`, compares `versionName`, `versionCode`, `minSdk` and `targetSdk` with the export's `app/build.gradle.kts`, and refuses a debuggable APK, Google's sample AdMob app ID and a build without the Firebase configuration. Through `check_r8.py` it refuses an APK with code that R8 did not compile, an APK whose app code R8 did not obfuscate or shrink (of the app's own classes that remain, the mapping does not rename more than it keeps under their names, or it removes none), and a mapping file that is not this APK's (the one `pg-map-id` of the app's dex files against the mapping's `pg_map_id`) or not complete (its content against the SHA-256 in its header). It prints the identity lines of the release notes. A `FAIL` line ends the candidate.
- A candidate is exported and built once. For another attempt, export to a new directory.

### 5. Device gate

On a physical phone that has the current store release installed with real state (places, alarms, units, an analytics choice), install the signed APK over it with `adb install -r` and check the following. This is the first run of the R8-shrunk code, so also read the app's crash log after the checks (`adb logcat -d -b crash`); a `ClassNotFoundException`, `NoSuchMethodError`, `NoSuchFieldError` or a missing resource there ends the candidate, as does a screen that misses text the debug build shows.

1. Places, the selected place, units, settings and alarms are those of the store release.
2. The app registers its push token once per alarm with the same device ID, and a scheduled notification arrives and opens the app on its place.
3. The analytics choice is the one made before the update, and without an opt-in the app sends no Analytics event. Crash reports are a separate matter: Crashlytics collects them whatever the analytics choice is (`firebase_crashlytics_collection_enabled` in the manifest), as the Cordova build did, and the Play declarations of step 7 must say so.
4. After consent, real ads load in the forecast and the interstitial follows its cap. No test ad appears.
5. Current position, place search, the weather, air and nationwide pages, sharing and the widget work against production.
6. The app starts without a crash after a restart of the phone.

Uninstalling, clearing data or downgrading on AK's phone needs AK's word each time. Screenshots and backups from the phone stay private.

### 6. Tag the candidate and publish its notes

From the repository root:

```sh
node scripts/release-notes.mjs --scope android --version <X.Y.Z>-rc.<N> --commit <full SHA> > "$OUT/notes.md"
# the first native release has no earlier android/ tag: add --from <commit before the first android/ commit>
$EDITOR "$OUT/notes.md"                          # replace every <fill in>; trim the change list to what users get
TAG=android/v<X.Y.Z>-rc.<N>
git tag -a "$TAG" <full SHA> -m "Android <X.Y.Z> candidate <N>"   # local only so far
node scripts/release-notes.mjs --check "$OUT/notes.md" --tag "$TAG" --commit <full SHA> &&
  git push origin "$TAG" &&
  gh release create "$TAG" --verify-tag --prerelease --latest=false --title "$TAG" --notes-file "$OUT/notes.md"
```

`--check` is told the tag and the commit that are about to be published: it fails when the notes are of another tag, name another commit or have an unfilled field, or when the local tag is missing or elsewhere. The tag is pushed only after it passes, and the Release is created only after the push. When `--check` fails, fix the notes, or delete the local tag (`git tag -d "$TAG"`) when it names the wrong commit, and run the chain again. A pushed tag is never moved or reused.

The notes carry the release CI run, the `check-apk.sh` identity lines and the references of the manual and device gates. No APK is attached: Google Play is the only distribution, and the notes identify the file by its SHA-256.

### 7. Store declarations and test tracks

1. Compare the merged manifest's permissions (`aapt2 dump permissions <signed.apk>`) and the app's actual data flows with the Play declarations: Data safety, ads and advertising ID, location, notifications, app access. Use the [store privacy review](store-privacy-review.md) and the [policy evidence](store-policy-evidence.md). A changed answer is saved and verified before the upload.
2. Upload the signed APK once to internal testing. Read back the version code list of the track before committing the change. Do not touch other tracks. Then upload `$MAPPING` as the version code's deobfuscation file (App bundle explorer, the version code, Downloads, ReTrace mapping file) and read back that Play lists it; Android vitals shows obfuscated stack traces for the version without it. Record both uploads in the notes' `Store status`.
3. Check the update from Play: a phone with the current store release (2.0.0 for 2.0.1) and real state, whose account is an internal tester, receives the candidate from the internal track; its state is kept and the device gate's checks 1–6 hold.
4. Promote the same file, with the same version code, to open testing. To see that the open track serves it, use an account that is not an internal tester. Closed testing is skipped (AK, 2026-11-24, from 2.0.1 on): it still holds the Cordova 1.1.0 build (100090) from before the native app. Leave that track as it is. This replaces the internal, closed and open order that #2898 names.
5. After each change, edit the pre-release notes: `Store status`, `Attempts`, the time and what was read back.

Upload, review and track handling, with their failure cases, are in the [Cordova store release](cordova-store-release.md) and its [troubleshooting](cordova-store-troubleshooting.md): the Play application, its tracks and its review are the same. Its upload lane accepts an AAB for the internal track only; this APK is uploaded in the Play Console.

### 8. Production rollout

When the open test is accepted, the same file goes to production. From the repository root:

```sh
TAG=android/v<X.Y.Z>
git tag -a "$TAG" <full SHA> -m "Android <X.Y.Z>"                   # the candidate's commit; local only so far
node scripts/release-notes.mjs --check "$OUT/notes-final.md" --tag "$TAG" --commit <full SHA> &&
  git push origin "$TAG" &&
  gh release create "$TAG" --verify-tag --latest=false --title "$TAG" --notes-file "$OUT/notes-final.md"
```

`notes-final.md` is the candidate's notes with `Tag:` set to the final tag (`--check` fails while it still says the candidate's), the candidate's tag as the tested build, and the rollout record. The final tag points at the candidate's commit and names the candidate's APK; nothing is rebuilt.

Release to 100% of users at once; there is no staged rollout (AK, 2026-11-24). Watch the signals below for the first week. Halt the release in the Play Console (it stops new installs of the release; installed users keep it) when any of these holds for the new version. Stop it on every track that serves it, because the testing tracks hold the same version code: halt the rollout on production and open testing, and pause the internal testing track (internal testing has no halt). Then check that no track still serves the version code.

| Signal | Halt when | Read from |
| --- | --- | --- |
| User-perceived crash rate | Above 1.09%, or twice the previous release's rate | Android vitals |
| User-perceived ANR rate | Above 0.47%, or twice the previous release's rate | Android vitals |
| Crash-free users | Below 99.0% | Crashlytics |
| Lost state after the update | One confirmed report of lost places, alarms or settings | Reviews, feedback mail, testers |
| Weather requests failing | Failure share of `weather_fetch` above the previous release's by 2 points | Analytics, CloudFront logs |
| Push registrations | Registrations per updated install clearly below the previous release's, or duplicate registrations | Push server logs |

The crash and ANR limits are Google Play's bad-behavior thresholds ([crashes](https://developer.android.com/google/play/vitals/crash), [ANRs](https://developer.android.com/google/play/vitals/anr); read 2026-11-23). The other limits are proposed values; the release notes record the values used.

### 9. Close the release

One week after the release reached 100%, read the signals of step 8 and close the release. Set `Rollout status: deployed` in the final notes with the time 100% was reached, the end of the week and the values read then; a halt within the week sets `failed` instead. Update the release issue. For #2898, AK's decisions of 2026-11-24 (one full rollout; no Cordova compatibility) replace its staged-rollout and Cordova-upgrade criteria. Keep the signed APK, its `mapping.txt`, the private evidence and the previous release's APK: the next release's `check-apk.sh` and device gate start from them, and the mapping reads the crashes of the release for as long as users have it.

## Halt and rollback

Google Play cannot move users back to an older version code. After a halt:

1. **Fix forward.** Fix on `master`, take the next `PATCH` with a higher `versionCode`, and run this runbook again from step 1. Resume as a new release; the halted release's notes get `Rollout status: failed` and the reason.
A Cordova fallback is no longer a rollback path: releases do not consider Cordova compatibility (AK, 2026-11-24).

Record the halt time, the signal and its value in the notes before the fix.

## Recording a release built outside the runbook

A build that reached Play without this runbook gets its tag and Release afterwards, from evidence that identifies its bytes. It is an exception to the candidate rule of [GitHub Releases](github-releases.md#versions-candidates-and-tags): the binaries on the test tracks have no candidate tags, and the final Release records that. 2.0.0 was recorded this way on 2026-11-24, with AK's approval of the same day.

1. **The shipped file.** Get the signed APK: the operator's copy, or `adb pull` from a phone that installed it from Play. Its SHA-256 must equal the SHA-256 that Play reports for the version code. The Play Developer API lists it per uploaded APK (`edits.apks.list`). Read it in an edit that is deleted without committing, and only when the operator has no API edit in progress: a new edit can invalidate the edit another session of the same account has open. Keep the dated read-out with the evidence. `apksigner verify --print-certs` must show the signer of the previous store release.
2. **The commit.** Narrow the candidates by build or install time and by what the release notes describe. Export a candidate with `export_candidate.py` and record the exporter's commit. Change in the export only what the shipped build demonstrably differs in, such as `versionCode`, and record each change. Build with the shipped build's private inputs, with `tools/release/gradle-release.sh --without-crashlytics-upload`: the rebuild's mapping would otherwise be uploaded to Firebase under a new mapping ID that no shipped APK names. The values compiled into `BuildConfig` and the manifest can be read from the APK. The Firebase configuration cannot: use the operator's retained `google-services.json`. Record the Gradle, Kotlin and JDK versions. Keep the values out of logs and delete the export afterwards.
3. **The comparison.** Compare the unsigned rebuild with the signed APK entry by entry. Refuse duplicate entry names. APK Signature Scheme v2 and later sign in a block outside the entries, so a store APK without a JAR (v1) signature (`apksigner verify -v` reports v1 false) is compared in every entry. Only when it has a verified v1 signature, ignore the files of that signature: `META-INF/MANIFEST.MF` and its signer's `.SF` and signature block file. Every other entry must match in name, order, compression method and bytes, with one exception: a build with R8 and the Firebase configuration carries a random Crashlytics mapping ID ([step 4](#4-build-and-sign)), so in `resources.arsc` the rebuild may differ from the shipped APK in that ID alone: `aapt2 dump resources` of the two files must differ only in the value of `com.google.firebase.crashlytics.mapping_file_id`. A missing input or a difference leaves the source unconfirmed: keep the APK hash and the Play read-out in the operator's private record, and create no tag or GitHub Release until the evidence identifies the commit.
4. **The commit to tag.** Every commit with the same `android/` tree builds the same bytes from the same inputs and tools, but for that mapping ID. Tag the commit through which that tree first entered `master`'s first-parent history (a merge commit, not a branch commit): [GitHub Releases](github-releases.md#versions-candidates-and-tags) tags commits on `master`.
5. **The Release.** Draft final notes with `node scripts/release-notes.mjs --scope android --version <X.Y.Z> --commit <full SHA>`, adding `--from <commit>` when the scope has no earlier tag. Fill every field from the evidence. Write "none" or "no record" where a step left no evidence. Name the test-track uploads that have no candidate tags. State each change made in the build tree. Then create the annotated tag locally, run `--check` against it, push the tag and create the Release, in the order of [step 8](#8-production-rollout). `--check` confirms the fields, tag and commit, not the facts: the evidence above does.
