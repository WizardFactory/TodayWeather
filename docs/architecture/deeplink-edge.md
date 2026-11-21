# Deep-link edge fallback

The [link-host stack](../../infra/deeplink/stack.json) defines a dedicated CloudFront distribution and a versioned private S3 origin. This page describes the repository implementation before production qualification. See the [request sequence](diagrams/deeplink-edge.html) and its [editable source](diagrams/deeplink-edge.json).

The [viewer-request function](../../infra/deeplink/route-request.js) rewrites `/`, `/open`, and `/open/` to the static fallback. It returns `302` for recognized content routes and sends browsers to the corresponding route at `app.todayweather.ai`. Only the two association objects and the known fallback assets pass through to S3. Unsupported methods, malformed paths and unknown routes receive distinct edge responses.

The [operator runbook](../../infra/deeplink/README.md) covers association file generation, deployment checks, smoke testing and rollback. Use the [fallback guide](../operations/deeplink-fallback/manual.pdf) for browser instructions and the [rollout plan](../../plans/deeplink.md) for PWA deployment and native verification.
