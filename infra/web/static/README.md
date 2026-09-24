# Static deployment at app.tdywx.xyz

The default web build calls the existing public TodayWeather API directly. Production needs **private S3 + CloudFront**, with no additional Node process, Lambda, database or API proxy. Node is used only for building and local verification. The CloudFront viewer-request function rewrites known SPA links; it does not execute weather requests. Existing mobile API resources remain unchanged.

This runbook and template are prepared deployment inputs, not evidence of an AWS deployment. Web Push is unavailable in this static mode. See [implementation and data limitations](../../../docs/webapp/implementation.md).

## Build and verify

From the repository root with Node >=22.12:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build:web
npm run preview:static
```

Open http://127.0.0.1:4174. The preview serves only `web/dist` with the same navigation function and CSP as the template; it has no API routes. Weather, geocode, nationwide data and warnings go directly to `https://todayweather.wizardfactory.net`. The browser's Network panel should show no `/api/web/v1` requests. Build output has hashed/compressed-on-delivery assets, an installable service worker and a `release.json` deployment descriptor. Never upload repository files, `.env` files or `node_modules`.

| Build variable | Default and purpose |
| --- | --- |
| `VITE_WEB_TRANSPORT` | `direct`; `proxy` explicitly opts into the older Node adapter |
| `VITE_WEB_MODE` | `live`; `demo` explicitly enables labelled synthetic fixtures |
| `VITE_WEATHER_API_ORIGIN` | `https://todayweather.wizardfactory.net`; HTTPS origin only |

Vite reads these at **build time**. The uploader accepts only live/direct artifacts for the existing API and `app.tdywx.xyz`. Custom API origins require corresponding CORS/CSP and deployment-policy changes. No secret belongs in a `VITE_*` variable. Demo example: `VITE_WEB_MODE=demo npm run dev`. A live failure shows an error or an explicitly labelled previous snapshot; it never selects demo data automatically.

## Certificate, hosting and DNS

These are operator-executed AWS changes; review the CloudFormation change set and cost before executing them. Use an appropriate named AWS profile. The template creates a new distribution and bucket; it does not modify the existing API distribution.

1. Request a public ACM certificate **in us-east-1** for `app.tdywx.xyz`. Add ACM's DNS validation CNAME at the authoritative DNS provider for `tdywx.xyz`, and wait for `ISSUED`. Keep that CNAME for renewal. If using Route 53, ensure the registrar delegates to the actual hosted zone nameservers.
2. Set `WEB_CERTIFICATE_ARN` to that certificate ARN. Optionally set `WEB_HOSTED_ZONE_ID` to the public Route 53 zone ID. Leave it empty for external DNS. Review/create the stack in the desired bucket region (example ap-northeast-2):

```sh
aws cloudformation deploy \
  --region ap-northeast-2 \
  --stack-name tdywx-web \
  --template-file infra/web/static/stack.json \
  --parameter-overrides CertificateArn="$WEB_CERTIFICATE_ARN" HostedZoneId="${WEB_HOSTED_ZONE_ID:-}" \
  --no-execute-changeset
```

Inspect the returned change set and execute it when approved. Wait for stack completion. Retrieve outputs:

```sh
aws cloudformation describe-stacks --region ap-northeast-2 \
  --stack-name tdywx-web --query 'Stacks[0].Outputs' --output table
```

3. With `HostedZoneId`, the template creates alias A and AAAA records for `app.tdywx.xyz`. Otherwise add **CNAME `app` → the `DistributionDomain` output** at the authoritative DNS provider. Remove a conflicting existing `app` record only after reviewing it. Do not point DNS to the S3 website endpoint. The root `tdywx.xyz` and any root-to-app redirect are separate choices and are not changed here.
4. The private S3 bucket blocks public access. CloudFront OAC and the bucket policy allow reads only from this distribution. Leave bucket website hosting disabled. The template enables HTTPS redirects, modern TLS, compression, security headers and a cache policy that honors object cache headers.

## Upload a release

Set `WEB_BUCKET` and `WEB_DISTRIBUTION` from this stack's `BucketName` and `DistributionId` outputs. The following prints the proposed commands and does not call AWS:

```sh
npm run deploy:static -- --bucket "$WEB_BUCKET" --distribution "$WEB_DISTRIBUTION"
```

Review it, then execute explicitly:

```sh
npm run deploy:static -- --bucket "$WEB_BUCKET" --distribution "$WEB_DISTRIBUTION" --execute
```

The script checks the distribution alias, S3 origin and OAC before upload. It uploads hashed assets first with `public,max-age=31536000,immutable`, then unversioned shell files with `no-cache`, `index.html` and finally `sw.js`. It preserves old hashed files and requests a CloudFront invalidation. `AWS_PROFILE` and AWS CLI configuration are honored; `AWS_CLI` can specify the CLI executable. Required operator permissions include distribution read/invalidation and object writes to this bucket. No credential is embedded in the build.

The upload is ordered, not transactional. Archive each verified `web/dist` with its source commit; if upload is interrupted, retry the same complete artifact before announcing the release. Do not use `s3 sync --delete`: older service workers/tabs may still request previous hashed chunks. Wait for invalidation completion before release checks.

## Release checks and rollback

Verify HTTPS at `https://app.tdywx.xyz`, deep-link refresh (for example `/weather/seoul/hourly`), location search and consent-based geolocation, all weather/air/unit/nation/warning screens, install, first worker claim, update acceptance and offline snapshots. Inspect browser CORS/CSP errors from the real domain. `/api/web/v1/weather` and unknown routes should be 404; missing S3 assets may be 403 or 404 and must never return HTML. Inspect `Content-Type` and `Cache-Control` for HTML, worker and hashed assets. Confirm the UI explains that static web notifications are unavailable.

For rollback, pass `--dir` pointing to a previously archived **complete live/direct artifact** to the same uploader; review its dry-run, execute and wait for invalidation. The previous service worker digest will be reinstalled through the normal update flow. Bucket versioning is an additional recovery aid, not a substitute for a complete artifact. Bucket deletion/replacement retains data; plan cleanup separately.

The API's existing CORS support was observed in the [dated infrastructure review](../../../docs/webapp/existing-infrastructure-review.md). This implementation does not repair stale nationwide air, missing provider observations, or create browser push scheduling. Actual AWS creation/upload, DNS, ACM issuance, production cache propagation and iOS/Android installed-app checks remain operator validation steps.

Reference: [AWS OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [CloudFront certificate region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [CloudFormation Function](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-function.html).
