# Rich whole-response verifier contract

Consumes the [intent](../intent/issue-2742-s15b4b3-rich.md) and follows core #2788.

RICH_PARITY: run current legacy collectors, parsers, savers and HTTP assembly in
pinned Node16 over public synthetic/provider-format raw inputs. Use actual legacy
reader answers from those saved documents at the isolated response DB boundary.
Never use Rust-derived documents or response bytes as expectations. Align dates
at raw generation before either pipeline; preserve raw/source/helper/package/
clock/locale/output hashes and prove two fresh recordings deterministic.

CANONICAL: native preparation validates each acquisition with the production
request/inspector contract, then uses real RawRecord identities, publication
periods, partitions and pagination with conditional CatalogStore writes. Include
AWS minute/hourly and city HTML, ASOS hourly/daily, AirKorea list/observations/dust,
UV/pollen, KASI sunrise/sunset, MFDS risk, valid calibrated GIFs and a durable
fallback provider observation. Seeder preparation is isolated test data setup,
not production precollection. Do not relax validators or invent canonical rows.
Native request readers get no warmup, empty RAM and disabled provider transports;
count legacy/weather-provider/external HTTP and attempted disabled acquisitions
separately. Two actual production-Gateway coordinate cases additionally resolve
their public coordinates with exactly one owned-loopback geocoder HTTP call each,
using the native factory/parser/quota; this is an explicit manifest acquisition
difference, not weather recollection or geocoder warmup.

RECOVERY: reuse the core four disk phases with fresh source per HTTP case. Cache
corruption/loss must recover through canonical S3 without altering status, headers
or body. Bounds/timeout failures are failures or actual legacy missing-data
outcomes, never hidden forwarding. Report local debug timings with actual build
hash; they do not prove production startup, AWS/EC2 p95 or live shadow.

ACCOUNTING: rich IDs/conditions and results are distinct from core55 and
assembly98. Missing/extra/duplicate cases fail. Compare functional header union
exactly; only declared transport Date/Connection/Set-Cookie/server differences
may be classified. No Content-Length/ETag/body normalization. Force perturbation
self-check and retain actual failed inputs/results before correction. Registry
supports replay/smoke/cache recovery only; rollback remains unsupported and S20
must verify earlier server2 release/config recovery without legacy dependence.

No runtime edit is initially declared. If a valid raw combined case exposes a
boundary defect, reproduce it, coordinate the owner and amend exact path scope
before fixing. Existing focused component coverage may be reused, but it cannot
replace whole-response evidence or count toward the rich HTTP denominator.

Approved reproduced production fixes (paths declared before edits): first-fresh
KASI restore before snapshot; bounded8 area reads with AREAS-order apply and
unchanged partial-error/nearest-location policy; latest same-hour AWS/city fold
with actual Mongoose `$set` field presence; image restore alongside observations
within the original combined deadline/200ms reserve. No additional provider
policy, query horizon, response normalization or cache type is added. Owned test
peers opt into connection reuse while preserving default/fault behavior and the
existing16-slot/2s hard connection bounds.
