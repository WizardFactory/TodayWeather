# AirKorea: rotate to the next key on daily quota
Owner: AK; builder: Claude (Anthropic). Task ID: `issue-2745`. Status: authorized through pre-merge.
Issue: [#2745](https://github.com/WizardFactory/TodayWeather/issues/2745). Follows [issue-2636-r2](issue-2636-r2.md) (PR #2737).

## Problem
On 2026-10-14 (KST evening) a live check found the third `AIRKOREA_SECRET_KEYS` entry, which collection selects first, at its daily limit while the first and second keys answered. #2737 deliberately stops on quota, so collection failed although two keys had quota left. server2 S13b ported the same rule.

## Decision
AK, 2026-10-14: when an AirKorea key hits its quota (HTTP 429, gateway code 22 and the equivalent quota result codes), move on to the next configured key instead of stopping. Apply this to legacy and server2 as two separate PRs. This reverses the #2737 / issue-2636 "no rotation on quota" rule for AirKorea only.

## Outcome and acceptance
- **AC1** A quota answer on the current key marks it exhausted until the end of the current KST day and the same request continues with the next key in the #2737 order. An exhausted key costs no HTTP call until its KST day ends.
- **AC2** When no usable key remains and at least one is exhausted, the request fails as quota (`QUOTA_EXHAUSTED`); an all-credential failure stays `NO_VALID_KEY`.
- **AC3** Credential rejection, transport/timeout/5xx retry rules and the remembered working key are unchanged. A key never receives a second request for the same page after a quota or credential rejection. Key text never appears in logs or errors.
- **AC4** Docs describe the new rule: collection architecture, AirKorea runbook, data.go.kr key procedure, provider catalog note and the `weather-collection` diagram.

## Scope and limits
Legacy PR: `server/lib/airkoreaObservation.js`, `server/lib/kecoRequester.js`, the AirKorea offline test, the docs above and these records. The server2 change is a separate PR (S13c). Out of scope: KMA/DONGNAE key policies, code 23 (per-second limit), persistent exhaustion across restarts, configuration, deployment. No merge or production deployment.

## Risks
- Rotation spends the other keys' daily quota earlier; with three keys the daily AirKorea capacity is the sum of the three quotas instead of one.
- Exhaustion memory is per process; after a restart each exhausted key costs one more quota answer per request that reaches it before the first answer is recorded.
