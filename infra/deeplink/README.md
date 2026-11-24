# TodayWeather link host

This stack serves only `link.todayweather.ai`. The viewer-request function serves the two OS association files from private S3 and redirects recognized deep links (`/`·`/open` and content routes) straight to `app.todayweather.ai` for browser fallback, or to the OS app store when `?fallback=store` is passed on mobile. The product landing and policy pages stay on `todayweather.ai`. See the [link contract](../../specs/deeplink.md) and [rollout order](../../plans/deeplink.md#critical-rollout-order-immediate-branch-replacement-safety).

## Verify locally

From the repository root, with Node.js 22:

```sh
node --test scripts/verification/deeplink-{golden,edge,deploy}.test.mjs
```

The tests invoke the actual CloudFront handler and compare it with the shared vectors. They check the committed template, association documents, deployment preflight and upload metadata using synthetic inputs and a mock AWS CLI. Keep `Resources.Navigation.Properties.FunctionCode` in `stack.json` identical to `route-request.js`. Run CloudFormation template validation and a CloudFront function test in the target environment before rollout.

## Provision and upload

1. Use a designated AWS CLI v2 profile and an issued ACM certificate in `us-east-1` that covers `link.todayweather.ai`. Review the CloudFormation change set for [stack.json](stack.json) in the intended account. The template creates a separate distribution, signed OAC and private, versioned bucket. Set `HostedZoneId` for Route 53-managed alias records or leave it blank and configure the external CNAME separately. Use the stack outputs `BucketName` and `DistributionId` for the uploader.
2. Confirm Apple Associated Domains for the release app and obtain the Play **app signing** certificate digest. Set `APPLE_TEAM_ID` and `PLAY_APP_SIGNING_SHA256` in the operator environment. The uploader prints only object keys, metadata and sizes during dry-run.
3. Once the new distribution is deployed, run the dry-run below. Before updating an existing host, record the current S3 version ID for each listed object. Serialize uploads and stack changes for this distribution until verification finishes.

```sh
node scripts/deploy-deeplink-static.mjs
node scripts/deploy-deeplink-static.mjs --execute \
  --bucket "$LINK_BUCKET" --distribution "$LINK_DISTRIBUTION" --profile "$LINK_AWS_PROFILE"
node scripts/deeplink-live-smoke.mjs
```

The uploader resolves the selected bucket region via `s3:GetBucketLocation` and requires an exact regional S3 origin match. It also checks the deployed alias and routing, exact LIVE function code, cache and header policies, OAC and bucket protection before writing. It uploads only the generated association objects, verifies each object's metadata, then waits for its CloudFront invalidation. The bucket grants CloudFront only `s3:GetObject`. The distribution accepts the standard CloudFront method set so the viewer-request function can return `405` with `Allow: GET, HEAD` before a write method reaches the origin.

The live smoke uses the same identity inputs. It checks direct association responses, direct `302` redirects to `app.todayweather.ai`, `?fallback=store` redirects to App Store / Google Play / WebApp, missing paths (`404`, including removed `/open.html` and `/assets/*`) and method rejection (`405`). Complete the physical-device checks in [DL-06](https://github.com/WizardFactory/TodayWeather/issues/3098) after the PWA is deployed.

## Recover from a failed upload

If a deployment stops after writing one or more objects, inspect the latest S3 versions and metadata. Restore affected keys by copying their recorded prior versions over the same keys with the original metadata. If the function or headers changed, restore the matching prior stack revision and wait for CloudFront deployment. Invalidate the affected object paths and the affected viewer paths (`/`, `/open`, `/open/`), wait for completion, and rerun the smoke with the restored signing identities. On a first deployment with no prior objects, correct the failure and rerun the uploader before announcing the new host. Existing mobile releases and web URLs provide the fallback until the new host is qualified.
