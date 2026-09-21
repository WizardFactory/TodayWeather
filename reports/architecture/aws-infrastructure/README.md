# AWS infrastructure diagram verification

This standalone AWS view extends the existing source/code correlation with a resource-centered diagram. It uses the 2026-09-20 sanitized AWS snapshot; no new cloud inspection or software behavior change was required. Archify owns this visual artifact task. The previous service-architecture candidate remains a historical verification record.

Final specification/artifact and evidence hashes are in handoff.json. validation.json reports 9/9 showcase checks, zero errors/warnings. delivery.json binds exact bytes; browser.json records real Chromium checks at 1440x900, 1600x1000, 1920x1080 and 2048x1320 with light/dark endpoint captures. Main inspected final 1440 light and 2048 dark images; the same geometry was also reviewed in the inverse themes before a region-wording precision correction.

Semantic review: Route53 CNAME -> CloudFront; weather/geocode -> REST production -> four grouped Lambda handlers; coordinate-weather Lambda -> service hostname/EC2; direct default/push -> service EC2; photos -> S3; active KAQ EventBridge -> copy Lambda -> S3. Public Lambda geocoding uses DynamoDB. Address-weather handler is unsupported501. Mongo-named host is inventory without an asserted network connection. Dashed KAQ consumer mapping does not claim verified EC2 mode/bucket. External providers and unrelated account resources are intentionally outside this AWS view.

Git checks confirm all HTML/JSON, including visual-check sidecars, remain included and only visual-check PNG images are ignored. Architecture local links and whitespace checks pass. No product tests or independent/cross-provider review are claimed for this visual-only addition.
