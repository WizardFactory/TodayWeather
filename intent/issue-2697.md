Task: issue-2697-s12; owner: S12 builder (Anthropic Claude); revision/base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Authority: AK authorized S12 on 2026-10-13 as part of the server2 sequence after S10; endpoint pre-merge (no merge).
Criteria: WEEKOLD (AC1), FLASH (AC2), DURABLE (AC3), PORT (AC4), PLACEMENT (AC5).
Issue update assessment: post the path declaration before dependent edits and one concise status comment at readiness; no duplicate intake comments.

# Intent

Rebuild the legacy `/v000903/kma/special` response and the KMA address `specialInfo`
field from durable S3 raw records and identity catalogs, so that a replaced host
with empty memory and disabled providers serves the same warning bulletins.

- WEEKOLD (AC1): with providers disabled and empty memory, `/v000903/kma/special`
  and `specialInfo` recover a week-old type 2/3 bulletin and the zone state from
  the local S3-compatible peer alone, matching S02 golden bytes.
- FLASH (AC2): latest type 1-3 bulletins have no age expiry; type 4 follows the
  legacy rule (stored KST-as-UTC instant + 10 h < now, equal to actual + 19 h).
  Output matches S02 goldens at +10 h, +19 h and +19 h + 1 ms.
- DURABLE (AC3): an interruption during raw body, descriptor or catalog publication
  never loses an acknowledged latest bulletin; latest selection uses the durable
  per-type catalogs, never an in-memory-only pointer or a separate latest marker.
- PORT (AC4): getPwnStatus, getWthrWrnMsg, getPwnCd and the type 2-4 summary
  operations (getWthrPwn, getWthrInfo, getWthrBrkNews), their parsers, zone
  replay, town-zone mapping and legacy seed export/import are ported under
  `server2/`, verified with recorded fixtures and loopback stubs.
- PLACEMENT (AC5): every changed path matches `server2/config/tasks/S12.json`;
  no runtime import, include, symlink or file read reaches legacy assets.

In scope: implementation, isolated tests, release-mode local smoke, warning
sections of `docs/architecture/server2.md`, commit/push, PR, CI, independent
review and selected fixes. Out of scope: merge, auto-merge, AWS resources,
live provider calls, deployment, cutover, push warning feed (S18), domestic
address assembly (S15) and process scheduling activation. No secrets are read.
O-9 (non-recreatable publication policy) is approved in the S01 record.
