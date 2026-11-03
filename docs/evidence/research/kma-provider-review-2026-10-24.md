# Korean provider and S3 documentation review

Reviewed on 2026-10-24 KST for the
[acquisition and retrieval proposal](../../architecture/server2-kma-data-design.md).
Repository baseline: `82f7a4838dda046be966ee9c25c9cb66561d099d`.
Public official pages and attached specifications were retrieved; no authenticated
weather-data request, S3 operation, build or latency experiment was executed.
The distinction between a documented feature and a working, value-equivalent
automatic acquisition path is intentional.

## Review scope

The review covers the Korean weather products needed for current weather,
short/ultra-short/mid forecasts, historical hourly cloud/precipitation phenomena,
daily extrema/rain, station metadata and S3 storage. Life indices, air quality,
foreign providers and an exhaustive inventory of unrelated KMA APIs are outside
scope. Public page headings can retain old descriptions; endpoint tables and
dated attachments take precedence for their own product/version.

The current public short-service ZIP contains a guide named
`단기예보조회서비스_API활용가이드_261019.docx` and a 2610 grid-coordinate workbook.
The guide was extracted and read, including request fields, categories,
precipitation codes, publication/availability tables and extended forecast
intervals. The workbook was identified, not audited row by row. This review
does not claim every grid's references have been generated. [1] [16]

## Provider matrix

| Family | Officially documented request shape and useful fields | Acquisition/design consequence | Qualification still needed |
| --- | --- | --- | --- |
| Point ODAM | `getUltraSrtNcst`, grid/base time, category rows, pagination. Latest guide describes generation after HH10 and subsequent 10-minute updates. Current categories exclude SKY/LGT. [1] [2] [16] | Fetch all required categories/pages for one applicable publication, retain fetch revisions. Good current/recent grid observation input. | The usage guide limits ordinary base-date lookup to recent one day; no seven-day range is established. [6] |
| Point VSRT | `getUltraSrtFcst`, grid, hourly `:30` base, six valid hours; SKY/PTY/LGT and weather fields. Guide availability is after `:45`, with ten-minute updates to temperature/humidity/wind. [1] [2] [16] | Preserve issue time separately from valid time and fetch time. Keep original categories and code/text semantics. | Which archived vintage reproduces the existing first-valid fold; current point-history reach and actual publication lag. |
| Point SHRT | `getVilageFcst`, eight daily issues at 02/05/08/11/14/17/20/23, availability after ten minutes; near hours and extended three-hour periods differ. Extended PCP/SNO/WSD can be qualitative codes. [1] [16] | Retrieve the complete relevant latest issue for future weather. Check today-extrema/elapsed-hour coverage separately. Never interpret qualitative rain as an exact amount. | Required page count/bytes per selected publication; source-equivalent today's extrema fallback. Historical use is excluded by AK's new source constraint. |
| APIHub grid ODAM/VSRT/SHRT | `nph-dfs_odam_grd`, `nph-dfs_vsrt_grd`, `nph-dfs_shrt_grd`: variable-specific grids with publication and, for forecasts, valid time. Grid VSRT and recent ODAM are ten-minute products. [2] | Potential cross-grid batch sharing for a sufficiently large active grid set. A variable/time full-grid download is not one all-fields/all-times call. | Retention for requested past issues, response bytes, missing masks, exact grid alignment, entitlement and numerical/vintage equivalence to point APIs. Historical-looking examples do not establish seven-day availability. |
| Mid-range | Separate land, temperature and outlook families/region identifiers. Official point service documents 06/18 issues; APIHub also exposes period-query products. [3] [17] | Land+temperature are at least two logical acquisitions, plus outlook where actually used. Reuse natural regions across towns. | APIHub overview and point page describe horizons differently; preserve baseline D+10 output and qualify actual endpoint payloads rather than extending the public response. |
| ASOS JSON hourly | `AsosHourlyInfoService/getWthrDataList`, station/start/end day/hour, category/QC fields and pagination; portal says through D−1. [9] | One selected station's seven-day interval fits the existing adapter's 999 rows/page by nominal hourly count, if complete; not 168 separate hourly HTTP calls. | Actual rows, QC/null behavior, winter rainfall gaps, latest daily lag and exact station equivalence. Current adapter maps cloud but not PTY/LGT. |
| ASOS JSON daily | `AsosDalyInfoService/getWthrDataList`, station/date range and pagination; portal says through D−1. Official daily extrema, rain and other aggregates. [10] | Small historical daily-range acquisition. Official extrema remain distinct from extrema sampled at hourly resolution. | Publication lag, missing fields and when the current missing-only daily policy permits their use. It does not contain hourly/AM-PM phenomena. |
| APIHub ASOS | `kma_sfctm3.php` supports a station period, maximum 31 days. Hourly outputs include cloud, current/past phenomena and snow/rain. `kma_sfcdd3.php` is a daily period product. [4] | Strong batch candidate for measured historical cloud/phenomena; share a station range across dependent grids. | Field mappings, QC, units, measurement intervals and parity with existing JSON/web inputs. A broader measured field set is not proof of identical legacy values. |
| APIHub AWS | Minute `nph-aws2_min` and cloud/phenomena variants support intervals subject to documented limits: one station at most a day, all stations at most ten minutes. `awsh.php` is a timestamp/variable table; `sfc_aws_day.php` accepts an interval per element. AWS cloud is in eighths, ASOS cloud in tenths. [4] [5] | Useful current refinements and measured fallback candidates. A week's minute query needs permitted chunks; do not assume `awsh.php` is a one-call seven-day range. Cloud scales require endpoint-specific mapping. | Observation-site coverage, exact rain duration/cumulative semantics, phenotype codes and current-source equivalence. No substitution of averaging/statistics for a current point value. |
| VSRT file archive | Official archive documents historical forecasts since 2010-06 through the day before lookup. File-query time is UTC; issued hourly `:30` forecasts are distinguished from native forecast lead time. [7] | Candidate source for seven-day missing grid SKY/PTY/LGT when station observations cannot reproduce it. Preserve raw archives and all required vintages. | Documented archive presence is not an authenticated automatic download, stable programmatic contract or bounded download latency. Exact files/pages/bytes and latest archive availability need a bounded experiment. |
| ODAM file archive | KMA's usage article describes files through the previous month, UTC and a historical analysis-to-representative-AWS transition. The current archive description corroborates the transition and UTC. [6] [8] | Do not use the monthly archive to promise all of the most recent seven days from empty S3. Old analytical values and later AWS values are different inputs. | Current account-accessible release lag and automation; no claim of a verified recent-week continuous archive. |
| Reference metadata | `stn_inf.php` takes a reference time and supplies station coordinates, type, elevation and identifiers. Grid coordinate/reference files and forecast zones are separate metadata products. [2] [11] [16] | Version public metadata and preserve historical station validity/ordering. Compile grid candidate plans locally; resolve exact town-dependent choices at runtime. | Complete grid/town/region mapping, boundary/tie fixtures, metadata update procedure and provenance/license audit. |

