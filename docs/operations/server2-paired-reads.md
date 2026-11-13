# Capture bounded paired public reads

`server2/tools/shadow/paired_read.py` records candidate and production responses
for later comparison. It does not start server2, provision AWS, prove provider
headroom, qualify product parity or authorize deployment. Use Python 3.10+ on
Linux or macOS. No Python packages or credential variables are needed.

The candidate must already be listening on literal `http://127.0.0.1:PORT`.
Production is fixed to `https://todayweather.wizardfactory.net`. Execution uses
GET/HEAD only, a fixed route/coordinate allowlist, one socket at a time and no
redirects, environment proxies or retries. The supplied candidate binary's hash
is checked; this does **not** prove that the listener is running that binary.
The launching operator must verify the process/artifact binding separately.

## 1. Preview a manifest (S1)

Save a JSON manifest in a private working directory. Replace the digest with
`shasum -a 256` of the retained candidate binary. This short example plans two
attempts per origin, with at least one second between all admitted attempts:

```json
{
  "schema": 1,
  "duration_seconds": 120,
  "max_attempts": 2,
  "min_spacing_seconds": 1,
  "candidate_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "cases": [{
    "id": "seoul",
    "method": "GET",
    "path": "/weather/v000903/coord/37.566,126.978",
    "interval_seconds": 60,
    "conditional": false
  }]
}
```

From the repository root:

```sh
python3 server2/tools/shadow/paired_read.py \
  --manifest /private/run/manifest.json --candidate http://127.0.0.1:3000
```

Without `--execute`, the command only validates and prints the plan. It opens no
network connections and writes no run state. It rejects unknown fields, unsafe
paths/methods/origins, more than 168 hours or more than 6,000 planned attempts per
origin. The limit counts admitted attempts, including failures and uncertain
interrupted requests, not just successful pairs. Slower responses or interruption
can reduce actual coverage below the plan; missed slots are not replayed.

## 2. Capture and inspect (S2)

After the parent run's resource, cost, retention and cleanup gates are verified:

```sh
python3 server2/tools/shadow/paired_read.py \
  --manifest /private/run/manifest.json --candidate http://127.0.0.1:3000 \
  --execute --state /private/run/new-capture \
  --candidate-binary /private/run/server2
```

The state directory must not exist on first execution; its parent must exist.
It is created with mode 0700. `ledger.sqlite3` records every admission before
sending; numbered `.body` files contain the raw bytes, and `.json` files contain
status, selected cache headers, byte counts and SHA-256. Timing and terminal
outcomes are in the ledger. A timeout can leave a pending/partial evidence file;
only a completed ledger result establishes a completed attempt. Keep all files
private. No cookies, authorization headers or arbitrary response headers are
retained. Response bodies can contain public API data; do not publish them
without the parent retention review.

Each request has an absolute 20-second deadline and a 2 MiB body ceiling.
HTTP 401/403/429, redirects, oversize bodies and deadline expiry terminate capture;
three consecutive transport/5xx failures also stop it. There is no retry. Other
HTTP errors are retained as incomplete coverage, not turned into parity success.
Provider errors embedded inside HTTP 200 require the parent runtime telemetry and
response analysis; this sampler does not parse provider quota envelopes.

## 3. Interrupt or resume (S3)

SIGINT/SIGTERM stops the coordinator and its current socket. Use the identical
command with `--resume` after an ordinary interruption. Manifest, endpoints,
mode, binary digest and sampler content must match. A pending request remains
consumed, and its entire pair slot is skipped on resume. It is deliberately not
replayed even when its outcome is unknown. A surviving request child holds the
owner lock after coordinator death, so a second coordinator cannot overlap it.
The original start time, deadline and counts persist. Wall-clock rollback fails
closed. Terminal runs (including elapsed duration and quota/transport stops)
refuse resume; do not delete state to bypass the recorded scope.

The final JSON says `qualification: not assessed`. Exit 0 means capture duration
ended or the operator interrupted it; it is not a product PASS. Exit 2 means a
refusal or terminal error. Read `terminal`, per-origin attempts and pending count
before classifying coverage. Preserve the run directory for later analysis and
perform the separate parent AWS cleanup/readback even when this command fails.

## 4. Conditional reads and offline verification (S4)

A case with `conditional: true` must be GET. It uses only a previously captured
ETag or Last-Modified for that same origin and exact path. If none exists, the
ledger records `no-validator` without issuing an ordinary GET instead. Add a
normal GET case earlier in the manifest when a validator seed is required.
HEAD records status/headers with an empty body.

For isolated checks, `--loopback-test --production http://127.0.0.1:PORT` requires
both origins to be literal loopback. It cannot select another public service.

```sh
python3 server2/tests/integration/test_paired_read.py
```

The [illustrated CLI manual](server2-paired-reads/manual.pdf) and its
[editable source](server2-paired-reads/manual.json) show an actual two-origin local
capture. Local fixture success does not establish live provider availability,
seven-day continuity, cost supervision, source-object retention or independent
cloud cleanup. Those remain responsibilities of the parent qualification run.
