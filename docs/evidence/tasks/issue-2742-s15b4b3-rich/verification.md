# Rich canonical S3 response verification

Dated 2026-10-16 UTC. Final main-aligned debug example SHA256
`2dbd1811fc9ea020e5864b909e342872b7b851fcd36328ca62aa60d1a336662e`;
base d2137b2e integrated at c5d69506, authored working-tree bytes recorded below. Local debug example with fixed clock and owned loopback S3,
HTTP and geocoder peers; no production startup, live provider/DB/AWS/push or
external Lambda execution. Independent Node16 source/driver/dependency/raw hashes
are retained in the fixture and its provenance.

- Frozen Node16 recordings with isolated async2.6.2 dependencies were byte-identical:
  gzip SHA256 `9057374928813cc5568bafebbaee19f84021faa3bb5a9d8877846acf4f01ff17`.
  All 23 expected responses were unchanged from the exploratory async2.1.4 run.
- Canonical publication: 148 grid/RSS/mid groups; 334 rich groups / 336 records;
  one separately stored Google air fallback. Normal production validators and
  conditional CatalogStore publication were used without bypasses.
- Actual paired S19 rich replay: 23 unique cases x 4 phases = 92 responses on
  each side; exact status/body/functional headers matched, unexplained differences0.
  Deliberate body perturbation produced8 unexplained differences and was detected.
- All84 direct responses required zero provider/legacy/external HTTP. Eight actual
  coordinate responses each acquired one owned-loopback Kakao reply through the
  native geocoder factory/parser/quota; weather-provider/legacy/external HTTP0.
  Exact request coordinates remain memory-only. Disk hits/corruption were observed.
- Original98 assembly-only cases and core55x4 remain separate; this evidence does
  not promote injected DB1/coercion/error inputs into canonical providerraw cases.
- Actual local debug p95: cold1885.76ms, warm1884.17ms, corrupt1863.69ms,
  lost2046.26ms (23 responses each). These are owned-loopback measurements, not
  production EC2/release p95 or provider quota/shadow evidence.

Earlier failures were retained, not relabeled: initial6x4 had189 field differences;
first KASI restoration reduced these to8; actual Mongoose `$set` and newest-hour
station folding fixed all24. Expanded23x4 first reached86/92 due a synthetic
geocoder-funding setup limit, then88/92 with4 genuinely late cold partial responses.
The accepted minimal KASI bounded8 and image/observation overlap fixes preserved
one3s deadline/200ms reserve and passed the later actual92matrix and S19 replay.

Focused regressions cover first-fresh KASI, oldest-location policy, same-hour
station field presence/order and image recovery while observations exhaust the
same budget. Python shadow tests31PASS. New owned test-peer framing/reuse/HEAD/
204/CAS/drop-commit controls passed for default and persistent connections. Test
infrastructure failures (ephemeral-port EADDRNOTAVAIL, transport partial outputs,
new array-access assertion setup) remain in ignored task evidence; final focused
check receipts and CI/review are recorded in the PR rather than inferred here.

The setup uses ~149KB synthetic valid GIFs, not production5-6MB images. ASOS raw
retains173 accepted/3 QC-rejected and missing rows. KAQ archive absent cases only
exercise current legacy stored-AirKorea fallback. Rollback remains UNSUPPORTED;
S20 must verify earlier server2 release/configuration recovery, actual main/musl
startup, quota headroom and seven-day live shadow. Issue#2742 remains open.

See [actual replay report](replay.json), [result capture](replay.png),
[operation guide](../../../operations/server2-kma-rich-replay.md) and
[fixture provenance](../../../../server2/tests/domestic/fixtures/S3-RICH-PROVENANCE.md).
