# Plan for the scheduled AirKorea image forecast

Task declaration: `server2/config/tasks/KMA-IMAGE-PRODUCTION.json`. Follows `plans/issue-2614-kma-request-bound.md`.

1. Keep the requested province name for `regionName` while the lookups use the listed name.
2. Store a fold as a product (rows as runs, with what it was made of), and read it back exactly.
3. Produce on the process timer: fold the stored acquisitions (or reuse the last product when it was made of the same), acquire the missing announcement, store when something changed.
4. Let observed requests read only the newest product, cutting the rows old by their instant.
5. Wire the timer from the runtime into the bound process, only with an AirKorea acquirer.
6. Update the architecture, data design, diagram and operations documents.
7. Open a draft PR and take it through CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user in Gangwon | See the region name they asked for | Geocoder answers `강원특별자치도` | Request weather | Town and mid forecast found; `regionName` is `강원특별자치도` | KR remap to the new name: same answer | REGION |
| App user anywhere | See the hourly dust forecast without waiting | Process with an AirKorea key started | First request, production, later request | First answers without images and starts nothing; later reads the product | Acquisition fails: request keeps the legacy missing answer; next production retries | PRODUCE, READ |
| Operator | Restart without decoding again | Product stored, nothing new | Start a new process | It reads the product; its first production stores and decodes nothing | Product stale: the production decodes the stored acquisitions once | PRODUCE |
| Operator | Fold images another host stored | Images stored, no product | Request, then production | Request reads no image; production stores the legacy fold | Images outside the window: an empty product | READ, LEGACY |
