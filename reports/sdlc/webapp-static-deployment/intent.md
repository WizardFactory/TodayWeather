# Intent

Deliver a static PWA using existing public APIs, without a required Node BFF, plus S3/CloudFront deployment artifacts for https://app.tdywx.xyz. Preserve existing behavior and explicitly optional legacy proxy mode. Web Push remains unavailable in static mode; no new sender implementation or silent feature-completion claim.

AC1: default production reads use public versioned APIs with browser normalization and no same-origin API dependency.
AC2: catalog/capabilities/favorites/settings and offline/PWA behaviors work from static files.
AC3: live/demo/proxy configurations are explicit, validated and never fallback silently.
AC4: private S3/OAC/HTTPS hosting, known-route rewrite, caching, deploy dry-run and operations documentation are reviewable for app.tdywx.xyz.
AC5: regression, static browser smoke, independent verification, commit/push and remote checks completed, with deployment limits truthful.
