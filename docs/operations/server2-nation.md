# Native nation API

The native nation route combines fifteen same-version domestic city replies and
available nationwide air rows. It shares the existing S3 inputs and provider
acquisitions; it never forwards a selected nation request to legacy.

## Setup

Use the existing server2 configuration (`server2/.env`). Add `kma` to
`SERVER2_NATIVE_FAMILIES` for `/v000903/nation/KR`, or `kma-v000901` for
`/v000901/nation/KR`. These are the existing version switches, not new modes.
Provider keys keep their legacy names. S3 remains authoritative; deleting memory
or an optional local cache must not affect correctness. This document describes
implemented routes and local verification, not a production deployment.

## Client behavior

A nation request starts all fifteen fixed-city assemblies with one absolute
three-second deadline. Each source returns the data available for that request;
late acquisition continues independently and is shared by later requests.
A missing optional provider branch does not by itself turn the response into an
error. If an actual city dependency fails, the nation route returns the legacy
rendered 500 error. Successful child replies produce 200.

Province air prefers fresh urban-station means. Otherwise it uses a labelled
representative city point and reports its source and safe reason in `airStatus`.
`coverage: "representative-point"` must not be described as a province mean.
The national provider query is shared with ordinary domestic weather.

## Verified local scenarios

The actual loopback HTTP handler was called with both versions, GET, HEAD and
`If-None-Match`. The test legacy origin was a closed port. All responses remained
native: GET 200, HEAD 200 with no body, and revalidation 304 with no body.

The nation-specific tests also publish raw records to a loopback S3 peer and
reconstruct all seventeen province means twice using new empty-memory sources
with providers disabled. Twelve concurrent requests share one intentionally
slow national acquisition. The first requests return available data within their
three-second budget; the next request includes the newly saved observation.

Run the maintained checks from the repository root:

```sh
cargo test --locked --manifest-path server2/Cargo.toml --test nation
cargo clippy --locked --manifest-path server2/Cargo.toml --test nation -- -D warnings
```

For the offline legacy oracle use pinned Node 16.20.2, Mongoose 5.1.2 and the
legacy async/Jade dependencies. `nation_record.cjs` takes repository and output
paths. It does not load private configuration or contact providers or databases.
Its city weather dependencies are deterministic doubles; it verifies nation
composition, not live weather-provider output.

## Evidence limits

No additional live provider request is claimed: this slice reuses the already
verified national AirKorea method. No AWS IAM/TLS behavior, deployed latency,
cutover, device push, or operational quota is proven by a loopback test.
Native diagnostic error HTML omits the legacy session ID because server2 does
not create legacy session cookies. Exact source and oracle boundaries are in
`server2/tests/nation/PROVENANCE.md`.
