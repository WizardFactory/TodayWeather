# Design validation

Architecture source and HTML: `docs/webapp/diagrams/webapp-architecture.{json,html}`. This is a proposed logical component diagram, not verified production topology. It traces the product specification's read/storage/notification boundaries and technical design's separate web deployment.

- Artifact: 9/9 showcase checks; 0 errors and warnings. Hashes/byte counts in `diagram-delivery.json`.
- Browser: real existing Chromium, supplied using ARCHIFY_CHROME; 1440x900, 1600x1000, 1920x1080, 2048x1320 all contained. Light/dark captures at both endpoint sizes. Full receipt: `diagram-browser-command.json`.
- Visual: main agent inspected all four generated PNGs. Main path and notification branch readable, labels clear, no crossing/overlap, cards and viewer controls contained, balanced vertical use at large size. This is image-based review, not independent verification or application UI testing.
- One pre-delivery label-offset repair. No post-delivery visual correction. Initial sandbox renderer EPERM resolved by authorized local execution; automatic Chrome discovery skipped until the installed binary was supplied. Final actual browser run passed.
- Screenshot sidecars remain local-only under repository policy. The HTML contains its SVG and is independent of these sidecars. No screenshot capture is being claimed as product behavior evidence.
- No all-controls/export exercise claimed. Main authored language and viewer UI are English, following repository content instructions.

The diagram intentionally groups the scheduler/queue/sender into one logical node. The weather/geocode/nation/warning boundary is represented by existing API; implementation contracts are in the technical design. Proposed subscription reads/writes are web-only; native push is not implied. All relationships have semantic labels.