The automatic cold plan should first select the smallest **value-qualified**
range/page set covering the required fields. It cannot choose a convenient ASOS
station in place of the selected grid or use ten-minute APIHub values in place
of an hourly point vintage without comparison. APIHub and data.go.kr are KMA
distribution surfaces; naming them different providers does not prove
independent failure domains or identical values.

## Historical feasibility and compatibility

The review supports three different availability statements:

1. Historical station hourly/daily periods are documented. They can reduce call
   count substantially for measured fields, subject to real coverage/QC. [4] [9] [10]
2. Seven-day historical ultra-short forecast files are documented in the archive
   period, but an automated value-equivalent request path and its timing have
   not been demonstrated. [7]
3. The ordinary point ODAM endpoint is not documented here as a seven-day
   historical source; the official usage article states recent one day. [6]

Therefore a first request with no accumulated raw history cannot yet be promised
complete, fast historical SKY/PTY/LGT for every grid. Continued capture improves
future requests but is not a substitute for the requested empty-S3 scenario.
No “warm it for seven days first” precondition is hidden in the proposal.

The 261019 guide's within-publication updates strengthen the need to retain
both base/valid times and acquisition revision. A new request for an old period
can return different corrected data; preserving all newly fetched bytes alone
does not recover an earlier unavailable vintage. [16]

Repository inspection adds constraints independent of official API availability:

- `server2/src/domestic/kma/source/stn.rs` selects a city station and a nearby
  rain neighborhood at the town coordinate. `source/observe.rs` selects the ASOS
  recovery station with a different metric. Precomputed grid-center replacement
  is not exact-value preserving.
