# Sources and locations

Last verified: 2026-11-23 (KST). This page records where GTM records, credentials and consoles are. It holds names and paths only. Secret values and account identifiers are in the private files listed below.

## Where things are

| What | Location |
| --- | --- |
| Maintained GTM documents and tools | `gtm/` in this repository |
| Daily records, review bodies and briefs | Amazon S3 bucket `todayweather-gtm`, region `ap-northeast-2` (private) |
| Local cache of those records | `gtm/data/` in a checkout (ignored by Git), or the directory in `TW_GTM_DATA_DIR`. A cache only; the bucket is the record. |
| GTM access files | `$HOME/.config/todayweather/gtm/` on the release Mac, directory mode 700, files mode 600 |
| Index of those files, with the exact identifiers | `$HOME/.config/todayweather/gtm/README.md` (private) |
| Existing store keys from releases | `$HOME/.config/todayweather/release/`, referenced by `client/fastlane/.env` in the release workspace. See the [release runbook](../docs/operations/cordova-store-release.md#api-authentication-and-local-setup). |
| Listing texts and screenshots | [`client/fastlane/metadata/`](../client/fastlane/metadata) |
| Variable names for tools | [`.env.example`](.env.example) |

### Files in the GTM access directory

| File | Content | Used for |
| --- | --- | --- |
| `gtm.env` | Variable assignments: identifiers and paths to the files below. No private key material. | Loaded by every tool |
| `aws-credentials` | Access key of the IAM user `tw-gtm-collector`, profile `tw-gtm` | Reading and writing the bucket |
| `AuthKey_<key-id>.p8` | App Store Connect team key `tw_gtm_sales_reports`, role "Sales and Reports" | Sales reports and customer reviews |
| `admob-oauth-client.json` | OAuth desktop client "TodayWeather GTM AdMob reports" | Refreshing the AdMob token |
| `admob-oauth.json` | Refresh token with scope `admob.readonly` | AdMob network reports |

The Google Play service account key is the release key file named by `TW_PLAY_JSON_KEY`; it is not copied into the GTM directory.

## Private bucket

| Setting | Value |
| --- | --- |
| Bucket | `todayweather-gtm`, created 2026-11-23 in the TodayWeather AWS account |
| Protection | All four Block Public Access settings, versioning enabled, SSE-S3 default encryption, bucket policy denying requests without TLS |
| Collector identity | IAM user `tw-gtm-collector` with one inline policy `tw-gtm-bucket`: list the bucket, get and put its objects. No delete, no other bucket, no IAM. |
| Administration | The account's existing administrator profile, described in [AWS access](../docs/architecture/ec2-access.md#aws-cli-access) |

Verified on 2026-11-23 with the collector's credentials: put, list and get succeeded in `todayweather-gtm`; listing another bucket, deleting an object and listing IAM users were refused. The bucket was left empty.

### Key layout

```text
source=<name>/dt=YYYY-MM-DD/data.jsonl    one object per source and covered day
reviews/store=<store>/<review-id>.json    one object per review, replaced when the review changes
briefs/dt=YYYY-MM-DD/brief.md             the brief produced by the run of that day
```

Source names: `appstore-sales`, `play-installs`, `play-ratings`, `admob-network`, `store-public`. A re-run writes the same key; versioning keeps the earlier copy. The collector cannot delete, so removal is an administrator action.

## Access per source

| Source | Credential and variables | Permission it relies on | State on 2026-11-23 |
| --- | --- | --- | --- |
| App Store sales reports | `TW_ASC_SALES_KEY_ID`, `TW_ASC_SALES_KEY_FILE`, `TW_ASC_ISSUER_ID`, `TW_ASC_VENDOR_NUMBER` | Team key with the "Sales and Reports" role | Works. Daily summaries for 2026-11-20 and 2026-11-21 downloaded; 2026-11-22 was not yet published at 11:00 KST. |
| App Store customer reviews | Same key | Same role | Works (HTTP 200). The release key also works. |
| App Store analytics reports | None | Needs a higher role | Not planned. The release key is refused. |
| Google Play reviews | `TW_PLAY_JSON_KEY` | App-level access of the release service account | Works (HTTP 200). Lists only reviews created or changed in the last week. |
| Google Play installs and ratings files | `TW_PLAY_JSON_KEY`, `TW_PLAY_REPORT_BUCKET` | Account-level "View app information and download bulk reports (read-only)" for the service account | **Not working yet.** The permission was saved and read back, but listing the bucket still returned 403 at 12:14 KST, about two and a half hours later. Recheck; if it persists after a day, inspect the grant again. |
| AdMob network report | `TW_ADMOB_OAUTH_FILE`, `TW_ADMOB_PUBLISHER_ID` | AdMob API enabled in the TodayWeather Google Cloud project; user consent for `admob.readonly`. Service accounts are not accepted. | Works. A report for 2026-11-20 to 2026-11-22 returned rows per day, app and platform. |
| Public ratings | None | None | Works for the Korean App Store storefront. The US and Japan lookups returned no result. |

### Where each credential is managed

| Credential | Console page | Who can change it |
| --- | --- | --- |
| App Store Connect team keys | Users and Access > Integrations > App Store Connect API | The account holder. An Admin user was refused on this page on 2026-11-23. |
| App Store vendor number | Sales and Trends > Reports | Shown to users with report access |
| Google Play service account permissions | Play Console > Users and permissions > the service account > Account permissions | Play Console admin |
| Google Play report bucket URI | Play Console > Download reports > Statistics > copy Cloud Storage URI | Play Console users with report access |
| AdMob API and OAuth client | Google Cloud console of the TodayWeather project: APIs and Services, and Google Auth Platform > Clients | Project owner |
| AdMob consent | Google Account > Third-party connections of the AdMob account's user | That user. Removing the connection revokes the token. |
| Bucket and collector user | AWS S3 and IAM | Account administrator |

The OAuth consent screen is in production, so the refresh token is not subject to the seven-day expiry of testing apps. A team App Store key applies to every app of the team, and the vendor's sales report includes other apps of the vendor.

## What stays private

- Vendor number, AdMob publisher ID, the Play report bucket ID, key IDs with their files, tokens and access keys.
- Download counts, ad statistics and review bodies. The [AdSense terms, section 11](https://www.gstatic.com/adsense/tc/2022-v1/google_usa/en.html) treat performance statistics as confidential and allow disclosing gross payment amounts. That these terms govern the AdMob account is inferred from the [AdMob terms page](https://developers.google.com/admob/terms).
- Reviewer names are not stored at all.

## Running on another host

The scheduled run is set up on the Hermes host from another workspace. That host needs: a checkout of this repository, Node 22.12 or later, the AWS CLI, and copies of `gtm.env`, `aws-credentials`, the App Store key file, both AdMob files and the Google Play service account key, with the paths in `gtm.env` rewritten for that host. It does not need the release signing material or the administrator AWS profile.
