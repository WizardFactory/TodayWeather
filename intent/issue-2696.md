Task: issue-2696-s11; owner: S11 builder (Anthropic Claude); base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Authority: AK authorized S11 in the server2 sequence after S10 (relayed by the root coordinator, 2026-10-13); endpoint pre-merge.
Criteria: PARITY, RESTORE, PRIVACY, CHAINS, SWITCH, AIR, PLACEMENT.
Issue update assessment: post the exact path declaration before implementation and one concise status comment at readiness.

# Intent

Serve the used overseas (world) gateway weather backend from canonical Visual
Crossing (VC) raw records in server2, behind the S10 per-family switch, without
changing any byte of the legacy `/v000901`–`/v000903` DSF-coordinate response.

- PARITY: native world output equals the legacy oracle byte for byte for the
  S02 world/locale cases and new recorded cases: negative coordinates, cell
  boundaries, dateline and poles, DST transitions, half-hour zones, missing
  fields, provider errors and stale fallback.
- RESTORE: with empty memory, durable S3 raw records and providers disabled,
  the same request at the same instant returns the same bytes.
- PRIVACY: raw keys, catalog identities, metadata and provider requests use the
  legacy 0.02-degree integer-microdegree cell centre; precise user coordinates
  never enter S3 or provider weather requests.
- CHAINS: the legacy VC range chain (combined/recent/forecast), no-yesterday
  marker, failure backoff, provider-down and budget-to-forecast fallback, stale
  serving and one owned fetch per cell are preserved; VC HTTP is funded through
  S08 before sending; new data succeeds only after S06 raw and catalog
  publication (O-9).
- SWITCH: the world family registers as a native backend handler through the
  S10 dispatcher; legacy HTTP remains the default and rollback target.
- AIR: the air branch preserves the legacy response for "no configured air
  provider" and renders a supplied normalized observation exactly like legacy.
  Funded live air acquisition and air raw persistence are not decided by the
  issue and stay out of scope (reported as a decision).
- PLACEMENT: every path matches `server2/config/tasks/S11.json`; no runtime
  dependency on legacy source or data.

In scope: Rust implementation and tests under `server2/`, recorded oracle
fixtures, local loopback S3/provider smoke, the world section of
`docs/architecture/server2.md`, commit/push/PR, CI and independent review.
Excluded: merge, auto-merge, merge queue, AWS resources, deployment, cutover,
live provider calls and secret reads. Native activation remains gated by the
existing shadow, quota, latency and AK approval gates.