- `source/asos.rs` and `policy.rs` have QC, winter-rain exclusion and first-valid
  field folding. API response completeness is not field coverage completeness.
- `mid.rs` AM/PM aggregation uses hourly SKY/PTY/LGT and the existing midnight
  convention; a single daily cloud average cannot reproduce two half-days.
- The historical short-derived daily overlay in `mid.rs` needs a compatibility
  audit against AK's measurements/ODAM/VSRT-only rule. A non-equivalent result is
  a failed gate, not a permitted public-value change.
- `summary/grid.rs` persists D−6..D−1 with a before-01:00 guard. D−7 and a fully
  completed yesterday must be verified separately.

## S3 behavior

AWS recommends measuring network, CPU and memory together, using bounded
parallelism/ranges, and keeping compute/storage in the same Region. These are
techniques, not a service p95/p99 guarantee. Small-object medians from AWS
guidance must not be promoted to this application's tail latency. [12]

S3 supports a selected byte range per GET, not several disjoint ranges in one
request. Independently compressed full raw frames and contiguous coalescing
are necessary if packs are to reduce request count. A monolithic compressed
archive or one GET for each member can defeat that purpose. [15]

Conditional immutable creation and ETag-based CAS can protect individual
objects. Strong read-after-write consistency does not provide an atomic
transaction across raw, several catalogs and a grid head. Preserve the complete
group publication protocol and revalidate source dependencies. [13] [14]

## Initial design comparison and source checks

Three independent candidate agents and a fresh judge used the same frozen
requirements and baseline. All used the exposed provider; this was not a
cross-provider comparison. Their maintained outcome is recorded here so this
document does not depend on local-only candidate files. The later manual-backed
reassessment below narrows the initial implementation scope; this table records
the earlier comparison, not the revised serving dependency set.

| Candidate | Decision | Reason |
| --- | --- | --- |
| A: deterministic day catalogs + canonical raw | Required correctness/bootstrap/fallback path | Smallest semantic change; raw-body fan-out and replay CPU can remain large |
| B: natural-owner shared raw packs + grid references | Selected conditional accelerator | Shares station/national bodies; preserves raw-only contract; additional controls, ranges and memory must earn their cost |
| C: per-grid full raw bundle | Rejected as default | Repeats shared full bodies across grids, dates and correction generations; useful single-input-closure RAM approach retained |

The source check verified `Catalog::union` rejects changed envelopes for an
existing raw identity. Pack locators therefore belong in a separate immutable
representation overlay. `ObjectTransport` currently has no Range method.
Complete-group eligibility still requires owning/sibling catalogs. A prepared
grid manifest alone cannot authorize serving its old revision set as current.

For a no-conflict newly published group with n raw members and c catalogs,
`CatalogStore::publish` currently performs 1+n+c PUTs and 3c+n GETs, excluding
quota/probes/repair/retries and optional pack work. The raw publish/verification
loops are sequential within a group today; product parallelism is not evidence
that those loops run concurrently. These are source-derived operation counts,
not measured latency. Source: `server2/src/storage/catalog.rs:835` and
`server2/src/storage/store.rs` at the recorded revision.

## Manual-backed reassessment

The [manual-backed reassessment](kma-storage-reassessment-2026-10-24.md) adds
independent requested Opus and GPT-5.6 max investigations and a fresh judge.
The selected revision uses existing canonical
raw/catalog replay and one shared RAM closure as the initial baseline. Optional
packs need a private byte-loader seam before canonical body GETs; grid heads and
v3 day locators are deferred until complete discovery and cost are qualified.

The original ASOS partition includes both range ends. Thirteen possible start
dates does not imply thirteen original catalogs. Revalidating listed owners
cannot reveal a new unlisted original range, and ordinary post-publication hint
invalidation is not a crash-safe coverage protocol. Until such a protocol is
proved, bounded original discovery remains necessary and its LIST/control and
actual revalidation costs must be counted. The earlier review already required
coverage/invalidation proof; this is a sharper interface and initial-scope choice.

History-source/vintage and past SHRT-overlay gates remain open. These were already
recorded by the initial proposal; neither a manual nor model agreement establishes
automatic complete acquisition, numerical parity or p95/p99.

## Retained identities and verification limits

