# S04 foundation contract

- Public GET/HEAD /health returns200 exact `OK`, text/html; charset=utf-8, CORS*.
  HEAD returns no body and Content-Length2. This foundation preserves that operational
  health subset; session cookies/Express middleware headers await S02 oracle checks.
  Public /internal/metrics returns404; no weather route is mounted.
- Internal GET /internal/metrics binds only loopback. Invalid/nonloopback metrics
  addresses, zero/excessive limits and bind collisions fail startup.
- Socket admission caps public connections128 (configurable1..1024), metrics16;
  a maximum connection age defaults9s (1..30s). Partial headers/body draining cannot
  occupy a socket indefinitely. These conservative foundation bounds are not gateway
  retry/deadline parity and must be assessed in S10 before production cutover.
- One explicitly built Tokio multithread runtime uses bounded worker and blocking
  thread counts. Shared Arc state contains admission/CPU semaphores, atomic counters
  and a byte-bounded volatile memory slot foundation (S07 owns full cache algorithms).
  Admission and CPU reservation reject when full without queuing; blocking work
  retains its owned permit even if caller cancels. No lock is held across await.
- Public responses carry CORS*. Metrics return finite counters and declared limits,
  no provider payload, coordinate, credential or user identifiers.
- Checker lives under server2/tools. Each task supplies JSON paths/exceptions before
  edits; exact outside paths have reasons/categories. Full diff including both rename
  ends must match declaration. Full tracked server2 snapshot checks manifests,
  resource references and symlinks even when untouched in this PR. Reject root Cargo,
  traversal/absolute resource/local dependency escapes and all legacy resource imports.
  Shared CI may only wire server2-owned commands. It must run fmt/clippy/tests/checker.
- Gate is deterministic static enforcement plus task review, not proof against computed
  runtime paths or malicious code; dynamic filesystem access requires explicit review.
- Shutdown explicitly calls Tokio runtime shutdown_timeout after the HTTP serving
  result, including errors. Listener drain is bounded5s; runtime blocking-task wait
  is bounded1s, making shutdown at most6s plus scheduling overhead. A timed-out
  blocking closure may continue until process exit; no future durable work is claimed
  drained. S05/S10/S18 must define their durable interruption contracts separately.
- Literal placement checks support direct single-line plain and hash-matched raw
  Rust strings in include*/path-module and direct read/read_to_string/read_dir/open/create
  calls (including borrowed/parenthesized literals). Encoded,
  backslash-containing, multiline or unsupported direct include/path spellings
  fail closed. This is a static review aid, not an adversarial sandbox: computed,
  aliased, macro-generated runtime filesystem APIs require manual review.
- Conservative non-Rust text checks reject direct legacy/client path references in
  tool/deploy/config assets. Validated task-declaration outside.path identities and exact fixture data roles
  can be exempted;
  an outside declaration cannot authorize executable legacy imports.
- Shared workflow accepts only a checkout action and the single owned CI invocation,
  with a finite30minute job timeout.
- Private metrics omit CORS; public responses retain Access-Control-Allow-Origin *.
  OPTIONS/preflight parity is deferred to S02; foundation OPTIONS currently405.
- A signal-triggered listener-drain timeout logs a forced stop, aborts listener tasks
  and exits cleanly within the5s+1s bound. Unexpected startup/serve/runtime errors
  remain failures. Socket cap, elapsed slow-header bounds, forced partial-header
  shutdown and exhausted admission503 are automated regression scenarios.
