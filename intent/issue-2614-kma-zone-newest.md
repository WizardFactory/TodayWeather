# Forecast zones from the newest stored list

After a restart the forecast-zone read folded every stored list since 2026-01: one LIST, a catalog GET per day partition and, for every list, its descriptor and pages, with a day's lists read inside one 3 s catalog operation, twice per start. Every process start also acquired the list again and stored it as a new group, identical or not. On EC2 (2026-11-09 and 10) the day's partition reached 12 to 15 identical lists after test restarts, and 2 of 7 first answers of #2907 were 501 when that read ran out of time. A request uses only the active zones of the newest complete list (`regId`, `regName`, `regSp` and whether it is retired): `findForecastZoneByName` and `collected` read nothing else. Legacy collects the list once per process start and upserts it into one collection; server2 replays raw groups instead.

This is PR-Z of the restart re-examination (`reports/sdlc/issue-2614-kma-restart-reexam/design.md`, not tracked; section 11, design review 4 approved), stacked on PR-A (#2921, the allocator and the accept clock).

## AK decisions of 2026-11-10 ("권고대로 진행")

1. Answer-level fidelity for forecast zones: the zones are the newest complete stored list, not the document-level fold of every list since 2026-01.
2. The list is acquired when the newest stored one is more than 24 h old, not on every process start.
3. Behaviour during an S3 outage is unchanged in this round.

## Outcomes

- **SELECT:** the zones come from the newest complete stored list. Candidates come from catalog control objects alone: the day partitions of the key (one paginated LIST) and each day's catalog. Days are tried newest first; the first with an eligible list is the anchor, and the day before it is checked for a list that completed later. Only a tried group is restored, and its identity is checked against its catalog entries.
- **ORDER:** lists are ordered by the fold's key: the completion instant (the last page's arrival), then the partition, then the digest of the page hashes in page order, all taken from the catalog entries.
- **FALLBACK:** a newest group that is not complete (S06) or that legacy would not have written gives way to the next newest; a list that completed after the request's instant does not answer yet. With no eligible list the observed source answers the release's land zones and the legacy source an empty collection, without identity. A corrupt or unreadable store stays the read's error (decision 3).
- **INSTALL:** memory holds the zones with their list's identity. A check of S3 or an owned acquisition installs a list under the zones lock only when its identity is newer, so a slower, older result never replaces a newer one and the last good list stays until then. The last successful check time is kept apart: a check that finds the same list again moves it, so the selector runs once per 10 minutes, not on every request. The daily refold is removed.
- **FRESH:** a request whose newest known list completed more than 24 h ago, or that found none stored, starts the owned acquisition without waiting for it (failures retry under the existing five-minute admission). The per-process success gate is removed: a long-running process acquires again after 24 h, and a restart with a fresh stored list acquires nothing.
- **ORACLE:** with the legacy oracle fixture kept, every legacy query gives the same `regId`s and result count through the selector, and `collected` judges the same mid temperature regions.
- **COST:** a cold read costs ceil(D/1000) LIST pages, one catalog GET per day examined and, per tried group, its catalog again, its descriptor and its pages, independent of the identical lists accumulated in older days.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Notes for AK

- Documents change, answers do not: memory no longer keeps retired zones or fields only an older list set. No answer reads them.
- The 24 h rule reads the newest identity memory holds, including a list an owned acquisition installed when it was ready in RAM (response-first). RAM-ready is not durability: if its publication then fails, the process answers from it while S3 lacks it, and the list is acquired again after 24 h or by the next process start, which reads S3.
- The identical lists already stored stay in S3 and are no longer read; nothing is deleted.

## Exclusions

Not in this change: skipping identical content when storing, the growth of `pwn-cd`, `zone-state` and `uv-idx-v5`, a request-time bound on stored reads during an S3 outage (decision 3), the `rn1` gap (PR-V) and the EC2 acceptance (C).
