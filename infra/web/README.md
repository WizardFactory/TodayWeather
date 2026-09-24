# Web deployment preparation

This directory prepares a **single-instance HTTPS staging deployment**. No deployment has been executed. Read [implementation status](../../docs/webapp/implementation.md) and resolve its release gates before public launch.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `WEB_API_MODE` | `live` (default) or explicitly labelled `demo` |
| `UPSTREAM_API_BASE_URL` | Trusted HTTPS origin; default existing TodayWeather gateway |
| `WEB_ORIGIN` | Exact browser origin, including scheme and optional port; required to match notification mutations |
| `HOST`, `PORT` | Node listen address; defaults 127.0.0.1:4174 |
| `WEB_STATIC_DIR` | Built client directory; default `web/dist` |
| `WEB_TRUST_PROXY` | Trust the final X-Forwarded-For address for rate limiting only behind a private, trusted proxy; default false |
| `WEB_PUSH_ENABLED` | Optional reminders; default false |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` | VAPID key pair, generated and retained by the operator |
| `WEB_PUSH_SUBJECT` | Valid VAPID contact URI (`mailto:` or HTTPS) |
| `WEB_SESSION_SECRET` | Stable random signing secret, >=32 characters; changing it invalidates ownership cookies |
| `WEB_DATA_DIR` | Persistent notification directory; never inside static assets or source control |

All push variables are required when enabled. They are server-side values; only the VAPID public key is returned to the browser. The server never reads a legacy mobile push key.

## Prepared deployment path

1. Provide a domain, HTTPS ingress, egress to the upstream gateway and optional browser push providers, plus a durable volume. Choose an independent host/service; do not install alongside or restart the existing collector without a separate operational assessment.
2. Build with `docker build -f infra/web/Dockerfile -t todayweather-web:<revision> .`. This was not executed in the development environment; inspect image and vulnerability results in staging.
3. Copy `.env.example` to ignored `.env` in this directory and configure the domain. Provision VAPID/session secrets only if reminders are being tested. Store/rotate them through the operator's secret system.
4. From this directory, `docker compose up -d --build` starts Caddy and one app replica. This is a deployment command, not part of local verification. Caddy terminates TLS; the app has no public port. Caddy's trusted proxy header is the only forwarded client address accepted by this recipe.
5. Check `/api/health`, coordinate weather/air, deep navigation and real asset/API 404 responses, CSP, HTTPS install, service worker update, offline snapshot and mobile geolocation denial. `/api/health` tests process availability, not provider freshness.
6. Optional reminders: install on supported devices, grant permission from a user gesture, save a rule, verify the actual delivered notification and its click destination. Test DST, revoked subscription, restart, unsubscribe and favorite deletion. The API's test-send response means the push provider accepted the request; it does not prove a displayed notification.

## Operations and limitations

The file-backed reminder store uses atomic rename and restrictive permissions, with one serial writer. **Never scale it to multiple app processes/replicas.** The 30-second scheduler runs in this process and provides generic city reminders, not condition evaluation or precise-time guarantees. Dedupe is persisted before send: a crash can miss a reminder rather than duplicate it. Later ticks recover at most five minute slots; startup checks only the current minute, and no durable retry queue survives crashes. Push sends run outside the store writer with at most four concurrent sends. Queued jobs recheck rule/subscription identity. Web Push 404/410 clears only the same invalid subscription, preserving replacements. Inactive installations expire after 90 days.

Rate limiting is 180 requests/minute per trusted client address. Add ingress DDoS controls, resource limits and observability for a public service. There is no shared API response cache or autoscaling in this candidate; provider load and traffic must be measured first. Do not add access logs containing full location requests, push endpoints or cookie values without an appropriate retention policy.

Back up the volume securely. Notification data contains coordinates, push endpoints and delivery metadata. Define retention, deletion/account recovery policy and legal/provider attribution before production. The UI includes a browser-wide unsubscribe action and removes the matching server rule before deleting a favorite when notifications are configured.

Keep the previous image, persistent data and VAPID/session keys for rollback. Restore the previous image with the same configuration; check `/api/health` and schema version before resuming reminders. Do not restore an old volume while the sender is active. Keep old hashed assets accessible across releases; the browser retains the immediately preceding cache, but tabs skipping multiple releases need a reload. Do not rewrite missing assets or APIs to `index.html`.

The original S3/CloudFront/Lambda/queue proposal requires separate infrastructure implementation and a transactional shared notification store; these files do not claim to provision it. Deployment, DNS, paid services and production provider repair remain operator-owned release steps.
