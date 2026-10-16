# S15b-4b3 core replay evidence

The [selected report](replay.json) records an actual owned-loopback **debug library
HTTP example** run at 2026-10-16T10:10:28Z. It uses production Gateway routing and
S3Source with explicit test-only clock/provider injection. It does not exercise
production main startup, AWS/EC2 latency, quotas, deployment or live traffic.

- 55 independent Node-recorded HTTP cases x four fresh-source disk phases = 220
  native responses. Both oracle sides checked 220; status, body bytes and exact
  functional-header union matched with zero unexplained differences.
- 51 canonical acquisition groups (46 grid, two RSS, three middle-range) were
  validated and conditionally published through production S13/CatalogStore.
- Legacy/provider HTTP counts were zero. Disabled acquisition attempts remain
  visible in the per-response audit; zero provider HTTP is enforced by omitted
  provider transports, not a claim that no acquisition method was attempted.
- Warm raw-cache hits and corrupt-copy recovery were observed; loss was replayed
  from S3. The full report retains per-response cache metrics and S3 request count.
- Deliberately perturbing the frozen expected body caused eight unexplained
  differences and was detected. Frozen-baseline timings measure stored-output
  transport only, not execution of legacy collectors or response assembly.

The core inputs exclude station/ASOS observation rows, air, life and image raw
records. Static ASOS mapping is retained. The original 98 dependency-boundary
assembly cases remain a separate denominator. V000705's missing-data GET response
is empty 200. This is not complete domestic S3 parity; rich-input verification
remains required under #2742. READY in the registry advertises tooling only.
Domestic rollback is unsupported; S20 must verify earlier server2 release/config
recovery without legacy dependence.

## Failure history and correction

An early 220-response smoke checked expected header values only. It did not check
extra headers, so its PASS cannot prove the full header contract. A subsequent
strict 55 x four replay found four real HEAD differences: native added
`Content-Length: 0` to v000705 Undefined HEAD replies; legacy omitted it. These
failed local reports remain retained in ignored task records, not relabeled PASS.

An actual HTTP regression reproduced that extra header. The API now returns a
finite unknown-size empty stream only for Undefined HEAD; GET Undefined, JSON
GET/HEAD and conditional 304 passed their wire checks. The first corrected
example still used Axum `fallback(any(...))`, which stripped HEAD bodies again.
Using the actual production `Gateway::router()` removed that verification-host
artifact. The selected report is the subsequent exact-header PASS.

A prior HTTP/1.0 S3 peer run exhausted Mac ephemeral client ports (ConnectError49)
after many fresh source snapshots. Only the owned S3 peer now uses HTTP/1.1 and
TCP_NODELAY, with unchanged validators, requests and Content-Length. No raw input
or production validator was weakened to obtain PASS.

## Reproduction and durable records

The [manual](../../../operations/server2-kma-replay.md) gives build/replay commands.
[Fixture provenance](../../../../server2/tests/domestic/fixtures/S3-RESPONSE-PROVENANCE.md)
records independent collector execution, hashes and limitations. Two fresh Node
recordings were byte-identical; raw inputs and all 55 responses stayed unchanged
when helper/package/static-seed provenance hashes were added.

Focused local checks: actual API HTTP Red then Green, 27 Python shadow tests,
all-target Clippy with warnings denied, and the exact replay/self-check above.
Full unchanged Rust suites were not repeated locally; CI results are recorded on
the PR at the exact candidate. Local debug timing does not establish EC2 cold p95
or a cache speedup. [Capture](replay.png) is rendered from the actual sanitized
report; [manifest](capture.json) binds manual/PDF/capture/report hashes.
