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

1. Read the current configuration and keep its `ETag` and a saved copy for rollback:

   ```sh
   aws cloudfront get-distribution-config --id EKUBX6BR1Y9D6 --output json > app-distribution-before.json
   ```

   Confirm the alias, the S3 origin for the bucket with OAC, `redirect-to-https` and an **empty `OriginPath`** on the default behavior's target origin. The uploader writes to the bucket root, so a non-empty `OriginPath` must be resolved before deployment.

2. Create and publish the viewer-request function from `infra/web/static/route-request.js` (runtime `cloudfront-js-2.0`), for example with `aws cloudfront create-function --name <name> --function-config Comment=...,Runtime=cloudfront-js-2.0 --function-code fileb://infra/web/static/route-request.js`, `aws cloudfront test-function`, then `aws cloudfront publish-function`. Later route changes use `update-function` followed by `publish-function`.
3. Create a response headers policy equivalent to the template's `Headers` resource (security headers and its CSP, whose `connect-src` includes `https://todayweather.wizardfactory.net`).
4. In the saved `DistributionConfig`, set `DefaultCacheBehavior.FunctionAssociations` to the published function ARN with event type `viewer-request` and `DefaultCacheBehavior.ResponseHeadersPolicyId` to the new policy. Apply it with `aws cloudfront update-distribution --id EKUBX6BR1Y9D6 --if-match <ETag> --distribution-config file://...`, then wait for `Deployed`. Rollback is `update-distribution` with `app-distribution-before.json` and the new `ETag`.
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

Before any upload, `--execute` runs read-only preflight checks and stops with a specific error if one fails:

- the distribution has the `app.tdywx.xyz` alias, its default behavior targets the bucket's S3 origin with OAC and redirects to HTTPS;
- that origin's `OriginPath` is empty;
- the default behavior has a `viewer-request` CloudFront Function association, and that function's **LIVE** code equals `infra/web/static/route-request.js` after whitespace normalization. The code is read with `aws cloudfront get-function --name <name> --stage LIVE --output json <outfile>`: the CLI streams the code to a temporary outfile (removed afterwards) and prints only metadata on stdout;
- the default behavior has a response headers policy, and `aws cloudfront get-response-headers-policy` returns a CSP whose `connect-src` includes `https://todayweather.wizardfactory.net`.

The dry run performs none of these calls.

The upload sends hashed assets first with `public,max-age=31536000,immutable`, then unversioned shell files with `no-cache`, `index.html` and finally `sw.js`. It preserves old hashed files and requests a CloudFront invalidation. `AWS_PROFILE` and AWS CLI configuration are honored; `AWS_CLI` can specify the CLI executable. Required operator permissions include `cloudfront:GetDistributionConfig`, `cloudfront:GetFunction`, `cloudfront:GetResponseHeadersPolicy`, `cloudfront:CreateInvalidation` and object writes to this bucket. No credential is embedded in the build.

The upload is ordered, not transactional. Archive each verified `web/dist` with its source commit; if upload is interrupted, retry the same complete artifact before announcing the release. Do not use `s3 sync --delete`: older service workers/tabs may still request previous hashed chunks. Wait for invalidation completion before release checks.

## Release checks and rollback

Verify HTTPS at `https://app.tdywx.xyz`, deep-link refresh (for example `/weather/seoul/hourly`), location search and consent-based geolocation, all weather/air/unit/nation/warning screens, install, first worker claim, update acceptance and offline snapshots. Inspect browser CORS/CSP errors from the real domain. `/api/web/v1/weather` and unknown routes should be 404; missing S3 assets may be 403 or 404 and must never return HTML. Inspect `Content-Type` and `Cache-Control` for HTML, worker and hashed assets. Confirm the UI explains that static web notifications are unavailable.

For rollback, pass `--dir` pointing to a previously archived **complete live/direct artifact** to the same uploader; review its dry-run, execute and wait for invalidation. The previous service worker digest will be reinstalled through the normal update flow. Bucket versioning is an additional recovery aid, not a substitute for a complete artifact. Bucket deletion/replacement retains data; plan cleanup separately.

The API's existing CORS support was observed in the [dated infrastructure review](../../../docs/webapp/existing-infrastructure-review.md). This implementation does not repair stale nationwide air, missing provider observations, or create browser push scheduling. Actual AWS creation/upload, DNS, ACM issuance, production cache propagation and iOS/Android installed-app checks remain operator validation steps.

Reference: [AWS OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [CloudFront certificate region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [CloudFormation Function](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-function.html).
