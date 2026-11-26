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
- `RESTORE.md`: how to download, check and put the files back.

Every object is written with server-side encryption and a conditional create, so a snapshot never replaces an existing object. A snapshot is complete only when its `manifest.json` exists. The tool writes the manifest last, after reading every file back. Earlier snapshots stay as they are; the newest complete snapshot of a label is the current one.

| Label | Contents | Made by |
| --- | --- | --- |
| `native-inputs` | Android `private.properties`, iOS `Private.xcconfig` and iOS `GoogleService-Info.plist` | `scripts/private-inputs.py` |
| none (time only) | Store-build release files | Manual capture on 2026-10-01 |
| `ios-signing` | iOS distribution certificate, key and provisioning profile | Manual capture on 2026-10-02 |

The native Android build's `google-services.json` is the release workspace's Firebase file. The store-build backup holds it.

## Rule: back up every change in the same task

When you add or change a private input, make a new snapshot before the task is reported done:

```sh
TW_RELEASE_ENV=<release workspace>/client/.env python3 scripts/private-inputs.py snapshot --label native-inputs
```

The command uploads the default `native-inputs` files and reads each object back. It prints only the snapshot's run ID. To back up other files under `~/.config/todayweather/`, name them and use another label.

## Check before a release

Before building a native release, compare the local inputs with the newest snapshot:

```sh
TW_RELEASE_ENV=<release workspace>/client/.env python3 scripts/private-inputs.py verify --label native-inputs
```

The exit codes:

- `0`: every file matches.
- `1`: a file differs or is missing. If the local change is intended, it was never backed up: make a snapshot. If it is not intended, restore the file from the snapshot.
- `2`: there is no snapshot, or the configuration or AWS access failed.

The tool never prints a file's contents.

## Restore

Follow the `RESTORE.md` of the snapshot: download the prefix into a private folder, check each SHA-256 against `manifest.json`, then copy each file to its local location with the modes above. AWS credentials are not part of any snapshot; recover them through an authorized AWS identity.
