# Static deployment at app.todayweather.ai

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

Vite reads these at **build time**. The uploader accepts only live/direct artifacts for the existing API and `app.todayweather.ai`. Custom API origins require corresponding CORS/CSP and deployment-policy changes. No secret belongs in a `VITE_*` variable. Demo example: `VITE_WEB_MODE=demo npm run dev`. A live failure shows an error or an explicitly labelled previous snapshot; it never selects demo data automatically.

## Deployment decision

For [#2646](https://github.com/WizardFactory/TodayWeather/issues/2646), prepare **Option A: reuse existing hosting** for `app.todayweather.ai`. This is a local preparation decision, not production execution authorization. There is no automatic production deployment. The opt-in [guarded manual release workflow](../../../docs/operations/github-releases.md) requires separately approved environment/IAM activation and production approval. Recheck the destination read-only before executing; preserve the existing public API and native routes. Option B is reference-only and requires a separately approved migration.

Set `AWS_PROFILE`, `WEB_BUCKET` and `WEB_DISTRIBUTION` from the operator's verified environment inventory. Do not publish credentials or environment-specific resource identifiers in the repository. Confirm the selected account with `aws sts get-caller-identity`, and verify the distribution alias and default S3 origin against these inputs. Use an operator-controlled backup directory outside Git (`WEB_BACKUP_DIR`) for the following configuration and content backups. All create/update/publish/upload/invalidation commands below require explicit production deployment authorization.

## Option A: reuse the existing distribution and bucket

Use the existing distribution whose alias is `app.todayweather.ai` and its default S3 origin. Do not run the template expecting adoption: it always creates new resources. Inventory policy associations before changes; **create app-specific policies rather than modifying policies shared with a landing page or another distribution**.

Before changing anything, preserve the current site, including a first-release coming-soon page that may have no `release.json`:

```sh
: "${WEB_BUCKET:?Set the verified app bucket}"
: "${WEB_DISTRIBUTION:?Set the verified app distribution}"
: "${WEB_BACKUP_DIR:?Set a new private backup directory outside Git}"
mkdir -p "$WEB_BACKUP_DIR/objects"
aws s3api get-bucket-versioning --bucket "$WEB_BUCKET" > "$WEB_BACKUP_DIR/versioning.json"
aws s3api list-object-versions --bucket "$WEB_BUCKET" > "$WEB_BACKUP_DIR/object-versions.json"
aws s3api list-objects-v2 --bucket "$WEB_BUCKET" > "$WEB_BACKUP_DIR/live-objects.json"
aws s3 cp "s3://$WEB_BUCKET/" "$WEB_BACKUP_DIR/objects/" --recursive
WEB_BUCKET="$WEB_BUCKET" WEB_BACKUP_DIR="$WEB_BACKUP_DIR" python3 - <<'PYBACKUP'
import json, os, pathlib, subprocess
backup = pathlib.Path(os.environ["WEB_BACKUP_DIR"])
objects = json.loads((backup / "live-objects.json").read_text()).get("Contents", [])
metadata = {}
for obj in objects:
    metadata[obj["Key"]] = json.loads(subprocess.check_output([
        "aws", "s3api", "head-object", "--bucket", os.environ["WEB_BUCKET"],
        "--key", obj["Key"], "--output", "json",
    ], text=True))
(backup / "object-metadata.json").write_text(json.dumps(metadata, indent=2))
PYBACKUP
```

Keep the complete previous release artifact if the site already hosts the app. The raw object copy is a content backup; `object-metadata.json` preserves the original headers, user metadata and available version ID for every live key. Require its keys to match `live-objects.json` and verify every listed object has a byte backup before proceeding. Stop if any backup command fails. Coordinate a write-free backup window or compare inventories/versions again to detect concurrent changes. Do not use an existing backup directory or overwrite the rollback artifact.

1. Read the current configuration and keep its `ETag` and a saved copy for rollback. The CLI output wraps the configuration as `{"ETag": ..., "DistributionConfig": {...}}`, but `update-distribution --distribution-config` accepts only the inner object, so extract it into a separate file:

   ```sh
   aws cloudfront get-distribution-config --id "$WEB_DISTRIBUTION" --output json > "$WEB_BACKUP_DIR/app-distribution-before.json"
   jq '.DistributionConfig' "$WEB_BACKUP_DIR/app-distribution-before.json" > "$WEB_BACKUP_DIR/app-distribution-before-config.json"
   jq -r '.ETag' "$WEB_BACKUP_DIR/app-distribution-before.json"   # the ETag for step 4
   ```

   Keep both files unchanged; `app-distribution-before-config.json` is the rollback input.

   Confirm the alias, the S3 origin for the bucket with OAC, `redirect-to-https` and an **empty `OriginPath`** on the default behavior's target origin. The uploader writes to the bucket root, so a non-empty `OriginPath` must be resolved before deployment. Also run these read-only checks, which the technical design requires before reuse:
   - **Cache policy.** Read the default behavior's `CachePolicyId` with `aws cloudfront get-cache-policy --id <CachePolicyId>`. It must honor the object `Cache-Control` headers the uploader sets: `MinTTL` 0, `DefaultTTL` 0, `MaxTTL` at least 31536000, and no cookies, headers or query strings in the cache key (the template's `Cache` resource). A behavior that uses legacy `ForwardedValues` instead of a cache policy needs the same TTLs. If it differs, create a template-equivalent cache policy and set it in step 4.
   - **Viewer certificate.** Read `ViewerCertificate.ACMCertificateArn`, then `aws acm describe-certificate --region us-east-1 --certificate-arn <arn>`. The certificate must be `ISSUED`, unexpired, and its domain name or subject alternative names must cover `app.todayweather.ai`. Expect `SslSupportMethod` `sni-only` and `MinimumProtocolVersion` `TLSv1.2_2021` or newer.
   - **DNS.** `dig +short CNAME app.todayweather.ai` (or the Route 53 alias record) must point to this distribution's domain from `aws cloudfront get-distribution --id "$WEB_DISTRIBUTION" --query Distribution.DomainName`. It must not point to an S3 website endpoint or another distribution.
   - **Custom error responses.** `CustomErrorResponses.Items` must not set a `ResponsePagePath` (or a 200 `ResponseCode`). A common SPA mapping of 403/404 to `/index.html` would serve HTML for missing assets and API paths, contradicting the "no distribution-wide error-to-200 fallback" rule. Remove such mappings in step 4; the known-route function replaces them. The uploader preflight rejects them.

