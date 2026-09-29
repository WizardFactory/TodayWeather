# Static deployment at app.tdywx.xyz

The default web build calls the existing public TodayWeather API directly. Production needs **private S3 + CloudFront**, with no additional Node process, Lambda, database or API proxy. Node is used only for building and local verification. The CloudFront viewer-request function rewrites known SPA links; it does not execute weather requests. Existing mobile API resources remain unchanged.

This runbook and template are prepared deployment inputs, not evidence of an AWS deployment. Web Push is unavailable in this static mode. See [implementation and data limitations](../../../docs/webapp/implementation.md).

## Build and verify

From the repository root with Node >=22.12:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm start
```

Open http://127.0.0.1:4174. The preview serves only `web/dist` with the same navigation function and CSP as the template; it has no API routes. Weather, geocode, nationwide data and warnings go directly to `https://todayweather.wizardfactory.net`. The browser's Network panel should show no `/api/web/v1` requests. Build output has hashed/compressed-on-delivery assets, an installable service worker and a `release.json` deployment descriptor. Never upload repository files, `.env` files or `node_modules`.

| Build variable            | Default and purpose                                               |
| ------------------------- | ----------------------------------------------------------------- |
| `VITE_WEB_TRANSPORT`      | `direct` only; omit or set to `direct`, other values are rejected |
| `VITE_WEB_MODE`           | `live`; `demo` explicitly enables labelled synthetic fixtures     |
| `VITE_WEATHER_API_ORIGIN` | `https://todayweather.wizardfactory.net`; HTTPS origin only       |

Vite reads these at **build time**. The uploader accepts only live/direct artifacts for the existing API and `app.tdywx.xyz`. Custom API origins require corresponding CORS/CSP and deployment-policy changes. No secret belongs in a `VITE_*` variable. Demo example: `VITE_WEB_MODE=demo npm run dev`. A live failure shows an error or an explicitly labelled previous snapshot; it never selects demo data automatically.

## Deployment decision

The deployment method is **not yet decided by AK**. This runbook describes two prepared options; it does not establish a `workflow_dispatch` production pipeline or claim that AWS resources have been freshly inspected. Recheck current AWS state read-only before choosing. Preserve the existing public API distribution and native routes in either option.

## Option A: reuse the existing distribution and bucket

A read-only inspection on 2026-09-25 (local review record, not committed) recorded distribution `EKUBX6BR1Y9D6` serving `app.tdywx.xyz` from bucket `tdywx-app-141248341265-apne2` (`ap-northeast-2`) **without** a navigation function, so deep links returned 403. That observation is timestamped; confirm it before changing anything. Do not run the template against this bucket or alias expecting adoption; the template always creates new resources.

1. Read the current configuration and keep its `ETag` and a saved copy for rollback. The CLI output wraps the configuration as `{"ETag": ..., "DistributionConfig": {...}}`, but `update-distribution --distribution-config` accepts only the inner object, so extract it into a separate file:

   ```sh
   aws cloudfront get-distribution-config --id EKUBX6BR1Y9D6 --output json > app-distribution-before.json
   jq '.DistributionConfig' app-distribution-before.json > app-distribution-before-config.json
   jq -r '.ETag' app-distribution-before.json   # the ETag for step 4
   ```

   Keep both files unchanged; `app-distribution-before-config.json` is the rollback input.

   Confirm the alias, the S3 origin for the bucket with OAC, `redirect-to-https` and an **empty `OriginPath`** on the default behavior's target origin. The uploader writes to the bucket root, so a non-empty `OriginPath` must be resolved before deployment. Also run these read-only checks, which the technical design requires before reuse:
   - **Cache policy.** Read the default behavior's `CachePolicyId` with `aws cloudfront get-cache-policy --id <CachePolicyId>`. It must honor the object `Cache-Control` headers the uploader sets: `MinTTL` 0, `DefaultTTL` 0, `MaxTTL` at least 31536000, and no cookies, headers or query strings in the cache key (the template's `Cache` resource). A behavior that uses legacy `ForwardedValues` instead of a cache policy needs the same TTLs. If it differs, create a template-equivalent cache policy and set it in step 4.
   - **Viewer certificate.** Read `ViewerCertificate.ACMCertificateArn`, then `aws acm describe-certificate --region us-east-1 --certificate-arn <arn>`. The certificate must be `ISSUED`, unexpired, and its domain name or subject alternative names must cover `app.tdywx.xyz`. Expect `SslSupportMethod` `sni-only` and `MinimumProtocolVersion` `TLSv1.2_2021` or newer.
   - **DNS.** `dig +short CNAME app.tdywx.xyz` (or the Route 53 alias record) must point to this distribution's domain from `aws cloudfront get-distribution --id EKUBX6BR1Y9D6 --query Distribution.DomainName`. It must not point to an S3 website endpoint or another distribution.
   - **Custom error responses.** `CustomErrorResponses.Items` must not set a `ResponsePagePath` (or a 200 `ResponseCode`). A common SPA mapping of 403/404 to `/index.html` would serve HTML for missing assets and API paths, contradicting the "no distribution-wide error-to-200 fallback" rule. Remove such mappings in step 4; the known-route function replaces them. The uploader preflight rejects them.

