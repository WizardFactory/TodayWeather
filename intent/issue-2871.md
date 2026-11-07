# Issue 2871: restore AdMob eligibility for TodayWeather

Owner: AK. Builder: Anthropic / Claude Code root. Source: [issue #2871](https://github.com/WizardFactory/TodayWeather/issues/2871).
Endpoint: pre-merge (verified PR readiness, no merge), selected by AK on 2026-11-07.

## Decisions (AK, 2026-11-07)

- Developer website for both stores and the app-ads.txt host: `https://todayweather.ai`,
  the existing landing S3/CloudFront that already serves the store policy pages.
- The builder may upload `app-ads.txt` to that landing bucket using the existing
  single-object procedure. It derives the publisher ID from the release `client.env`
  backup in the release S3 bucket and must not print or commit the ID.
- Android advertising ID: review enabling it in this PR, with the Play data-safety and
  #2660 documents updated to match.

## Outcome and acceptance

Remove the defects that this repository and the landing site control. Leave store,
AdMob and release steps as an explicit AK handoff; this PR does not claim that ad
serving has been restored.

- AC1: `https://todayweather.ai/app-ads.txt` returns HTTP 200 `text/plain` containing
  exactly the AdMob seller line for the account's publisher ID. A tested generator
  reproduces that line from the release app IDs without committing them. The runbook
  covers the store developer-website changes and the AdMob crawl check.
- AC2: a native banner load failure records a sanitized numeric error code. Every
  build gets a structured console log, and an analytics event is sent only after
  analytics consent. Messages, response IDs and ad IDs are never recorded.
- AC3: Android journeys are reproduced with test ads: launch → city or current
  location → weather → banner, plus denied location, offline/failure with retry, and
  return navigation. Results are recorded. A demonstrated placement or navigation
  defect gets a fix, a regression check and a passing rerun. The iOS journey status
  is recorded as reproduced or blocked.
- AC4: the identifier behaviour of the shipped configuration is explained and
  documented consistently with #2660: forced iOS `npa=1` without ATT, the merged
  Android `AD_ID` permission and the consent gates. No consent protection is weakened.
- AC5: the issue and runbooks record AK-owned actions with completion checks: both
  store website fields, AdMob authorization, the policy review request, the release,
  and the dated before/after cohort report.

## Boundaries

In scope: client ad adapter, telemetry and placement code with tests; a client
script; operating documents; one landing-site object upload.
Out of scope: store-console edits, AdMob console changes and review requests, store
submission, server/legacy EC2 deployment, the DNS for `wizardfactory.net`, forcing
personalization or ATT, TodayAir, and merge.
Coordinated issues: #2654 (measurement), #2660 (privacy/disclosure), #2605 (release).

## Risks and questions

- An app-ads.txt that is wrong or unreachable leaves demand restricted. Verify the
  public body with a byte comparison against the generated content.
- "Site Behavior: Navigation" has no published definition. Change placement only
  where a reproduced journey demonstrates a defect.
- Real devices with real ad units cannot be used for clicking tests. Use test ads only.