2. Create and publish the viewer-request function from `infra/web/static/route-request.js` (runtime `cloudfront-js-2.0`), for example with `aws cloudfront create-function --name <name> --function-config Comment=...,Runtime=cloudfront-js-2.0 --function-code fileb://infra/web/static/route-request.js`, `aws cloudfront test-function`, then `aws cloudfront publish-function`. Later route changes use `update-function` followed by `publish-function`.
3. Create a new **app-specific** response headers policy equivalent to the template's `Headers` resource (security headers and its CSP, whose `connect-src` includes `https://todayweather.wizardfactory.net`).
4. Copy `$WEB_BACKUP_DIR/app-distribution-before-config.json` to a separate `app-distribution-new-config.json` and edit the copy:
   - `DefaultCacheBehavior.FunctionAssociations`: `Quantity` 1 with one item whose `EventType` is `viewer-request` and whose `FunctionARN` is the published function from step 2;
   - `DefaultCacheBehavior.ResponseHeadersPolicyId`: the policy from step 3;
   - when step 1 found a cache policy that does not honor object headers, `DefaultCacheBehavior.CachePolicyId`: the template-equivalent cache policy (create it first with `aws cloudfront create-cache-policy`, matching the template's `Cache` resource);
   - when step 1 found error-to-page mappings, `CustomErrorResponses`: remove every item that sets a `ResponsePagePath` (or a 200 `ResponseCode`) and set `Quantity` to the remaining item count.

   Apply it in the approved release window and wait until the distribution is deployed. A placeholder using inline styles can temporarily lose styling under the stricter app CSP; publish the app immediately afterwards or first prepare a placeholder with external CSS. Do not announce release until upload and smoke complete:

   ```sh
   aws cloudfront update-distribution --id "$WEB_DISTRIBUTION" --if-match <ETag from step 1> \
     --distribution-config file://app-distribution-new-config.json
   aws cloudfront wait distribution-deployed --id "$WEB_DISTRIBUTION"
   ```

   Rollback restores the saved inner configuration. The `ETag` changes with every update, so read the current one first:

   ```sh
   aws cloudfront get-distribution-config --id "$WEB_DISTRIBUTION" --query ETag --output text
   aws cloudfront update-distribution --id "$WEB_DISTRIBUTION" --if-match <current ETag> \
     --distribution-config "file://$WEB_BACKUP_DIR/app-distribution-before-config.json"
   aws cloudfront wait distribution-deployed --id "$WEB_DISTRIBUTION"
   ```

   Rollback detaches the function, headers policy and any new cache policy but does not delete them; delete them separately once they are no longer needed.

5. Upload with the dry-run and then `--execute` commands below using the verified `WEB_BUCKET` and `WEB_DISTRIBUTION`. Do not change the existing certificate, alias or DNS as part of reuse.

## Option B: new stack with planned cutover

These are operator-executed AWS changes; review the CloudFormation change set and cost before executing them. Use an appropriate named AWS profile. The template creates a new bucket, OAC, function, cache/headers policies and distribution; it does not modify the existing API distribution.

The `AppDomainName` parameter defaults to `app.todayweather.ai`, which is **already an alias of the existing distribution**. CloudFront rejects the same alias on a second distribution (`CNAMEAlreadyExists`), so the stack cannot simply be created with the default while the existing distribution is live. Treat Option B as a **planned cutover**:

1. Request a public ACM certificate **in us-east-1** covering the production hostname (and any staging hostname). Add ACM's DNS validation CNAME at the authoritative DNS provider for `todayweather.ai` and wait for `ISSUED`. Keep that CNAME for renewal. If using Route 53, ensure the registrar delegates to the actual hosted zone nameservers.
2. Create the stack with a non-conflicting staging hostname (for example `AppDomainName=app-next.todayweather.ai`) and leave `HostedZoneId` empty unless that staging record should be managed by the stack. Review/create it in the desired bucket region (example ap-northeast-2):

```sh
aws cloudformation deploy \
  --region ap-northeast-2 \
  --stack-name todayweather-web \
  --template-file infra/web/static/stack.json \
  --parameter-overrides AppDomainName="$WEB_STAGING_DOMAIN" CertificateArn="$WEB_CERTIFICATE_ARN" HostedZoneId="${WEB_HOSTED_ZONE_ID:-}" \
  --no-execute-changeset
```

Inspect the returned change set and execute it when approved. Wait for stack completion. Retrieve outputs:

```sh
aws cloudformation describe-stacks --region ap-northeast-2 \
  --stack-name todayweather-web --query 'Stacks[0].Outputs' --output table
```

3. Validate the new distribution on its staging hostname or `DistributionDomain`. The uploader only accepts builds for `app.todayweather.ai` and checks that alias, so a full uploader run against the new distribution happens during the cutover window; before it, verify the configuration read-only and stage the artifact.
4. Schedule a cutover window with an owner and a rollback plan. Record the current `app` DNS record and the existing distribution configuration first. In the window, move the `app.todayweather.ai` alias from the existing distribution to the new one: either CloudFront's alias move (`aws cloudfront associate-alias`, which requires a DNS TXT verification record) or removing the alias from `"$WEB_DISTRIBUTION"` and then updating the stack with `AppDomainName=app.todayweather.ai` (expect a short interruption between those steps). Keep `HostedZoneId` empty for this update so the stack does not try to create records that already exist. Upload the release with the uploader, then **update** the existing `app` record in place to the new `DistributionDomain` (CNAME at external DNS, or the Route 53 alias target). Never delete the production `app` record, and do not point DNS to the S3 website endpoint. The root `todayweather.ai` and any root-to-app redirect are separate choices and are not changed here.
5. Rollback: restore the alias on the existing distribution from the saved configuration and point the `app` record back to it. The existing bucket and distribution stay untouched until the new stack is accepted.

The template's private S3 bucket blocks public access. CloudFront OAC and the bucket policy allow reads only from its distribution. Leave bucket website hosting disabled. The template enables HTTPS redirects, modern TLS, compression, security headers and a cache policy that honors object cache headers.

## Guarded GitHub release

Use the [target naming, release-note template and activation guide](../../../docs/operations/github-releases.md) for Actions deployment. It accepts only the exact successful master-push `web-static-dist` artifact, snapshots the previous site privately before writes, waits for its exact invalidation and runs commit-pinned live smoke. It never deploys from a PR artifact or from Release publication alone. Manual operator procedures below remain available under their own production authorization.

## Upload a release

For Option A, use the verified `WEB_BUCKET` and `WEB_DISTRIBUTION`. For Option B, use the stack outputs only after a separately authorized cutover. The following prints the proposed commands and does not call AWS:

```sh
npm run deploy:static -- --bucket "$WEB_BUCKET" --distribution "$WEB_DISTRIBUTION"
```

Review it, then execute explicitly:

```sh
npm run deploy:static -- --bucket "$WEB_BUCKET" --distribution "$WEB_DISTRIBUTION" --execute
```

The dry run also prints the `release` block (`commit`, `builtAt`) from the artifact's `release.json`, so the reviewer can confirm which source revision is about to be uploaded; `--execute` repeats the commit in its final message.

Before any upload, `--execute` runs read-only preflight checks and stops with a specific error if one fails:

- the distribution has the `app.todayweather.ai` alias; its default behavior targets the bucket's S3 origin; that origin has Origin Access Control; the behavior's viewer protocol policy is `redirect-to-https`. Each condition has its own error message;
- that origin's `OriginPath` is empty;
- no `CustomErrorResponses` entry sets a `ResponsePagePath` (an error-to-page mapping would return HTML for missing assets);
- the default behavior has a `viewer-request` CloudFront Function association, and that function's **LIVE** code equals `infra/web/static/route-request.js` after whitespace normalization. The code is read with `aws cloudfront get-function --name <name> --stage LIVE --output json <outfile>`: the CLI streams the code to a temporary outfile (removed afterwards) and prints only metadata on stdout;
- the default behavior has a response headers policy, and `aws cloudfront get-response-headers-policy` returns a CSP whose `connect-src` includes `https://todayweather.wizardfactory.net`.

The dry run performs none of these calls.

The upload sends hashed assets first with `public,max-age=31536000,immutable`, then unversioned shell files with `no-cache`, `index.html` and finally `sw.js`. It preserves old hashed files and requests a CloudFront invalidation. `AWS_PROFILE` and AWS CLI configuration are honored; `AWS_CLI` can specify the CLI executable. Required operator permissions include `cloudfront:GetDistributionConfig`, `cloudfront:GetFunction`, `cloudfront:GetResponseHeadersPolicy`, `cloudfront:CreateInvalidation` and object writes to this bucket. No credential is embedded in the build.

The preflight does not check the cache policy, the viewer certificate or DNS; those remain the Option A read-only checks above. The upload is ordered, not transactional. Keep the uploaded artifact as described in [Release identity and rollback](#release-identity-and-rollback); if upload is interrupted, retry the same complete artifact before announcing the release. Do not use `s3 sync --delete`: older service workers/tabs may still request previous hashed chunks.

Wait for invalidation completion before release checks. With `--receipt <file>`, the uploader writes `commit`, `builtAt` and the exact returned `invalidationId` for deterministic waiting; the guarded workflow uses this option. Without it, the uploader does not print the response, so find the invalidation ID afterwards (the newest entry, `InProgress` until it completes) and wait for it:

```sh
aws cloudfront list-invalidations --distribution-id "$WEB_DISTRIBUTION" \
  --query 'InvalidationList.Items[0].[Id,Status,CreateTime]' --output text
aws cloudfront wait invalidation-completed --distribution-id "$WEB_DISTRIBUTION" --id <invalidation-id>
```

## Release checks

Run the [live smoke](#live-smoke) against the real domain after the invalidation completes, pinned to the commit that was uploaded (the `release.commit` printed by the dry run and by `--execute`):

```sh
node scripts/web-live-smoke.mjs --base https://app.todayweather.ai --expect-commit <deployed sha> \
  --json test-results/web-live-smoke.json
```

It automates the route, header, `release.json`, API contract, CSP, service worker install/control and offline deep-link parts of these checks. `--expect-commit` fails the run when `https://app.todayweather.ai/release.json` reports another commit, so a stale edge cache or a wrong `--dir` does not pass silently. The **Web live smoke** workflow accepts the same values as the `base_url` and `expect_commit` inputs. Then verify HTTPS at `https://app.todayweather.ai`, deep-link refresh (for example `/weather/seoul/hourly`), location search and consent-based geolocation, all weather/air/unit/nation/warning screens, install, first worker claim, update acceptance and offline snapshots. Inspect browser CORS/CSP errors from the real domain. `/api/web/v1/weather` and unknown routes should be 404; missing S3 assets may be 403 or 404 and must never return HTML. Inspect `Content-Type` and `Cache-Control` for HTML, worker and hashed assets. Confirm the UI explains that static web notifications are unavailable.

## Release identity and rollback

Each build writes `release.json` with `commit` and `builtAt` next to the existing `schemaVersion`, `siteOrigin`, `transport`, `mode` and `apiOrigin` fields. `commit` is `GITHUB_SHA` in GitHub Actions, otherwise the local `git rev-parse HEAD`, otherwise `unknown`. A local build from a working tree with uncommitted changes reports `<HEAD>-dirty`: the uploader refuses to `--execute` such a build, and the live smoke warns about it (and fails when `--expect-commit` is given). Deploy only CI-built or clean-tree artifacts. `builtAt` is the build time in ISO 8601 and honors `SOURCE_DATE_EPOCH` for reproducible builds. The deployed release is identified by `https://app.todayweather.ai/release.json`; the live smoke records it.

The **Web app** workflow uploads `web/dist` as `web-static-dist` with **90-day retention**. The guarded Release workflow accepts only the successful `push` run on `master` for the exact source commit. PR merge artifacts, `workflow_dispatch` builds and local builds are not candidates for that workflow. Local clean builds remain available only for a separately approved operator procedure; they do not satisfy Release artifact provenance. Always pin live smoke to the uploaded artifact's full source SHA.

Path filters can leave a commit without a master-push artifact. Do not substitute a manual run: select an existing successful master-push source commit, or obtain a new master push that legitimately triggers the Web app build before publishing its Release. Manual builds remain useful for build verification. Keep the currently deployed complete artifact in operator-controlled storage before its Actions retention expires, for example with `gh run download <run-id> --name web-static-dist --dir <dir>`. Record its run URL and SHA as the rollback reference.

For rollback, pass `--dir` pointing to that previous **complete live/direct artifact** to the same uploader. Its dry run shows the `release.commit` being restored; review it, execute and wait for invalidation. Then run the live smoke with `--base https://app.todayweather.ai --expect-commit <restored sha>`, which fails unless `release.json` reports the restored commit. The previous service worker digest will be reinstalled through the normal update flow. Bucket versioning is an additional recovery aid, not a substitute for a complete artifact. Bucket deletion/replacement retains data; plan cleanup separately.


### First-release rollback to a placeholder

A saved coming-soon page without `release.json` cannot pass the app uploader. Use the operator-only [recovery worker](recovery-worker.js), which is **not** included in normal `web/dist` uploads. It skips waiting, removes only `tw-shell-*` caches, claims existing app windows, unregisters itself and navigates those windows to the origin root. Other caches, preferences and IndexedDB are preserved. A closed tab does not prevent remaining tabs from recovering.

After rollback authorization, identify the backup format first. A guarded-workflow backup uses the private `webapp-rollbacks/<run-id>-<attempt>/snapshot.json` completion marker and numbered `objects/N`. Download that prefix to a private local directory. Its `inventory.Contents`, `versions`, `versioning`, `metadata` and `distributionBefore` replace the manual procedure's `live-objects.json`, `object-versions.json`, `versioning.json`, `object-metadata.json` and `distribution.json`, respectively. Never require those separate filenames from a guarded snapshot.

For its byte restore, iterate the original keys in `inventory.Contents`, read the numbered local file identified by `checksums[key].object`, verify SHA-256 against `checksums[key].sha256`, and restore that file to the original S3 key with its `metadata[key]` content headers and user `Metadata`. Do not construct local paths from original S3 keys. Stop on a missing completion marker, file, checksum or metadata. For configuration restore, use `distributionBefore.DistributionConfig` with a fresh live ETag. The numbered mapping is a storage detail; the restored object key remains the original inventory key.

Then perform every step below, using the corresponding snapshot fields for a guarded backup or the named files for a manual backup:

1. Restore **every live key in the pre-release backup**, not only `index.html`. Use the captured `object-versions.json` entries whose `IsLatest` is true (excluding delete markers), copying each retained **non-null** version back onto its original key with metadata directive `COPY`. Confirm bucket versioning was `Enabled` in `versioning.json`; a missing or suspended status, or `VersionId` equal to `"null"`, requires the bytes-plus-metadata restore path instead. A null version can be overwritten and must never be treated as a retained snapshot. This restores original bytes and metadata, including placeholder-owned icons or scripts overwritten by the app. If a saved version is unavailable, restore the backed-up bytes and per-key metadata from `object-metadata.json` (original content headers and user `Metadata`, excluding read-only head response fields); stop if either is missing. Do not infer metadata from filenames.
2. Compare the failed release's complete artifact inventory with the pre-release key inventory. Remove only release-added **unversioned shell keys** (`release.json`, `theme.js`, `manifest.webmanifest`, `icon.svg` and files under `icons/`) that were absent before the release. In particular, a first-release placeholder with no `release.json` must return 403/404 for that path after rollback, rather than advertise the failed app release. Preserve hashed `assets/` for returning old tabs, preserve unrelated keys, and reserve `/sw.js` for the recovery worker below. Review the exact key list before object deletion; never use bucket-wide `sync --delete`.
3. Publish the checked-in recovery worker at the same `/sw.js` URL used by the app, then invalidate and wait:

   ```sh
   aws s3 cp infra/web/static/recovery-worker.js "s3://$WEB_BUCKET/sw.js" \
     --content-type 'text/javascript; charset=utf-8' --cache-control 'no-cache'
   aws cloudfront create-invalidation --distribution-id "$WEB_DISTRIBUTION" --paths '/*'
   aws cloudfront wait invalidation-completed --distribution-id "$WEB_DISTRIBUTION" --id <returned-id>
   ```

4. Restore the saved inner distribution configuration using a fresh ETag as described in Option A; wait for deployment. Keep `/sw.js` reachable through the original S3 origin, with `no-cache`. Do not delete it when restoring the placeholder or apply a distribution-wide error-to-HTML fallback. The saved placeholder may use inline CSS, which needs its original headers policy restored.
5. After the restored distribution configuration is deployed, create another `/*` invalidation and wait for completion using the commands in step 3. Verify the final public worker bytes and cache header:

   ```sh
   curl -fsS -D "$WEB_BACKUP_DIR/recovery-headers.txt" https://app.todayweather.ai/sw.js \
     -o "$WEB_BACKUP_DIR/served-recovery-worker.js"
   cmp infra/web/static/recovery-worker.js "$WEB_BACKUP_DIR/served-recovery-worker.js"
   rg -i '^cache-control:.*no-cache' "$WEB_BACKUP_DIR/recovery-headers.txt"
   ```

   Also confirm `/release.json` is absent (403/404) when absent in the pre-release inventory; otherwise verify its restored version. Root HTML and every restored placeholder-owned resource must match the backup. Do not declare rollback complete based only on the homepage returning 200.

6. Verify a browser with the released worker and a fresh browser: existing app windows return to `/`, the placeholder appears, no app registration or `tw-shell-*` cache remains, and preferences/other caches survive. On an already-open app, revisiting/focusing triggers its normal update check; incident checks may explicitly call `registration.update()` in DevTools. Retain the recovery worker for returning clients. Offline clients cannot be forced to update; they recover only after reconnecting and checking the worker.

`web/e2e/recovery-worker.spec.ts` verifies this lifecycle in real Chromium against the built app, including offline shell use, two enrolled tabs, preserved settings/unrelated cache and a fresh browser. API data is isolated with fixtures; this is not a live AWS rollback. Run it with `npx playwright test web/e2e/recovery-worker.spec.ts` after a complete build. A subsequent approved app release uploads its normal `sw.js` again. Prefer a complete known-good app artifact for ordinary release-to-release rollback.

## Live smoke

`scripts/web-live-smoke.mjs` is an unmocked, read-only Chromium smoke of the static app and the public API it calls. It sends GET requests only (to the site under test, plus the app's own weather, nationwide and warnings requests and one geocode request to the API), needs no credentials and changes nothing.

```sh
# Pre-deploy: build, then serve web/dist on a free local port with the preview (stopped afterwards)
npm run build
node scripts/web-live-smoke.mjs --json test-results/web-live-smoke.json

# Post-deploy, after the CloudFront invalidation completes
node scripts/web-live-smoke.mjs --base https://app.todayweather.ai --expect-commit <deployed sha> \
  --json test-results/web-live-smoke.json
```

Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_EXECUTABLE_PATH` to an existing Chromium. It checks:

- deep links (`/`, `/locations`, `/weather/seoul/hourly`, `/weather/seoul/daily`, `/air/seoul`, `/nation/weather`, `/nation/air`, `/warnings`, `/settings`, `/help`) return 200 HTML with the app shell over HTTP and render it in the browser;
- `/definitely-missing` is a 404, either a hosting 404 from the route function or the app's 404 page (the result records which), and `/assets/missing.js` and `/api/web/v1/weather` never return HTML;
- `release.json` is a live/direct release and reports `commit` and `builtAt` (a warning for older releases without them, and for a `-dirty` local build). With `--expect-commit <sha>` (at least 7 hex characters, matched as a prefix) a different, missing or `-dirty` commit fails. The HTML CSP `connect-src`, `sw.js` `no-cache` and hashed-asset `immutable` headers are present;
- every same-origin `src`/`href` in `index.html` (theme script, hashed bundle, icons, manifest) and every entry of the deployed `/sw.js` precache list returns 200 with a matching content type (`hosting`). The worker installs with an all-or-nothing `cache.addAll`, so one missing entry, such as a 404 `/theme.js` after a partial upload, a manual `s3 sync` or an old viewer-request function, leaves the app without offline support or update detection. The list is read from the deployed worker, so an older release whose list lacks `/theme.js` is checked against its own entries;
- the service worker becomes ready within 15 seconds of the first visit and controls the page after a reload (`app`, or `hosting` when the precache check also failed). At the end of the run, with the browser context offline and every network request aborted (Playwright's offline emulation alone does not survive a navigation in headless Chromium), a reload of `/weather/seoul/hourly` must be answered by the worker's cached shell and, when Seoul weather rendered online, show the saved-data notice (`저장된 자료를 표시합니다`). Failures are recorded, never warnings;
- Seoul weather is from KMA, shows a parsed observation stamp (no dotted KMA time), a numeric temperature, at least 8 hourly chart labels and, on `/weather/seoul/daily`, at least 3 daily rows; it uses only the known precipitation labels and shows the air credit when air data exists (AirKorea, or the provider named by the API when AirKorea has no fresh observation). Nationwide weather and air render rows, or an empty state (an upstream warning) when the API returns none; warnings render bulletins or the empty state;
- a non-KR place, `/weather/tokyo/hourly` (overseas `VC` path, live since 2026-09-27): a non-200 or unreadable response is a `warn` (category `upstream`) with the status, content type and `access-control-allow-origin` as Chromium received them plus the same GET repeated outside the browser; a 200 must pass the overseas forecast-shape check, render a numeric temperature and show the "Weather Data Provided by Visual Crossing" credit;
- the API responses observed from the page: `weather/coord` for Seoul 200 JSON whose forecast shape can render (rows in `short` or `shortest`, at least 3 `midData.dailyData` rows and a numeric `current.t1h`), `nation/KR` 200 JSON under 1.5 MB (a warning above 1 MB; the client limit is 2 MB), `kma/special` 200 JSON array and `geocode/coord` 200 JSON, each with `access-control-allow-origin`. A rendering check whose captured Seoul body lacks the data is reported as `upstream`, otherwise as `app`;
- freshness warnings with the recorded ages in hours: any nationwide air observation time, or the newest warning announcement, older than 24 hours. On 2026-09-26 both warned (air observations from 2021, announcements about 5 years old);
- domestic weather freshness (`upstream` warnings), the main signal that the collector has stalled: the Seoul current observation (`current.stnDateTime`, else `current.date`/`time`) older than 3 hours or the page showing `관측 시각이 오래된 자료입니다`, and the forecast publication (`shortPubDate`) older than 24 hours or the page showing `발표 후 오래된 예보입니다`. API times are naive KST wall times;
- no CSP violations, page errors or same-origin `/api/` requests.

Each check is recorded as `pass`, `warn`, `skip` or `fail` with evidence and a category: `hosting`, `app` or `upstream`. Upstream unavailability or contract drift is reported as `upstream`, so it can be told apart from an app regression, but it still fails the run. The command exits 1 on any failure. Warnings do not fail it (exit 0); for example, the 2026-09-26 run warned that the API returned no Seoul air stations. Chronic warnings are listed by exact check name, with their reason and optionally an evidence condition in `KNOWN_WARNINGS` in the script (none since 2026-09-29: the Tokyo 501 and stale warning announcements were removed when #2585 and #2609 were fixed, and the missing Seoul air credit and stations and stale nationwide air when the air provider chain of #2622 and #2628 was deployed; on 2026-09-29 the nationwide air list was empty, a new upstream warning). The log marks them `(known)` by check name only (evidence conditions apply to the JSON and job summary), the JSON sets `known` on each warning and adds `warnings: {known, new}`, and any other warning counts as new. When `GITHUB_STEP_SUMMARY` is set (GitHub Actions sets it), the script appends a Markdown job summary with the counts, every FAIL line, then new warnings marked **NEW**, then known warnings with their reason. Remove a `KNOWN_WARNINGS` entry once its cause is fixed, so that a recurrence shows as new. With `--json <file>`, every failed check also saves a full-page screenshot of the current page as `<file>.fail-<check>.png` and records its path (`screenshot`) and page URL in the check; a failure in the HTTP-only hosting checks shows whichever page was open at the time (often blank).

The **Web live smoke** workflow (`.github/workflows/web-live-smoke.yml`) runs daily at 00:30 UTC and on manual dispatch. With an empty `base_url` input it builds `web/dist` and checks the local preview; set `base_url` to `https://app.todayweather.ai` after a deployment to check the real domain. The scheduled run therefore watches the public API contract and the current build, not the deployed hosting. It uploads the JSON result and any failure screenshots as the `web-live-smoke` artifact, even when the run fails, writes the job summary described above on the run page, and does not run on pull requests, so live upstream flakiness cannot block merges. A scheduled run that only warns still succeeds, so read its summary for **NEW** warnings.

**Ownership and triage.** AK (or the operator AK names) owns smoke failures; the workflow has no notification step. Results are in the repository's Actions tab under **Web live smoke**: the run log lists every check, and the `web-live-smoke` artifact holds the JSON and screenshots. GitHub emails scheduled-run failures only to the user who last changed the workflow's `cron` line (subject to that user's notification settings), so check the Actions tab after deployments and periodically. Classify a failure by its category:

- `hosting`: static responses, headers or `release.json` (for example a commit mismatch). Check the last upload, the CloudFront invalidation and the distribution configuration; redeploy or roll back per [Release identity and rollback](#release-identity-and-rollback).
- `app`: rendering, CSP or page errors while the API body was fine. Treat as a web regression: reproduce locally with the preview and fix or roll back.
- `upstream`: the public API's availability or contract. Confirm with the evidence (status, content type, CORS headers, body problems) and hand it to the API/backend owner; the static release itself needs no action.

GitHub runs scheduled workflows only from the workflow file on the **default branch** (`master`), so the schedule starts after this workflow is merged. In a public repository GitHub disables scheduled workflows after 60 days without repository activity; re-enable **Web live smoke** from the Actions tab when that happens.

The API's existing CORS support was observed in the [dated infrastructure review](../../../docs/webapp/existing-infrastructure-review.md). The app reads `Retry-After` only on a 429 response; a 503 always shows a generic temporary-unavailability message. A cross-origin page can read that 429 `Retry-After` value only when the API also sends `Access-Control-Expose-Headers: Retry-After`; until the backend adds it, the app shows its generic wait message (backend follow-up). This implementation does not repair stale nationwide air, missing provider observations, or create browser push scheduling. Actual AWS creation/upload, DNS, ACM issuance, production cache propagation and iOS/Android installed-app checks remain operator validation steps.

Reference: [AWS OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [CloudFront certificate region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [CloudFormation Function](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-function.html).