2. Create and publish the viewer-request function from `infra/web/static/route-request.js` (runtime `cloudfront-js-2.0`), for example with `aws cloudfront create-function --name <name> --function-config Comment=...,Runtime=cloudfront-js-2.0 --function-code fileb://infra/web/static/route-request.js`, `aws cloudfront test-function`, then `aws cloudfront publish-function`. Later route changes use `update-function` followed by `publish-function`.
3. Create a response headers policy equivalent to the template's `Headers` resource (security headers and its CSP, whose `connect-src` includes `https://todayweather.wizardfactory.net`).
4. Copy `app-distribution-before-config.json` to `app-distribution-new-config.json` and edit the copy:
   - `DefaultCacheBehavior.FunctionAssociations`: `Quantity` 1 with one item whose `EventType` is `viewer-request` and whose `FunctionARN` is the published function from step 2;
   - `DefaultCacheBehavior.ResponseHeadersPolicyId`: the policy from step 3;
   - when step 1 found a cache policy that does not honor object headers, `DefaultCacheBehavior.CachePolicyId`: the template-equivalent cache policy (create it first with `aws cloudfront create-cache-policy`, matching the template's `Cache` resource);
   - when step 1 found error-to-page mappings, `CustomErrorResponses`: remove every item that sets a `ResponsePagePath` (or a 200 `ResponseCode`) and set `Quantity` to the remaining item count.

   Apply it and wait until the distribution is deployed:

   ```sh
   aws cloudfront update-distribution --id EKUBX6BR1Y9D6 --if-match <ETag from step 1> \
     --distribution-config file://app-distribution-new-config.json
   aws cloudfront wait distribution-deployed --id EKUBX6BR1Y9D6
   ```

   Rollback restores the saved inner configuration. The `ETag` changes with every update, so read the current one first:

   ```sh
   aws cloudfront get-distribution-config --id EKUBX6BR1Y9D6 --query ETag --output text
   aws cloudfront update-distribution --id EKUBX6BR1Y9D6 --if-match <current ETag> \
     --distribution-config file://app-distribution-before-config.json
   aws cloudfront wait distribution-deployed --id EKUBX6BR1Y9D6
   ```

   Rollback detaches the function, headers policy and any new cache policy but does not delete them; delete them separately once they are no longer needed.

5. Upload with the dry-run and then `--execute` commands below using `WEB_BUCKET=tdywx-app-141248341265-apne2` and `WEB_DISTRIBUTION=EKUBX6BR1Y9D6`.

## Option B: new stack with planned cutover

These are operator-executed AWS changes; review the CloudFormation change set and cost before executing them. Use an appropriate named AWS profile. The template creates a new bucket, OAC, function, cache/headers policies and distribution; it does not modify the existing API distribution.

The `AppDomainName` parameter defaults to `app.tdywx.xyz`, which is **already an alias of the existing distribution**. CloudFront rejects the same alias on a second distribution (`CNAMEAlreadyExists`), so the stack cannot simply be created with the default while the existing distribution is live. Treat Option B as a **planned cutover**:

1. Request a public ACM certificate **in us-east-1** covering the production hostname (and any staging hostname). Add ACM's DNS validation CNAME at the authoritative DNS provider for `tdywx.xyz` and wait for `ISSUED`. Keep that CNAME for renewal. If using Route 53, ensure the registrar delegates to the actual hosted zone nameservers.
2. Create the stack with a non-conflicting staging hostname (for example `AppDomainName=app-next.tdywx.xyz`) and leave `HostedZoneId` empty unless that staging record should be managed by the stack. Review/create it in the desired bucket region (example ap-northeast-2):

```sh
aws cloudformation deploy \
  --region ap-northeast-2 \
  --stack-name tdywx-web \
  --template-file infra/web/static/stack.json \
  --parameter-overrides AppDomainName="$WEB_STAGING_DOMAIN" CertificateArn="$WEB_CERTIFICATE_ARN" HostedZoneId="${WEB_HOSTED_ZONE_ID:-}" \
  --no-execute-changeset
```

Inspect the returned change set and execute it when approved. Wait for stack completion. Retrieve outputs:

```sh
aws cloudformation describe-stacks --region ap-northeast-2 \
  --stack-name tdywx-web --query 'Stacks[0].Outputs' --output table
```

3. Validate the new distribution on its staging hostname or `DistributionDomain`. The uploader only accepts builds for `app.tdywx.xyz` and checks that alias, so a full uploader run against the new distribution happens during the cutover window; before it, verify the configuration read-only and stage the artifact.
4. Schedule a cutover window with an owner and a rollback plan. Record the current `app` DNS record and the existing distribution configuration first. In the window, move the `app.tdywx.xyz` alias from the existing distribution to the new one: either CloudFront's alias move (`aws cloudfront associate-alias`, which requires a DNS TXT verification record) or removing the alias from `EKUBX6BR1Y9D6` and then updating the stack with `AppDomainName=app.tdywx.xyz` (expect a short interruption between those steps). Keep `HostedZoneId` empty for this update so the stack does not try to create records that already exist. Upload the release with the uploader, then **update** the existing `app` record in place to the new `DistributionDomain` (CNAME at external DNS, or the Route 53 alias target). Never delete the production `app` record, and do not point DNS to the S3 website endpoint. The root `tdywx.xyz` and any root-to-app redirect are separate choices and are not changed here.
5. Rollback: restore the alias on the existing distribution from the saved configuration and point the `app` record back to it. The existing bucket and distribution stay untouched until the new stack is accepted.

The template's private S3 bucket blocks public access. CloudFront OAC and the bucket policy allow reads only from its distribution. Leave bucket website hosting disabled. The template enables HTTPS redirects, modern TLS, compression, security headers and a cache policy that honors object cache headers.

## Upload a release

For Option A, set `WEB_BUCKET=tdywx-app-141248341265-apne2` and `WEB_DISTRIBUTION=EKUBX6BR1Y9D6` after reconfirming them. For Option B, use the stack's `BucketName` and `DistributionId` outputs. The following prints the proposed commands and does not call AWS:

```sh
npm run deploy:static -- --bucket "$WEB_BUCKET" --distribution "$WEB_DISTRIBUTION"
```

Review it, then execute explicitly:

```sh
npm run deploy:static -- --bucket "$WEB_BUCKET" --distribution "$WEB_DISTRIBUTION" --execute
```

The dry run also prints the `release` block (`commit`, `builtAt`) from the artifact's `release.json`, so the reviewer can confirm which source revision is about to be uploaded; `--execute` repeats the commit in its final message.

Before any upload, `--execute` runs read-only preflight checks and stops with a specific error if one fails:

- the distribution has the `app.tdywx.xyz` alias; its default behavior targets the bucket's S3 origin; that origin has Origin Access Control; the behavior's viewer protocol policy is `redirect-to-https`. Each condition has its own error message;
- that origin's `OriginPath` is empty;
- no `CustomErrorResponses` entry sets a `ResponsePagePath` (an error-to-page mapping would return HTML for missing assets);
- the default behavior has a `viewer-request` CloudFront Function association, and that function's **LIVE** code equals `infra/web/static/route-request.js` after whitespace normalization. The code is read with `aws cloudfront get-function --name <name> --stage LIVE --output json <outfile>`: the CLI streams the code to a temporary outfile (removed afterwards) and prints only metadata on stdout;
- the default behavior has a response headers policy, and `aws cloudfront get-response-headers-policy` returns a CSP whose `connect-src` includes `https://todayweather.wizardfactory.net`.

The dry run performs none of these calls.

The upload sends hashed assets first with `public,max-age=31536000,immutable`, then unversioned shell files with `no-cache`, `index.html` and finally `sw.js`. It preserves old hashed files and requests a CloudFront invalidation. `AWS_PROFILE` and AWS CLI configuration are honored; `AWS_CLI` can specify the CLI executable. Required operator permissions include `cloudfront:GetDistributionConfig`, `cloudfront:GetFunction`, `cloudfront:GetResponseHeadersPolicy`, `cloudfront:CreateInvalidation` and object writes to this bucket. No credential is embedded in the build.

The preflight does not check the cache policy, the viewer certificate or DNS; those remain the Option A read-only checks above. The upload is ordered, not transactional. Keep the uploaded artifact as described in [Release identity and rollback](#release-identity-and-rollback); if upload is interrupted, retry the same complete artifact before announcing the release. Do not use `s3 sync --delete`: older service workers/tabs may still request previous hashed chunks.

Wait for invalidation completion before release checks. The uploader runs `create-invalidation` but does not print its output, so find the invalidation ID afterwards (the newest entry, `InProgress` until it completes) and wait for it:

```sh
aws cloudfront list-invalidations --distribution-id "$WEB_DISTRIBUTION" \
  --query 'InvalidationList.Items[0].[Id,Status,CreateTime]' --output text
aws cloudfront wait invalidation-completed --distribution-id "$WEB_DISTRIBUTION" --id <invalidation-id>
```

## Release checks

Run the [live smoke](#live-smoke) against the real domain after the invalidation completes, pinned to the commit that was uploaded (the `release.commit` printed by the dry run and by `--execute`):

```sh
node scripts/web-live-smoke.mjs --base https://app.tdywx.xyz --expect-commit <deployed sha> \
  --json test-results/web-live-smoke.json
```

It automates the route, header, `release.json`, API contract, CSP, service worker install/control and offline deep-link parts of these checks. `--expect-commit` fails the run when `https://app.tdywx.xyz/release.json` reports another commit, so a stale edge cache or a wrong `--dir` does not pass silently. The **Web live smoke** workflow accepts the same values as the `base_url` and `expect_commit` inputs. Then verify HTTPS at `https://app.tdywx.xyz`, deep-link refresh (for example `/weather/seoul/hourly`), location search and consent-based geolocation, all weather/air/unit/nation/warning screens, install, first worker claim, update acceptance and offline snapshots. Inspect browser CORS/CSP errors from the real domain. `/api/web/v1/weather` and unknown routes should be 404; missing S3 assets may be 403 or 404 and must never return HTML. Inspect `Content-Type` and `Cache-Control` for HTML, worker and hashed assets. Confirm the UI explains that static web notifications are unavailable.

## Release identity and rollback

Each build writes `release.json` with `commit` and `builtAt` next to the existing `schemaVersion`, `siteOrigin`, `transport`, `mode` and `apiOrigin` fields. `commit` is `GITHUB_SHA` in GitHub Actions, otherwise the local `git rev-parse HEAD`, otherwise `unknown`. A local build from a working tree with uncommitted changes reports `<HEAD>-dirty`: the uploader refuses to `--execute` such a build, and the live smoke warns about it (and fails when `--expect-commit` is given). Deploy only CI-built or clean-tree artifacts. `builtAt` is the build time in ISO 8601 and honors `SOURCE_DATE_EPOCH` for reproducible builds. The deployed release is identified by `https://app.tdywx.xyz/release.json`; the live smoke records it.

The **Web app** workflow uploads `web/dist` as the `web-static-dist` artifact with a **90-day retention**. Deploy the artifact of the `push` run on `master` for the commit being released, or a clean local build of that commit, and record that run's URL with the release. `pull_request` runs also upload `web-static-dist`, but they build GitHub's temporary merge commit: their `release.json` `commit` is that merge commit's `GITHUB_SHA`, which is neither the pull request head nor a `master` commit. These artifacts are for review only and are **not deployment candidates**; `--expect-commit <head sha>` would reject them after an upload. Always pass `--expect-commit` the commit of the artifact actually deployed (the `master` push commit or the clean local `HEAD`). The workflow's path filters skip commits that change only other paths (for example `docs/webapp/**` or `server/**`), so such a commit has no `push` run and no artifact: start the **Web app** workflow manually (`workflow_dispatch`) on `master` at that commit and deploy that run's artifact; its `release.json` `commit` is the dispatched head. CI artifacts expire and are not a permanent archive: before replacing a release, keep the currently deployed artifact available for rollback, either by making sure its Actions run is within the retention period or by downloading it (for example `gh run download <run-id> --name web-static-dist --dir <dir>`) to operator-controlled storage.

For rollback, pass `--dir` pointing to that previous **complete live/direct artifact** to the same uploader. Its dry run shows the `release.commit` being restored; review it, execute and wait for invalidation. Then run the live smoke with `--base https://app.tdywx.xyz --expect-commit <restored sha>`, which fails unless `release.json` reports the restored commit. The previous service worker digest will be reinstalled through the normal update flow. Bucket versioning is an additional recovery aid, not a substitute for a complete artifact. Bucket deletion/replacement retains data; plan cleanup separately.

## Live smoke

`scripts/web-live-smoke.mjs` is an unmocked, read-only Chromium smoke of the static app and the public API it calls. It sends GET requests only (to the site under test, plus the app's own weather, nationwide and warnings requests and one geocode request to the API), needs no credentials and changes nothing.

```sh
# Pre-deploy: build, then serve web/dist on a free local port with the preview (stopped afterwards)
npm run build
node scripts/web-live-smoke.mjs --json test-results/web-live-smoke.json

# Post-deploy, after the CloudFront invalidation completes
node scripts/web-live-smoke.mjs --base https://app.tdywx.xyz --expect-commit <deployed sha> \
  --json test-results/web-live-smoke.json
```

Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_EXECUTABLE_PATH` to an existing Chromium. It checks:

- deep links (`/`, `/locations`, `/weather/seoul/hourly`, `/weather/seoul/daily`, `/air/seoul`, `/nation/weather`, `/nation/air`, `/warnings`, `/settings`, `/help`) return 200 HTML with the app shell over HTTP and render it in the browser;
- `/definitely-missing` is a 404, either a hosting 404 from the route function or the app's 404 page (the result records which), and `/assets/missing.js` and `/api/web/v1/weather` never return HTML;
- `release.json` is a live/direct release and reports `commit` and `builtAt` (a warning for older releases without them, and for a `-dirty` local build). With `--expect-commit <sha>` (at least 7 hex characters, matched as a prefix) a different, missing or `-dirty` commit fails. The HTML CSP `connect-src`, `sw.js` `no-cache` and hashed-asset `immutable` headers are present;
- every same-origin `src`/`href` in `index.html` (theme script, hashed bundle, icons, manifest) and every entry of the deployed `/sw.js` precache list returns 200 with a matching content type (`hosting`). The worker installs with an all-or-nothing `cache.addAll`, so one missing entry, such as a 404 `/theme.js` after a partial upload, a manual `s3 sync` or an old viewer-request function, leaves the app without offline support or update detection. The list is read from the deployed worker, so an older release whose list lacks `/theme.js` is checked against its own entries;
- the service worker becomes ready within 15 seconds of the first visit and controls the page after a reload (`app`, or `hosting` when the precache check also failed). At the end of the run, with the browser context offline and every network request aborted (Playwright's offline emulation alone does not survive a navigation in headless Chromium), a reload of `/weather/seoul/hourly` must be answered by the worker's cached shell and, when Seoul weather rendered online, show the saved-data notice (`저장된 자료를 표시합니다`). Failures are recorded, never warnings;
- Seoul weather is from KMA, shows a parsed observation stamp (no dotted KMA time), a numeric temperature, at least 8 hourly chart labels and, on `/weather/seoul/daily`, at least 3 daily rows; it uses only the known precipitation labels and shows the AirKorea credit when air data exists. Nationwide weather and air render rows; warnings render bulletins or the empty state;
- a non-KR place, `/weather/tokyo/hourly` (overseas `VC` path; 501 until the #2585 backend is deployed): a non-200 or unreadable response is a `warn` (category `upstream`) with the status, content type and `access-control-allow-origin` as Chromium received them plus the same GET repeated outside the browser; a 200 must pass the DSF forecast-shape check, render a numeric temperature and show the "Powered by Dark Sky" credit. On 2026-09-26 the browser received a 501 `text/plain` without `access-control-allow-origin` (CORS error), while the same GET outside the browser returned 501 with `*`;
- the API responses observed from the page: `weather/coord` for Seoul 200 JSON whose forecast shape can render (rows in `short` or `shortest`, at least 3 `midData.dailyData` rows and a numeric `current.t1h`), `nation/KR` 200 JSON under 1.5 MB (a warning above 1 MB; the client limit is 2 MB), `kma/special` 200 JSON array and `geocode/coord` 200 JSON, each with `access-control-allow-origin`. A rendering check whose captured Seoul body lacks the data is reported as `upstream`, otherwise as `app`;
- freshness warnings with the recorded ages in hours: any nationwide air observation time, or the newest warning announcement, older than 24 hours. On 2026-09-26 both warned (air observations from 2021, announcements about 5 years old);
- domestic weather freshness (`upstream` warnings), the main signal that the collector has stalled: the Seoul current observation (`current.stnDateTime`, else `current.date`/`time`) older than 3 hours or the page showing `관측 시각이 오래된 자료입니다`, and the forecast publication (`shortPubDate`) older than 24 hours or the page showing `발표 후 오래된 예보입니다`. API times are naive KST wall times;
- no CSP violations, page errors or same-origin `/api/` requests.

Each check is recorded as `pass`, `warn`, `skip` or `fail` with evidence and a category: `hosting`, `app` or `upstream`. Upstream unavailability or contract drift is reported as `upstream`, so it can be told apart from an app regression, but it still fails the run. The command exits 1 on any failure. Warnings do not fail it (exit 0); for example, the 2026-09-26 run warned that the API returned no Seoul air stations. Chronic warnings are listed by exact check name, with their reason and optionally an evidence condition (the Tokyo warning counts as known only for a 501), in `KNOWN_WARNINGS` in the script (on 2026-09-26: the AirKorea credit and Seoul air page without air data, the Tokyo 501, and stale nationwide air and warning announcements). The log marks them `(known)` by check name only (evidence conditions apply to the JSON and job summary), the JSON sets `known` on each warning and adds `warnings: {known, new}`, and any other warning counts as new. When `GITHUB_STEP_SUMMARY` is set (GitHub Actions sets it), the script appends a Markdown job summary with the counts, every FAIL line, then new warnings marked **NEW**, then known warnings with their reason. Remove a `KNOWN_WARNINGS` entry once its cause is fixed, so that a recurrence shows as new. With `--json <file>`, every failed check also saves a full-page screenshot of the current page as `<file>.fail-<check>.png` and records its path (`screenshot`) and page URL in the check; a failure in the HTTP-only hosting checks shows whichever page was open at the time (often blank).

The **Web live smoke** workflow (`.github/workflows/web-live-smoke.yml`) runs daily at 00:30 UTC and on manual dispatch. With an empty `base_url` input it builds `web/dist` and checks the local preview; set `base_url` to `https://app.tdywx.xyz` after a deployment to check the real domain. The scheduled run therefore watches the public API contract and the current build, not the deployed hosting. It uploads the JSON result and any failure screenshots as the `web-live-smoke` artifact, even when the run fails, writes the job summary described above on the run page, and does not run on pull requests, so live upstream flakiness cannot block merges. A scheduled run that only warns still succeeds, so read its summary for **NEW** warnings.

**Ownership and triage.** AK (or the operator AK names) owns smoke failures; the workflow has no notification step. Results are in the repository's Actions tab under **Web live smoke**: the run log lists every check, and the `web-live-smoke` artifact holds the JSON and screenshots. GitHub emails scheduled-run failures only to the user who last changed the workflow's `cron` line (subject to that user's notification settings), so check the Actions tab after deployments and periodically. Classify a failure by its category:

- `hosting`: static responses, headers or `release.json` (for example a commit mismatch). Check the last upload, the CloudFront invalidation and the distribution configuration; redeploy or roll back per [Release identity and rollback](#release-identity-and-rollback).
- `app`: rendering, CSP or page errors while the API body was fine. Treat as a web regression: reproduce locally with the preview and fix or roll back.
- `upstream`: the public API's availability or contract. Confirm with the evidence (status, content type, CORS headers, body problems) and hand it to the API/backend owner; the static release itself needs no action.

GitHub runs scheduled workflows only from the workflow file on the **default branch** (`master`), so the schedule starts after this workflow is merged. In a public repository GitHub disables scheduled workflows after 60 days without repository activity; re-enable **Web live smoke** from the Actions tab when that happens.

The API's existing CORS support was observed in the [dated infrastructure review](../../../docs/webapp/existing-infrastructure-review.md). The app reads `Retry-After` only on a 429 response; a 503 always shows a generic temporary-unavailability message. A cross-origin page can read that 429 `Retry-After` value only when the API also sends `Access-Control-Expose-Headers: Retry-After`; until the backend adds it, the app shows its generic wait message (backend follow-up). This implementation does not repair stale nationwide air, missing provider observations, or create browser push scheduling. Actual AWS creation/upload, DNS, ACM issuance, production cache propagation and iOS/Android installed-app checks remain operator validation steps.

Reference: [AWS OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [CloudFront certificate region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [CloudFormation Function](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-function.html).
