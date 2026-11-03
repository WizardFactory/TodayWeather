# Warning fan-out cost and admission

## Observable acceptance

- W1: On a declared owned-S3 fixture with5000 unique recipients, measure the full
  transport request/byte count for the first delivery pass, preserve successful
  delivery/terminal outcomes, and assert a numeric cost bound chosen before Red.
  Demonstrate lower work than the untouched baseline on the same fixture. Repeated
  polls of known-terminal endpoints must add no endpoint-specific claims or zone
  rebuilds while the declared memo capacity covers that fixture. Count feed/shared
  maintenance, registration journal, claim/result, catalog/raw/repair and geocode
  work separately. A method counter or timeout is not an S3 request measurement.
- W2: Reuse valid exact-input successful location resolution without changing geo
  precedence or overwriting registrations. A warning release published by another
  S12 store during OAuth must prevent the pending POST. A late post-OAuth caller
  cannot reuse an acquisition started before that caller became ready. Preserve
  the original four-second final guard and current journal/clock/window/shutdown
  checks; no stale fallback, invented TTL or wait for a slow app to fill a cohort.
- W3: Durable claims remain authoritative across overlapping workers, cancellation,
  memory loss and restart. Known Owned/Taken may optimize local work; unavailable
  storage is not proof of terminal ownership. Never release claims, undo actual
  failed/unknown sends, retry them, or claim successful admission from uncertainty.
  Bound added memory/tasks without dropping new notifications merely because an
  optimization cache is full; expose fallback/saturation limitations. Retain the
  existing concurrency6 per worker, not a global process/host guarantee.
- W4: All implementation/assets stay under server2 and exact paths are amended
  before dependent edits; only declared maintained documents may be outside.
  Meaningful public Red, current Green/regressions, additional actual owned-peer
  executable and source/binary evidence, checked architecture/operator docs,
  independent current review and exact CI precede pre-merge readiness. No runtime
  legacy dependency, verification mode, live provider/device calls, merge, main,
  full recovery release, shadow/production or global issue closure.

## Authority and freshness constraints

Existing S12 per-day/catalog reads are not a globally atomic warning state and
already have a read-to-POST gap. This task must not silently broaden the accepted
freshness point or final-guard deadline. The publication-fence/schema alternative
is unselected and cannot be implemented as a trivial cache. The selected shape keeps independent strict acquisitions after each claim and
again after that caller's OAuth. The poll view is advisory only; it cannot admit
a send. No shared in-flight acquisition, membership/driver protocol, arbitrary TTL,
stale fallback or new publication head is selected. Per-location success reuse
remains exact-input and episode-scoped with geo precedence unchanged.

Initial silent feed/poll behavior, traffic-independent acquisition(C5), startup
credentials(C6) and supervisor/readiness defects are separate increments. The
parent C2 candidate completed its own review/current CI at pre-merge and remains
unmerged. Simplified C4 implementation must renew its own candidate-bound checks,
independent review and CI; prior prototype checks do not qualify it.
