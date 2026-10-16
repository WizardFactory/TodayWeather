# Domestic canonical S3 core replay

This tool compares independently recorded legacy HTTP responses with native
responses rebuilt from canonical S3 records. It is an offline core verifier for
grid, RSS and middle-range inputs. Station observations, ASOS observation rows,
air, life and image inputs are explicitly absent. The complete domestic parity
goal remains open in issue #2742; a separate rich-input corpus increment follows.

## Build and replay

Use the pinned Rust toolchain and Python 3.11. From the repository root:

```sh
cargo build --manifest-path server2/Cargo.toml --locked --release
cargo build --manifest-path server2/Cargo.toml --locked --release \
  --example kma_s3_replay
python3.11 server2/tools/shadow/replay.py \
  --binary server2/target/release/server2 --family kma --self-check \
  --report reports/kma-core/replay.json
```

Both binaries must be in the same build profile directory. The family tool runs
the adjacent `examples/kma_s3_replay` executable, records its SHA256 before and
after execution and refuses a changed artifact. The selected `server2` binary is
an artifact-directory anchor; this workload starts the library HTTP example,
not the production main process. The CI build uses release artifacts. The dated
local evidence linked below used a debug example and must be described that way.

No production configuration, provider keys, `.env`, database or AWS access is
used. The helper starts owned loopback S3, frozen-baseline and native HTTP peers,
then deletes its disposable cache directory. It prepares only the isolated test
fixture; this does not implement production precollection or a runtime test mode.

## Scenarios and result

The frozen Node 16.20.2 recorder independently runs legacy collection, document
conversion and HTTP assembly. Native fixture publication runs production S13
validators and conditional CatalogStore writes. Every request gets a fresh
S3Source and empty RAM, with no request warmup. Provider transports are disabled
by construction; attempted disabled acquisitions are separately reported.

| Phase | Initial disk state | Expected behavior |
| --- | --- | --- |
| cold-empty-ram-and-disk | Empty | Rebuild from canonical S3 |
| warm-disk-empty-ram | Verified raw copies | Use validated copies with unchanged response |
| corrupt-disk-empty-ram | Truncated copies | Detect corruption and recover from S3 |
| lost-disk-empty-ram | Removed copies | Recover from S3 |

The workload contains 55 unique cases: four direct route versions, six locales,
two unit sets, HEAD and conditional GET. Four phases yield 220 native responses,
not 220 independent inputs. Status, exact body bytes and the union of functional
headers must match; Content-Length and ETag remain part of the contract. Date,
Connection, Set-Cookie and the frozen HTTP server header are explicitly declared
transport differences. Missing, extra or duplicate records fail the run.

PASS requires all expected cases, zero unexplained differences, exercised disk
hits/corruption, zero legacy/provider HTTP calls and successful deliberate
baseline perturbation detection. The original 98 assembly-oracle scenarios are
reported separately and must never be added to the S3 whole-response denominator.
Gateway v000902/unversioned and unknown-town behavior retain separate tests.

The smoke entry point uses the same family and exact functional-header check:

```sh
python3.11 server2/tools/shadow/smoke.py \
  --binary server2/target/release/server2 --family kma \
  --report reports/kma-core/smoke.json
```

## Capabilities and limits

The S19 registry advertises smoke, replay and cache recovery support. READY in
that registry means these tool capabilities only. Domestic rollback is
UNSUPPORTED and fails closed. S20 must verify recovery to an earlier server2
release/configuration without requiring legacy; this tool does not deploy or
exercise that procedure. Existing gateway coexistence rehearsals remain separate.

Owned-loopback elapsed times do not establish AWS/EC2 cold p95, production
startup, provider quotas or seven-day live shadow. Frozen-baseline RTT is only
transport time for stored Node output, not legacy execution time. No local cache
speedup is implied merely by fewer raw GETs. This core does not verify a rich
weather response, image decoding, production main startup or all native versions.

See [selected evidence](../evidence/tasks/issue-2742-s15b4b3/verification.md),
[fixture provenance](../../server2/tests/domestic/fixtures/S3-RESPONSE-PROVENANCE.md)
and the [sequence diagram](../architecture/diagrams/server2-kma-replay.html).
