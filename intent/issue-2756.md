# Restore AirKorea image hourly forecasts (#2756)

The gather worker rejects current 820×820 GIFs against its 820×830 private configuration, leaving the image hourly store empty despite current original forecasts. Restore a characterized decoder in legacy `server/` without changing KAQ, client source selection or production state.

Authority: AK requested issue creation and implementation on 2026-10-15. Endpoint is local code and verification; deployment, restart, production writes and PR integration are excluded. [Issue](https://github.com/WizardFactory/TodayWeather/issues/2756).

Acceptance: supported PM10/PM2.5 GIFs produce finite nonnegative, correctly dated station forecasts through isolated storage/readback; malformed or unsupported layouts produce no writes; explicit configuration is respected; current-image replay evidence, calibration limits and rollout/rollback steps are recorded. See [specification](../specs/issue-2756.md) and [plan](../plans/issue-2756.md).

## 2026-10-15 pre-merge amendment

AK asked whether pre-merge was complete, received the explicit list of outstanding
commit/push/PR/CI/independent-review steps, and instructed "진행" (proceed).
This supersedes the local endpoint above: complete those scoped steps and eligible
review/correction using the already configured GitHub and Paseo review accounts.
Allowed materials are this task's code, tests and sanitized evidence. No secrets,
new accounts, permission changes, merge/auto-merge/queue, restart, production write
or deployment are authorized. Required review uses medium effort; the installed
SDLC policy additionally attempts Grok 4.7 high and Gemini 3.8 high as optional,
isolated review-only contexts. No source edits by reviewers are authorized.

Stable criteria:
- AC1: characterized current GIFs produce finite nonnegative, correctly dated
  station forecasts through isolated storage/readback.
- AC2: unsupported/malformed input produces no new forecast upserts; explicit
  calibration is honored and existing AirKorea behavior remains compatible.
- AC3: verification, calibration limits and rollout/rollback are documented, and
  the unmerged PR has passing applicable CI and eligible independent review with
  no unresolved Required findings. Local success does not imply production recovery.
