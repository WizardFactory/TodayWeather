# Private inputs and their S3 backup

Private inputs are the build and release files that stay out of Git: ad unit IDs, server URLs, API keys, Firebase configuration and signing material. This page says where they live, how they are backed up and when to check the backup. It holds names and paths only; bucket names, values and recovery paths stay in the private files themselves.

## Where they live

| Input | Local location on the release Mac | Described in |
| --- | --- | --- |
| Native Android build inputs (`private.properties`) | `~/.config/todayweather/android/` | [Android private inputs](../../android/README.md#private-inputs) |
| Native iOS build inputs (`Private.xcconfig`, `GoogleService-Info.plist`) | `~/.config/todayweather/ios/` | [iOS private inputs](../../ios/README.md#private-inputs) |
| Release files of the store builds (Android keystore, Firebase files, ad client configuration) | The directory named by `TW_RELEASE_LOCAL_DIR` in the release workspace's `client/.env` | [Cordova store release](cordova-store-release.md) |
| iOS distribution signing | Keychain, plus the signing backup | [Cordova store release](cordova-store-release.md) |
| GTM access files | `~/.config/todayweather/gtm/` | [GTM sources](../../gtm/sources.md) |

Directories are mode 0700 and files 0600. A worktree only ever holds a copy for one build; remove it after the build.

## The backup

The private release bucket is the one named by `TW_RELEASE_S3_PREFIX` in the release workspace's `client/.env`. That file also names the AWS profile and region. Backups are snapshots under `<TW_RELEASE_S3_PREFIX>release-backups/<UTC time>-<label>/`. Each snapshot holds:

- the files, at their path relative to `~/.config/todayweather/`;
- `manifest.json`: schema 1, with each file's local path, object path, size and SHA-256;
- `RESTORE.md`: how to download, check and put the files back;
- `COMPLETE`: the SHA-256 of `manifest.json`, written last.

Every object is written with server-side encryption and a conditional create, so a snapshot never replaces an existing object. The tool reads every object back before it writes `COMPLETE`. A snapshot is complete only when `COMPLETE` exists and holds the hash of its `manifest.json`. Earlier snapshots stay as they are; the newest complete snapshot of a label is the current one. Snapshots taken by hand have no `COMPLETE`, so the tool does not consider them.

| Label | Contents | Made by |
| --- | --- | --- |
| `native-inputs` | Android `android/private.properties` and `release/tw-google-services.json` (the Android build's `google-services.json`), iOS `ios/Private.xcconfig` and `ios/GoogleService-Info.plist` | `scripts/private-inputs.py` |
| `gtm-team-installations` | `gtm/team-installations.txt`, the private team-installation list of the analytics queries ([team installations](monetization.md#team-installations-3228)) | `scripts/private-inputs.py snapshot --label gtm-team-installations gtm/team-installations.txt` |
| none (time only) | Store-build release files | Manual capture on 2026-10-01 |
| `ios-signing` | iOS distribution certificate, key and provisioning profile | Manual capture on 2026-10-02 |

The native Android build's `google-services.json` is the store build's Firebase file, `release/tw-google-services.json` under `~/.config/todayweather/` (the directory `TW_RELEASE_LOCAL_DIR` names). The tool always includes a label's files, even when you name others.

## Rule: back up every change in the same task

When you add or change a private input, make a new snapshot before the task is reported done:

```sh
TW_RELEASE_ENV='<release workspace>/client/.env' python3 scripts/private-inputs.py snapshot --label native-inputs
```

The command reads each file once, without following links, and uploads that copy. A path that is a link or crosses one is refused; name the real file. It writes the files, `RESTORE.md` and `manifest.json`, reads each back, and only then writes `COMPLETE`. It prints only the snapshot's run ID. On a failure it prints the AWS error code without the AWS message, because the message can name accounts and resources. To back up other files under `~/.config/todayweather/`, name them and use another label.

## Check before a release

Before building a native release, compare the local inputs with the newest snapshot:

```sh
TW_RELEASE_ENV='<release workspace>/client/.env' python3 scripts/private-inputs.py verify --label native-inputs
```

The exit codes:

- `0`: every file matches.
- `1`: a file differs, is missing, or is required by the label but not in the snapshot. If the local change is intended, it was never backed up: make a snapshot. If it is not intended, restore the file from the snapshot.
- `2`: there is no complete snapshot, the configuration or the manifest cannot be read, or AWS access failed.

The tool never prints a file's contents.

## Restore

Follow the `RESTORE.md` of the snapshot: download the prefix into a private folder, check each SHA-256 against `manifest.json`, then copy each file to its local location with the modes above. AWS credentials are not part of any snapshot; recover them through an authorized AWS identity.
