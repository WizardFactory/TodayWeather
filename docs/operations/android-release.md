# Android release runbook

How a commit of the native Android app (`android/`) becomes a Google Play release. The release itself is tracked in [#2898](https://github.com/WizardFactory/TodayWeather/issues/2898) (AN-19). This document defines the procedure; it does not record that a release happened. Versions, tags and notes follow [GitHub Releases](github-releases.md); the automated checks are the release tier of [PR CI and release CI](../development/ci-tiers.md).

**Who does what.** AK is the operator: private inputs, the signing key, the Play Console and every approval are AK's. An agent may prepare the commit, run release CI and the emulator gates, draft the notes and check an APK it is given. An agent builds, signs, uploads or publishes only when AK says so for that release.

**What a step proves.** A passed release CI run, a signed APK, an upload, an approved review and a finished rollout are five different states. Record each with its own evidence, and never infer a later one from an earlier one.

## Release order

| # | Step | Done when | Who |
| --- | --- | --- | --- |
| 1 | [Freeze the version](#1-freeze-the-version) | The version change is merged; its commit is the candidate | Agent or AK |
| 2 | [Release CI](#2-release-ci) | `Android release verification` passed for the candidate's full SHA | Agent or AK |
| 3 | [Manual gates on emulators](#manual-gates) | Every gate passed on the candidate, evidence kept | Agent or AK |
| 4 | [Build and sign](#4-build-and-sign) | The export of the candidate is built and signed; `check-apk.sh` passes on the signed APK | AK |
| 5 | [Device gate](#5-device-gate) | The signed APK passed the physical-device checks | AK |
| 6 | [Tag the candidate](#6-tag-the-candidate-and-publish-its-notes) | `android/vX.Y.Z-rc.N` and its pre-release exist; `--check` passes | AK |
| 7 | [Store declarations and test tracks](#7-store-declarations-and-test-tracks) | Internal, closed and open testing accepted | AK |
| 8 | [Production](#8-production-rollout) | `android/vX.Y.Z` released; staged rollout at 100% without a halt | AK |
| 9 | [Close](#9-close-the-release) | Notes say `deployed`; #2898 or the release issue updated | AK or agent |

A failure at any step ends the candidate. Fix on `master`, then start again at step 1 with the next candidate number and a higher `versionCode`. Keep the failed candidate's tag, Release and evidence.

### 1. Freeze the version

`versionName` and `versionCode` are in `android/app/build.gradle.kts`. Change them in a pull request; the merged commit on `master` is the candidate, so the source commit states its own version.

- `versionName` is `MAJOR.MINOR.PATCH`, the version of the tag.
- `versionCode` must be above every code on every active Play track, the Cordova builds included. Read the tracks in the Play Console before choosing. The default is `MAJOR × 100000 + MINOR × 1000 + PATCH × 10 + (candidate − 1)`: 2.0.0 candidate 1 is 200000, candidate 2 is 200001, and 2.0.1 starts at 200010. Play accepts a code once, so each candidate that was uploaded needs a new one.
- A Cordova fallback build for a rollback needs a code above the native release it replaces ([hand-back](../../android/README.md#rollback-hand-back-to-a-cordova-build-an-17)).

### 2. Release CI

```sh
gh workflow run android-release.yml --ref master -f ref=<full SHA>
gh run list --workflow android-release.yml --limit 5
gh run view <run id> --json conclusion,jobs --jq '.conclusion, (.jobs[] | "\(.name): \(.conclusion)")'
```

The run must conclude `success` and its `Verified commit` job must name the candidate's SHA. The run's URL goes into the release notes. A nightly run of another commit does not count. What the run covers is listed in [PR CI and release CI](../development/ci-tiers.md#android).

### Manual gates

Release CI has no secret, no Cordova build, no Play Store image and no phone. These checks cover what it cannot, on the candidate commit. Each runner refuses anything but an emulator, and the offline ones keep the emulator offline while an app is installed.

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
| Full | `app/google-services.json`, `TW_SERVER_URL`, `TW_PLACES_API_KEY_ANDROID`, `TW_MAIL_TO` | Every gate but the menu hand-offs. The test application sends weather requests to the production server only in the production gates, and never sends a push request |
| Without a server | `TW_MAIL_TO`; `TW_SERVER_URL` removed from the environment and `android/private.properties` | Menu hand-offs: its runner requires a build without a server URL |

| Gate | Command under `android/tools/` | Needs | Emulators |
| --- | --- | --- | --- |
| Upgrade from Cordova 1.1.1: state, push re-registration, token work, entry intents | `upgrade/run-upgrade-test.sh <cordova-1.1.1-debug.apk> [out] [token-a\|token-b]` | Cordova 1.1.1 debug APK signed with the same debug key; `app/google-services.json` | API 36 and API 24 |
| Rollback hand-back to a Cordova fallback and back | `upgrade/run-handback-test.sh <cordova-1.1.1-debug.apk> <fallback-debug.apk> [out]` | The two Cordova APKs; the fallback's `versionCode` above this build's | API 36 |
| Backup and restore, a Cordova backup included; entry links | `backup/run-backup-test.sh <cordova-1.1.1-debug.apk> [out]` | Cordova 1.1.1 debug APK | API 36 and API 24 |
| Notification after the upgrade | `emulator/run-notification-check.sh <cordova-1.1.1-debug.apk> [out]` | Cordova 1.1.1 debug APK; `app/google-services.json`; a Google APIs image | API 36 and API 24 |
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
STORE_APK=<installed-store-release.apk>
BUILD_TOOLS="$ANDROID_HOME/build-tools/36.0.0"
android/tools/release/export_candidate.py "$CANDIDATE" "$BUILD" --private "$PRIVATE" &&
  (cd "$BUILD/android" &&
    tools/release/gradle-release.sh &&           # assembleRelease; refuses sample or missing AdMob IDs
    "$BUILD_TOOLS/zipalign" -c -P 16 4 app/build/outputs/apk/release/app-release-unsigned.apk &&
    "$BUILD_TOOLS/apksigner" sign --ks "$TW_ANDROID_KEYSTORE" --ks-key-alias "$TW_ANDROID_KEY_ALIAS" \
      --out "$APK" app/build/outputs/apk/release/app-release-unsigned.apk &&
    tools/release/check-apk.sh "$APK" "$STORE_APK")
```

The commands are one chain: a failed export, a failed build or a failed signature stops everything after it. Everything after the export runs the export's own tools, those of the candidate.

- **`export_candidate.py`** reads every file of `<SHA>:android` as a blob from Git's object database and writes it with its bytes and mode. No checkout, archive, attribute, line-ending conversion or replaced object is involved. It refuses a tree with a symbolic link or a submodule, then reads the directory back: it must hold exactly the commit's paths, each with the blob's hash and mode. Only then does it write the two private inputs as new files that only the owner can read, in a directory only the owner can enter (a commit that already has a file there is refused), and `CANDIDATE` with the SHA. It refuses a name that is not a full SHA, an unknown commit, a directory or link that exists and a directory inside the checkout before it writes anything, and removes its directory when it fails.
- **`gradle-release.sh`** runs `./gradlew --no-daemon --no-build-cache assembleRelease` in the export. The build reads each private input from the environment before `private.properties`, and JVM option variables can redirect Gradle itself, so the wrapper starts Gradle with a new environment: the variables that say where things are and how text is encoded (`HOME`, `PATH`, `ANDROID_HOME`, `JAVA_HOME`, the locale and a few more, listed in the script) and no other. Nothing else of the shell reaches the build; the wrapper prints the names it kept out. The Gradle user home is the operator's (`GRADLE_USER_HOME` or `~/.gradle`), for the wrapper and dependency caches. An init script there (`init.gradle`, `init.gradle.kts`, `init.d/`) would run in the build, so with one present the build does not start, and the home that was inspected is the one Gradle is given. The keys of the user's `gradle.properties` are printed for the build record, without values; read them before trusting the build.
- Record the candidate SHA, the signed APK's SHA-256 and the time of the build together; the release notes carry the first two. Keep `$BUILD` until the release is closed.
- `apksigner` asks for the keystore and key passwords; do not put them on the command line, in a file of the checkout or in a log. `TW_ANDROID_KEYSTORE` and `TW_ANDROID_KEY_ALIAS` name the existing release keystore and its key. The app is not enrolled in Play App Signing, so this key is the one users' installs are signed with: a different key cannot update them.
- `$OUT`, `$PRIVATE` and `$BUILD` are absolute paths outside the checkout (`$OUT` may be under ignored `reports/`). Keep the signed APK; the uploaded file and the checked file must be the same bytes.
- `$STORE_APK` (an absolute path) is the release users have now: the Cordova 1.1.1 store APK for the first native release.
- `check-apk.sh` verifies both signatures, compares every signer's certificate and the package with the store release, requires a higher `versionCode`, compares `versionName`, `versionCode`, `minSdk` and `targetSdk` with the export's `app/build.gradle.kts`, and refuses a debuggable APK, Google's sample AdMob app ID and a build without the Firebase configuration. It prints the identity lines of the release notes. A `FAIL` line ends the candidate.
- A candidate is exported and built once. For another attempt, export to a new directory.

### 5. Device gate

On a physical phone that has the current store release installed with real state (places, alarms, units, an analytics choice), install the signed APK over it with `adb install -r` and check:

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
2. Upload the signed APK once to internal testing. Read back the version code list of the track before committing the change. Do not touch other tracks.
3. Promote the same file to closed and then open testing after the device gate holds on a tester's install from Play.
4. After each change, edit the pre-release notes: `Store status`, `Attempts`, the time and what was read back.

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

Roll out in stages and hold each stage until its window has passed without a halt:

| Stage | Share of users | Hold at least |
| --- | --- | --- |
| 1 | 5% | 48 hours |
| 2 | 20% | 48 hours |
| 3 | 50% | 48 hours |
| 4 | 100% | — |

Halt the rollout in the Play Console (it stops new installs of the release; installed users keep it) when any of these holds for the new version:

| Signal | Halt when | Read from |
| --- | --- | --- |
| User-perceived crash rate | Above 1.09%, or twice the previous release's rate | Android vitals |
| User-perceived ANR rate | Above 0.47%, or twice the previous release's rate | Android vitals |
| Crash-free users | Below 99.0% | Crashlytics |
| Lost state after the update | One confirmed report of lost places, alarms or settings | Reviews, feedback mail, testers |
| Weather requests failing | Failure share of `weather_fetch` above the previous release's by 2 points | Analytics, CloudFront logs |
| Push registrations | Registrations per updated install clearly below the previous release's, or duplicate registrations | Push server logs |

The crash and ANR limits are Google Play's bad-behavior thresholds ([crashes](https://developer.android.com/google/play/vitals/crash), [ANRs](https://developer.android.com/google/play/vitals/anr); read 2026-11-23). The stages, windows and the other limits are proposed values: AK confirms or changes them when AN-19 starts, and the release notes record the values used.

### 9. Close the release

Set `Rollout status: deployed` in the final notes with the time 100% was reached and the vitals read then. Update the release issue. Keep the signed APK, the private evidence and the previous release's APK: the next release's `check-apk.sh` and device gate start from them.

## Halt and rollback

Google Play cannot move users back to an older version code. After a halt:

1. **Fix forward (default).** Fix on `master`, take the next `PATCH` with a higher `versionCode`, and run this runbook again from step 1. Resume as a new release; the halted release's notes get `Rollout status: failed` and the reason.
2. **Cordova fallback (last resort).** When the native app cannot be fixed quickly, ship a Cordova build with a higher `versionCode` that takes the state back ([hand-back](../../android/README.md#rollback-hand-back-to-a-cordova-build-an-17)). It needs its own hand-back gate run, the release signing and AK's decision.

Record the halt time, the share reached, the signal and its value in the notes before starting either.
