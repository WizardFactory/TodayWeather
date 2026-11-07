# AdMob eligibility remediation specification

Inputs: [intent](../intent/issue-2871.md) and the [dated evidence](../docs/evidence/tasks/issue-2871/README.md).

## Behaviour

- **Location permission (AC3).** `Util.classifyLocationPermission(status)` maps a
  `cordova.plugins.diagnostic` 7.x status to one of three classes:
  - `granted`: `GRANTED`, `GRANTED_WHEN_IN_USE`.
  - `requestable`: `NOT_REQUESTED`, and Android `DENIED_ONCE`.
  - `denied`: every other value.

  The start, search and tab location flows use this class. When the user denies the
  system prompt, the flow rejects with the existing denied message instead of
  waiting for a reload, and `requestable` shows the prompt again. A status lookup
  error or prompt error shows the failure message, so no path can leave a loading
  state running or loop silently. When permission is granted but location services
  are off, the turn-on message is shown. The popup buttons are unchanged.
- **Ads SDK start (AC3).** On Android, the emi adapter re-initializes after the
  `on.consent.status.not_required`/`obtained` or `on.personalization.state` events rather than from the `initialize` callback; on iOS it
  still uses that callback. Only one retry is allowed, and the consent gates and the
  test-unit UMP fallback are unchanged.
- **Load-error code (AC2).** On `on.banner.failed.load`, the event's integer `code`
  (0..999) is taken from the fields that Cordova copied onto the event.
  - Always: write a JSON console line with that code, or `unavailable` when there is none.
  - Only when there is a code: track `ad_load_error {ad_format, error_code}` through
    the consent-gated Monetization allowlist. `ad_lifecycle failed` is retained.
- **app-ads.txt (AC1).** `node client/scripts/make-app-ads.mjs` prints
  `google.com, pub-<id>, DIRECT, f08c47fec0942fa0`. It derives the line from both
  release app IDs and rejects missing, malformed, sample or mixed-publisher IDs.
  The output is uploaded only as `todayweather.ai/app-ads.txt`.
- **Documentation (AC4, AC5).** The store runbook, monetization runbook, event
  dictionary, platform reference and privacy worksheet record the procedure, the
  AK steps and the identifier facts.

## Not changed

Banner placement, the preload timing, the iOS `npa=1` hook, the Android `ADD_AD_ID`
variable (it would have no effect), the TodayAir and native widgets, the server, and
the store listings.

## Compatibility and rollback

These are client-only JavaScript changes that ship with the next store release.
Older installs keep their behaviour. To roll back, revert the commits and restore
the previous S3 object version for `app-ads.txt`.
