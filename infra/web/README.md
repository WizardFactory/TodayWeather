# Static web hosting

The webapp is a static PWA for **app.tdywx.xyz**. Its only hosting target in this repository is [private S3 + CloudFront](static/README.md), with browser calls to the existing public TodayWeather API. No additional Node server, API proxy or notification service is deployed.

The former Docker/Caddy recipe and Node API workspace have been removed. Node is used for local development, builds and static preview only. Run `npm run build` and `npm start` from the repository root to inspect `web/dist` locally; the preview is not a production requirement.

The static directory contains a CloudFormation template, a known-route navigation function and deployment guidance. The uploader defaults to dry-run and preserves previous hashed assets. These are preparation artifacts: **the final deployment method is deferred**, and no workflow-based deployment is implemented by this change. See the [runbook](static/README.md) for existing-resource review, ordered uploads and rollback, and [implementation status](../../docs/webapp/implementation.md) for data/device release boundaries.

Web Push is unavailable. The app presents mobile-app guidance and does not collect browser subscriptions or notification schedules. Any future browser alert service requires separate design and authorization; existing native push infrastructure is unchanged.
