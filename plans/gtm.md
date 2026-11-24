# TodayWeather GTM folder plan (`gtm/`)

Date: 2026-11-23 (KST). Status: **decisions D1 to D4 set by AK on 2026-11-23; G-00 done; G-01 and G-07 delivered by the first pull request. On 2026-11-24 AK moved the collectors and the brief (G-02 to G-06) with the schedule (G-08) to the Hermes workspace; this repository supplies the access check `gtm/tools/check-access.mjs`.** Tracking issue: [#3145](https://github.com/WizardFactory/TodayWeather/issues/3145). Sources: [intent](../intent/gtm.md), [specification](../specs/gtm.md), [user scenarios for the first task](gtm.scenarios.json). Current locations and access state are maintained in [gtm/sources.md](../gtm/sources.md); the tables below record the planning-time state.

## Outcome

One top-level `gtm/` folder holds the maintained go-to-market information for TodayWeather. A daily question (per-store downloads, ad revenue, review and rating changes) is answered from stored records, and every figure carries the day it covers and its source.

## Decisions

| ID | Decision | State |
| --- | --- | --- |
| D1 | Where daily figures and review bodies are stored, given the public repository. | **AK, 2026-11-23: Amazon S3 first.** Recommended form below. |
| D2 | What "key information" covers. | **AK, 2026-11-23: as recommended below, with locations recorded carefully** ([gtm/sources.md](../gtm/sources.md)). |
| D3 | Who supplies the missing access. | **AK, 2026-11-23: done directly through Ego Lite.** See "Access state". |
| D4 | Where the daily run executes. | **AK, 2026-11-23: Hermes on the Linux host `contabo.flying`, set up from another workspace.** Recommended form below as input for that workspace. |

### D1 recommendation: a dedicated private bucket

Approved by AK on 2026-11-23 and created as `todayweather-gtm` with the collector user `tw-gtm-collector` (G-00).

- Use a new bucket for GTM data only, with all four Block Public Access settings, versioning, default SSE-S3 encryption and a TLS-only bucket policy ([AWS security practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)).
- Do not reuse `tw-config`. On 2026-11-23 it held signing keys and certificates, had no versioning and no bucket-level public access block. A collector host must not hold credentials that reach those objects.
- Give the Hermes host its own IAM user limited to this bucket. The existing account-wide credentials stay off that host.
- Keys are deterministic, one object per source and covered day: `source=<name>/dt=YYYY-MM-DD/data.jsonl` ([partition convention](https://docs.aws.amazon.com/athena/latest/ug/partitions.html)). A re-run overwrites the same key; versioning keeps earlier copies. This fits sources that restate figures (AdMob for about 48 hours, Play for days).
- Review bodies and briefs use the same bucket under `reviews/` and `briefs/`.
- Public `gtm/` keeps definitions, tools, listing and research notes. AdMob statistics other than payment totals stay private: the [AdSense terms, section 11](https://www.gstatic.com/adsense/tc/2022-v1/google_usa/en.html) treat performance statistics as confidential and allow disclosing gross payments. That these terms govern the AdMob account is inferred from the [AdMob terms page](https://developers.google.com/admob/terms).

### D2 recommendation: scope in two steps

Public examples of a full GTM hub for an ad-funded app were not found; the closest are agent skill packs for store optimization ([aso-skills](https://github.com/Eronred/aso-skills), [marketingskills](https://github.com/coreyhaines31/marketingskills)) and one growth agent reading the same three sources ([indie-growth-agent](https://github.com/yamazakisayuri/indie-growth-agent)). Their recurring parts are a product context file every agent reads first, metric definitions, listing and keyword notes, review triage, and a release and experiment log. The metric sets below are this plan's synthesis.

1. **First step (this plan):** a product context file; daily first-time downloads per store, estimated ad earnings, impressions, requests, match rate, rating and rating count, new and changed reviews; listing state; a dated GTM log.
2. **Later step (not planned here):** weekly uninstalls (same Play files), crash-free rate, active users and retention from the GA4 export in the [monetization document](../docs/operations/monetization.md), store conversion, competitor and keyword tracking. Analytics consent is off by default, so GA4 undercounts users.

### D4 recommendation: a script-only Hermes job

- Use `hermes cron create` with `--no-agent --script`, so the run is a deterministic script without a model call. Its standard output is delivered as written, empty output is silent, and a non-zero exit raises an error alert ([script-only cron](https://hermes-agent.nousresearch.com/docs/guides/cron-script-only)).
- Hermes runs only bash or Python scripts from `~/.hermes/scripts/`. A small wrapper there syncs the bucket to a local cache, runs the collectors and the brief from a checkout of this repository, and syncs back. S3 stays the record; the host directory is a cache.
- Variable names go under `terminal.env_passthrough` and values in the Hermes profile `.env`; key files sit in a mode-700 directory on the host ([cron reference](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)).
- Run once at 09:00 KST. Each run re-collects recent days: AdMob the last three days, the Apple report for the latest published Pacific day, and the Play files for the current and previous month.
- The scheduler runs only while the Hermes gateway is up. `hermes cron runs` and `hermes cron incidents` show failures.
- `contabo.flying` did not resolve from the development Mac on 2026-11-23, so the host's Node, AWS CLI and Hermes versions are unverified. G-08 starts with that inspection.

## Access state (2026-11-23)

Private files are on the release Mac under `~/.config/todayweather/` (mode 600, outside Git). `gtm/gtm.env` there holds the non-secret identifiers.

| Source | State | Evidence |
| --- | --- | --- |
| App Store reviews | Ready, existing key. | `GET /v1/apps/1041700694/customerReviews` returned 200. |
| Google Play reviews | Ready, existing service account. | `reviews.list` returned 200. It lists only reviews created or changed in the last week. |
| Public ratings | Ready, no key. | Apple lookup API returns `averageUserRating` and `userRatingCount` per storefront. |
| AdMob earnings | **Ready.** AdMob API enabled in the TodayWeather Google Cloud project; desktop OAuth client "TodayWeather GTM AdMob reports"; consent for `admob.readonly` by the account owner; refresh token stored privately. | A network report for 2026-11-20 to 2026-11-22 returned rows per day, app and platform. The account reports in Asia/Seoul and USD. The consent screen is "In production", so the token is not subject to the seven-day testing expiry. |
| Google Play installs and ratings files | **Granted, not yet effective (still 403 about 80 minutes after saving).** Bucket URI recorded as `TW_PLAY_REPORT_BUCKET`. The service account now has the account-level, read-only "view app information and download bulk reports" permission, which also ticked the read-only app quality permission. | Listing `stats/installs/` still returned 403 about 40 minutes after saving. Recheck before G-04; the saved state was read back in Play Console. |
| App Store downloads | **Ready.** The release key is refused (403), so the account holder's session issued the team key `tw_gtm_sales_reports` with the "Sales and Reports" role. Vendor number recorded as `TW_ASC_VENDOR_NUMBER`. | Daily summaries for 2026-11-20 and 2026-11-21 downloaded with the new key; 2026-11-22 was not yet published at 11:00 KST. The report includes another app of the vendor, so collectors filter by Apple identifier. The same key reads customer reviews. |
| App Store analytics reports | Not planned. | `analyticsReportRequests` returned 403 with the existing key. |

## Source timing

| Metric | Source | Day boundary | Published |
| --- | --- | --- | --- |
| iOS first-time downloads | Sales and Trends daily summary, product types `1`, `1F`, `1T`, `F1` ([identifiers](https://developer.apple.com/help/app-store-connect/reference/product-type-identifiers)) | Pacific Time | The following day, generally by 08:00 PT ([availability](https://developer.apple.com/help/app-store-connect/reference/sales-and-trends-reports-availability)). The `INSTALLS` report type is deprecated; use `SALES`. |
| Android installs and ratings | Monthly CSV files in the Play bucket, UTF-16 ([export](https://support.google.com/googleplay/android-developer/answer/6135870)) | Pacific Time, inferred | Within three to seven days. Column names must be confirmed on a real file. |
| Ad earnings | AdMob `networkReport:generate` with `DATE`, `APP`, `PLATFORM` | Account timezone observed as Asia/Seoul; confirm against the console | Next morning as an estimate; changes for about 48 hours ([estimates](https://support.google.com/admob/answer/10529727)). |
| Ratings | Public lookup and listing | Collection time | Immediate. |
| Reviews | Store APIs | Review timestamp | Immediate. |

The brief therefore reports the **latest complete day per source**, not one common "yesterday".

## Folder layout

```text
gtm/
  README.md            index, how to answer the daily question, where the data is
  product.md           product and audience context that agents read first
  metrics.md           metric dictionary: definition, source, day boundary, delay, currency
  sources.md           access inventory: API, role, variable names, key file convention, last verified date
  log.md               dated GTM events: releases, listing changes, experiments, incidents
  listing/README.md    listing state per store and language, keyword and screenshot notes
  research/README.md   index of existing research, focus cities and landing documents
  tools/               collectors, brief composer, Hermes wrapper and tests
  .env.example         variable names and file locations only
```

`gtm/` links to existing material and does not move it: [store listing texts and screenshots](../client/fastlane/metadata), the [store release runbook](../docs/operations/cordova-store-release.md), the [policy and disclosure evidence](../docs/operations/store-policy-evidence.md), the [store voice research](../docs/evidence/research/landing-store-voice-2026-11-21.md), the [market comparison](../docs/evidence/research/mobile-markets-2026-11-20/README.md), the [focus cities](../docs/operations/mobile-focus-cities.md) and the [landing plan](landing.md).

Collectors are dependency-free Node scripts with `node:test` tests, following `scripts/verification/*.test.mjs`. They reuse the existing variable names (`TW_ASC_KEY_ID`, `TW_ASC_ISSUER_ID`, `TW_ASC_KEY_FILE`, `TW_PLAY_JSON_KEY`) and add `TW_GTM_DATA_DIR`, `TW_GTM_S3_URI`, `TW_ASC_VENDOR_NUMBER`, `TW_PLAY_REPORT_BUCKET`, `TW_ADMOB_PUBLISHER_ID` and `TW_ADMOB_OAUTH_FILE`. Tools have no dry-run or mock mode; tests use in-test doubles, and each source is verified once against the real service.

## Record contract

The [specification](../specs/gtm.md#records) owns the record and privacy rules.

## Tasks and PR boundaries

Each task with repository changes is one PR against `master`. Private data and identifiers never enter these PRs.

| ID | Outcome | Owned write scope | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| G-00 | **Done 2026-11-23.** The private bucket and the collector's IAM user exist. | AWS only; `sources.md` records names | AK's approval, 2026-11-23 | The bucket has public access blocked, versioning and a TLS-only policy. The collector's credentials read and write this bucket and are refused on `tw-config`. |
| G-01 | The folder exists and repository rules know it. | `gtm/README.md`, `product.md`, `metrics.md`, `sources.md`, `log.md`, `.env.example`; `AGENTS.md` repository map; `docs/development/artifact-retention.md`; `scripts/check-artifact-policy.py` and its test; `.gitignore` | D2 | The checker link-checks `gtm/` and rejects a staged data file. A new agent finds the data location and every source's access requirement from `gtm/README.md`. |
| G-02 | Daily public rating snapshots per store and storefront (KR, US, JP first). | `gtm/tools/store-public.*` | G-01 | Two runs on different days give a rating and rating-count change per store. A same-day re-run changes nothing. A parse failure records "not collected". |
| G-03 | New and changed reviews from both stores, with the unanswered list. | `gtm/tools/reviews.*` | G-01 | A real run stores current reviews from both APIs. A second run reports only new or edited reviews. No reviewer name is stored. |
| G-04 | Daily downloads per store. | `gtm/tools/downloads.*`, `metrics.md` | G-01; the Sales-role key; effective Play bucket access | Real reports from both stores are parsed into first-time downloads per day and country. A refused request names the missing role. |
| G-05 | Daily ad earnings per app and platform. | `gtm/tools/ad-revenue.*`, `sources.md` | G-01 | A real report is stored with currency and timezone; the last three days are re-collected. A revoked token is recorded as not collected. |
| G-06 | The daily brief in Korean on standard output and under `briefs/`. | `gtm/tools/brief.*`, `gtm/README.md` | G-02, G-03; extended by G-04 and G-05 | The brief lists each source's latest complete day, the change against the previous day and the seven-day average, new reviews, and every missing source with its reason. |
| G-07 | Listing state and research index. | `gtm/listing/README.md`, `gtm/research/README.md`, `log.md` | G-01 | Every link resolves under the artifact checker. The listing page states what is live and what is pending review per store, with the date observed. |
| G-08 | The daily run on Hermes. **Owned by another workspace (AK, 2026-11-23);** this plan supplies the tools and the host requirements in `sources.md`. | Host changes; wrapper location decided there | G-00, G-06; host access | After host inspection, one manual `hermes cron run` stores records in S3 and delivers the brief; a forced failure produces an error alert. The schedule is enabled at 09:00 KST. |

- **Ready frontier:** G-02, G-03 and G-05 once the first pull request (G-01 and G-07, task `gtm-g01`) is merged.
- **Critical path:** G-01 → G-02, G-03, G-05 → G-06 → G-08.
- **Parallel after G-01:** G-02, G-03, G-05 and G-07 have disjoint write scopes. G-04 waits for the key and the Play access.

## Open points

1. App Store analytics reports need an Admin key to create the ongoing report request once; the account holder issues it.
2. Collectors, the brief and the schedule are owned by the Hermes workspace (AK, 2026-11-24).

## User scenarios

1. **Daily question.** AK asks for yesterday's downloads, ad revenue and review or rating changes. The agent reads `gtm/README.md`, reads the latest brief and records, and answers with each figure's covered day. A source without data is named with its reason.
2. **Scheduled run.** The 09:00 KST Hermes job collects every configured source, stores records in S3 and delivers the brief. Running it again the same day changes nothing.
3. **Access failure.** The AdMob token is revoked. Ad earnings are recorded as not collected with the reason; the other sources are stored and reported, and the job still delivers the brief.
4. **Explaining a change.** Downloads rise after a listing update. The brief's day matches an entry in `log.md`, and `listing/README.md` shows which listing was live.
5. **Fresh worktree.** An agent in a new worktree without data access is told by the tool which variables and location are missing, and collects nothing partial.

## Verification

- `node --test gtm/tools/*.test.mjs` for parsing, idempotent storage, change detection and failure records.
- One real call per source and method before a task is reported complete, with status and row counts recorded; no secret, review body or figure in logs or PRs.
- `python3 scripts/check-artifact-policy.py --staged` and its test suite for the link and path rules.

## Outside this plan

Store writes (review replies, listing edits, releases), paid acquisition, new accounts and the later-step metrics under D2.
