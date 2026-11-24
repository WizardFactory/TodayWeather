# TodayWeather GTM folder (`gtm/`)

Requested by AK on 2026-11-23. Tracking issue: [#3145](https://github.com/WizardFactory/TodayWeather/issues/3145). See the [specification](../specs/gtm.md) and the [plan](../plans/gtm.md).

## Problem and outcome

Go-to-market information for TodayWeather was spread over release notes, research documents and private consoles, and a daily question (per-store downloads, ad earnings, rating and review changes) could not be answered from stored records. The outcome is one `gtm/` folder that holds the maintained information and states where every record and credential is, plus stored daily records from which the question is answered.

## Decisions by AK (2026-11-23)

1. Create a `gtm` folder and manage the key information there; plan first.
2. Private daily figures go to Amazon S3. The repository is public.
3. Missing report access is obtained directly by the agent through Ego Lite. Done the same day: AdMob API and read-only consent, the App Store key with the "Sales and Reports" role, the Google Play read-only bulk report permission.
4. The daily run executes on the Hermes host, set up from another workspace.
5. Scope follows the recommended first step, and locations must be recorded carefully.
6. The dedicated bucket and its collector user are approved; the name was left to the agent (`todayweather-gtm`).
7. A pull request is to be opened for the folder.

## Scope

- In scope: the `gtm/` documents, the artifact-policy wiring and the private bucket. Collectors and the brief belong to the Hermes workspace (amendment of 2026-11-24).
- Out of scope: store writes (review replies, listing edits, releases), paid acquisition, new accounts, the Hermes host setup, and the later metrics listed in the specification.

## Authority and endpoint

- First pull request (task `gtm-g01`): endpoint `pr`. It adds documents and the checker rule; it changes no account, store or production state. Merge is AK's decision.
- Collectors, the brief and the schedule are built in the Hermes workspace (amendment of 2026-11-24).
- Credentials, identifiers, figures and review bodies never enter Git, issues or pull requests.

## Acceptance criteria for `gtm-g01`

- **AC1:** From `gtm/README.md` a reader reaches the data location and every source's access requirement, and every link in `gtm/` resolves.
- **AC2:** The artifact checker link-checks Markdown and HTML under `gtm/` and rejects a tracked file under `gtm/data/`.
- **AC3:** The change contains no credential, account identifier, download count, ad statistic or review body.
- **AC4:** `AGENTS.md` and the artifact retention document point to `gtm/` and state that private records stay outside Git.

Criteria for the later tasks are the completion criteria of #3145.

## Amendment 2026-11-24

AK decided after the attribution audit:

- The pull request is completed now. Collectors, the brief and the schedule are built on the Hermes host from another workspace ("셋업만": this repository supplies the access, locations and documents that work needs, not tools).
- An App Store Connect Admin key is issued so the ongoing analytics report request can be created.
- Campaign values in store links, Android code shrinking, analytics on by default with the matching privacy text (#2660), the landing analytics tag and a new advertising campaign proceed as separate tasks. Store country availability is handled in its own issue.