Selected attachment identities allow a future reviewer to distinguish changing
official downloads. Raw HTML, downloads, extracted text and the source register
remain in ignored task research; this maintained record has no local-only link.

| Retrieved artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Official short-service 2610 ZIP | 1,055,225 | `9dfd7dc2d422318154d3484fb00142afa3c5271fc14d079adf997043a14b86ba` |
| Contained 261019 DOCX | 477,542 | `ca0852d26854d9a010cc583f13949975077330726054f47ad67c66a48421721f` |
| APIHub short page HTML | 193,559 | `f52b7b66f7ad1f0c308b57cb403792b9f90298fa6904edef1f3de903726e3457` |
| APIHub AWS page HTML | 334,150 | `4c964dfa7cb99c9387d89d5753a413d77c97044b7a80ee10704bc6d647d63c90` |
| VSRT archive page HTML | 159,398 | `3e65291b96d998dc4724194e9aef18f1f7b110c5c4d294f14592d39dc739ff93` |

Checked: retrieval of these official documents, short guide text extraction,
relevant endpoint/retention/time/field descriptions, selected current code and
design alternatives. Not checked: authenticated archive/data delivery, per-grid
provider numerical equivalence, account quota/entitlements, a real empty-S3
acquisition, deployment latency/RSS, migration, or actual p95/p99. The proposed
benchmark separates complete/partial responses, faults and the empty/populated
S3 and RAM/disk cohorts. Citation checking verifies references/quote presence;
it does not prove API availability or numerical equivalence.

## Deliverable checks

The initial same-provider comparison and later independent Opus/GPT-5.6 review
were separately adjudicated. The [maintained reassessment](kma-storage-reassessment-2026-10-24.md)
records the final choices, additional official ASOS guide identities and checks.
Original v2 group ownership remains unchanged; grid/day accelerators are deferred,
and pack reads must replace the actual canonical byte load. Provider feasibility
and numerical-value qualification remain open.

The diagram is specification evidence, not an implemented server2 path. Archify
validation, delivery, strict artifact and real Chrome browser gates passed.
Final HTML SHA-256: `cc28ce9cad444aa641bf9586460a027db6d18f4e17278021197ca4a773beff68`;
source JSON: `48d655561d6b77aaa94ea0bdd990356f6cfee3ac635ccb723dd3742face4a4a7`.
Capture checks passed for both themes and viewports; 1440-light and 2048-dark
captures were visually inspected. Receipts remain local/ignored, with adjacent
delivery provenance preserved. Maintained links do not require those local files.

The original 17-source register retains matched excerpts; additional focused
sources and final local-link/artifact-policy checks are recorded by the later
reassessment. These checks do not establish working automatic archives, public
value parity, performance, deployment or implementation.

## Sources

[1] https://www.data.go.kr/data/15084084/openapi.do — KMA short and ultra-short forecast service
[2] https://apihub.kma.go.kr/apiList.do?seqApi=10 — KMA APIHub short grid and point specifications
[3] https://www.data.go.kr/data/15059468/openapi.do — KMA mid-range forecast service
[4] https://apihub.kma.go.kr/apiList.do?seqApi=2 — KMA APIHub ASOS hourly and daily ranges
[5] https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=239 — KMA APIHub AWS minute cloud phenomena and daily data
[6] https://data.kma.go.kr/community/nuriLovePopup.do — KMA grid data usage guide 2025-05-16
[7] https://data.kma.go.kr/data/rmt/rmtList.do?code=410&pgmNo=571 — KMA ultra-short forecast historical files
[8] https://data.kma.go.kr/data/rmt/rmtList.do?code=400&pgmNo=570 — KMA ultra-short observation historical files
[9] https://www.data.go.kr/data/15057210/openapi.do — KMA ASOS hourly JSON service
[10] https://www.data.go.kr/data/15059093/openapi.do — KMA ASOS daily JSON service
[11] https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=317 — KMA station metadata including historical time
[12] https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html — AWS S3 performance guidelines
[13] https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html — AWS S3 conditional writes
[14] https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html — AWS S3 consistency model
[15] https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html — AWS S3 GetObject range and version semantics
[16] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007732424&fileDetailSn=1 — KMA short service guide 261019 in public 2610 ZIP
[17] https://apihub.kma.go.kr/apiList.do?seqApi=10&seqApiSub=287 — KMA APIHub mid-range products
