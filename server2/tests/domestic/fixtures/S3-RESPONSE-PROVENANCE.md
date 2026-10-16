# Canonical S3 core response oracle

`s3-response.json.gz` is produced by the verification-only recorder in
[`server2/tools/golden/kma_s3`](../../../tools/golden/kma_s3/). The recorder executes
legacy collectors, document savers and HTTP routers under Node 16.20.2 and
Mongoose 5.1.2. It never consumes Rust-converted documents or native response
bytes as expectations. It rejects private inputs and network connections except
its own literal-loopback HTTP servers; database reads/writes use an in-memory
boundary double. No legacy source is changed or imported by the new runtime.

The decompressed fixture embeds hashes of the legacy files actually read,
recorder/helper JavaScript, dependency package manifests and public static ASOS
mapping seed. Provider-shaped raw inputs are embedded alongside independently
recorded HTTP responses, functional headers and dependency trace digests. The
clock is fixed at `2026-09-24T06:31:00.000Z`; locale is sent per request. Two fresh
recordings were byte-identical. Adding provenance hashes left all raw inputs and
55 expected HTTP responses unchanged. The replay manifest binds the gzip SHA256.

The shared corpus contains 51 canonical acquisition groups: 46 grid, two RSS and
three middle-range groups. Native preparation uses the production S13 inspectors,
canonical identities, pagination completeness and conditional CatalogStore
publication. Station/ASOS observation rows, air, life and image inputs are absent;
legacy missing-data semantics are used. Static station-to-ASOS mapping is retained.

There are 48 GET cases (four direct route versions x six locales x two unit sets),
four HEAD cases and three conditional GET cases. The v000705 missing-data GET
response is an empty 200, not a rich-weather result. Four fresh-source disk phases
produce 220 candidate responses. The original 98 synthetic assembly cases remain
separate; see [coverage](ASSEMBLY-COVERAGE.md). This core is not complete domestic
parity, production startup or cutover evidence. A later rich-input increment must
supply station/ASOS observations, air, life and image acquisitions and repeat the
independent conversion, whole-response and recovery checks.

To record, provide pinned Node and dependencies matching the legacy package
versions, plus Mongoose 5.1.2. Use an ignored output path and an isolated environment:

```sh
TZ=UTC NODE_ENV=production NODE_PATH=/owned/oracle/node_modules \
  /owned/node-v16.20.2/bin/node server2/tools/golden/kma_s3/record.js \
  "$PWD" "$PWD/reports/kma-core-new.json.gz"
```

The recorder refuses the committed fixture directory as an output destination.
Review decoded raw inputs, responses and provenance before deliberately updating
the fixture and its replay-manifest digest. Production `.env` is never needed.
