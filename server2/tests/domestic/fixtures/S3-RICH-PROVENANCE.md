# Rich whole-response fixture provenance

This fixture records independently executed current legacy collectors, Mongoose
writes/readers, HTTP assembly and the actual repository gateway/router. Only the
named offline recorder exception reads `server/`. The Rust runtime/build does not.
No external Lambda, live provider, production DB/AWS or private `.env` was used.
Expected status, functional headers and body bytes are never taken from Rust.

## Identity and reproducibility

- Fixture SHA256: `9057374928813cc5568bafebbaee19f84021faa3bb5a9d8877846acf4f01ff17`.
- Fixed clock: `2026-10-15T13:05:00.000Z`.
- Node 16.20.2, Mongoose 5.1.2, Express 4.13.4; exact dependencies and integrity
  records: [package](../../../tools/golden/kma_s3_rich/package.json) and
  [lock](../../../tools/golden/kma_s3_rich/package-lock.json).
- Two fresh recordings produced byte-identical JSON and gzip. Initial exploratory
  NODE_PATH selected async 2.1.4; final isolated dependencies select legacy/S02
  async 2.6.2. All 23 expected wire responses stayed unchanged.
- The fixture's `source` maps retain every executed legacy file, helper, dependency
  package and public static-input hash. `rich_inputs` preserves actual casted
  collector operations; `raw` / `rich_raw` are the inputs to canonical publication.
- [Adaptation manifest](../../../tools/golden/kma_s3_rich/adaptations.json) keeps
  historical body/hash mismatches distinct from current executed-source hashes.
  Nine of twelve old embedded helper claims were unverified; they were not
  relabeled as valid provenance. Current expected output executes pinned source.

From a clean checkout, install the offline dependencies in the recorder directory
(`npm ci --ignore-scripts --no-audit --no-fund`), then run from the repository root:

```sh
TZ=UTC NODE_ENV=production node server2/tools/golden/kma_s3_rich/record.js \
  "$PWD" reports/kma-rich/record.json.gz
```

`node` must be 16.20.2. The recorder refuses external network and private config
reads, loads synthetic boundary config and starts only owned loopback HTTP peers.
No production startup, gather endpoint, MongoDB or deployment command is executed.

## Raw and canonical boundaries

Public synthetic raw dates/regions shift before actual legacy conversion. Three
real grid locations (Seoul, Incheon, Jeju) use the same raw values with declared
nx/ny substitutions. The canonical example runs normal S13 request validators,
S08 synthetic funding and complete conditional CatalogStore publication; it does
not invent accepted envelopes or relax a production validator.

| Rich family | Acquisitions |
| --- | ---: |
| air-dust | 11 |
| air-images | 1 |
| air-observations | 28 |
| air-stations | 2 |
| asos-daily | 1 |
| asos-hourly | 1 |
| aws-hourly | 4 |
| aws-minute | 4 |
| city-observation | 3 |
| kasi | 102 |
| life-flowerPine | 25 |
| life-flowerWeeds | 25 |
| life-flowerWoody | 25 |
| life-ultrv | 93 |
| mfds | 9 |

There are 148 additional grid/RSS/middle-range groups. The rich acquisitions yield
336 records (334 groups); stored Google fallback is a separate canonical air
record. ASOS raw is intentionally incomplete: 173 accepted rows, 3 rejected by
normal QC, with missing hourly/daily rows retained. The two valid synthetic GIFs
are about 149 KB each and decode 960 rows; they do not measure production 5-6 MB
images. Station timestamps come from the captured collector save order. Actual
Mongoose `$set` proof shows newer AWS values overwrite present fields and retain
omitted city weather/cloud; the recorder applies that wire behavior.

AirKorea-missing Jeju exercises the actual legacy Google provider chain using a
public reconstructed Google body and synthetic funding, then the actual stored
fallback reader. One scripted in-process acquisition occurs during recording.
Native weather recovery reads the same raw body from canonical S3. KAQ archive
rows are absent; explicit `kaq` requests exercise legacy's stored-AirKorea fallback.
Valid KAQ archive cases remain covered by the separate assembly corpus.

## Response denominators

23 unique inputs cover four direct versions, Korean/English, requested units,
`kaq`/`airkorea`, regional conditions, HEAD, conditional GET and two actual
`/weather/v000903/coord` requests. Four fresh-source disk phases produce 92
native responses: 84 direct responses plus 8 coordinate responses. Core55×4 and
original98 assembly-only cases retain separate counts and scope.

Each coordinate response uses the production Gateway router and real native
geocoder factory with one owned loopback Kakao HTTP response; its exact coordinates
remain memory-only. Weather-provider HTTP, external HTTP and legacy HTTP are zero.
This distinction is explicit in the manifest and observed per response. No
geocoder warmup or persisted exact-coordinate cache hides the cold lookup.

The accepted comparison is exact status/body/functional-header union. Only named
transport/session headers differ. No response normalization hides rounding,
HEAD framing or missing fields. See the [manifest](../../integration/fixtures/kma-rich-replay.json)
and [operation guide](../../../../docs/operations/server2-kma-rich-replay.md).
