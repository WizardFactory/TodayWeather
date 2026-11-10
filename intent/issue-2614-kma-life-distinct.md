# Life index: each stored content once

On EC2 (restart acceptance C, 2026-11-10) every process start stored the current UV slot again. After 15 seed starts and 8 restarts, today's 09:00 `uv-idx-v5` partition held 24 groups (96 raw objects) with 4 distinct page bodies; every start's group was byte-identical to the stored ones. The first request of a process restores every group of today's partitions, so the restore is late, the request acquires UV again, and `LiveLife` publishes every complete acquisition. That own publication invalidates the read memo: the next request reads the three newest partitions of each life kind again in full (92 to 97 S3 restores, 2.6 to 3.5 s) and waits up to its 2.5 s bound. Each start adds one more identical group, which makes the next start's restore later.

AK decided on 2026-11-10 ("권장안 진행") to treat the life index like the forecast-zone list (PR-Z, #2924): no new copy of a stored content and bounded life reads, in a separate PR with a design review first. Content identical to the newest stored group need not be stored again (AK, the same day). The design (`reports/sdlc/issue-2614-kma-life-distinct/design.md`, not tracked, revision 3) was approved after three design reviews.

## Outcomes

- **READ (D1):** the life read restores a partition with one catalog control-object read and, per distinct content (the members' raw hashes in page order), one group restore in S06 `lookup`'s order with its per-group rules. Later groups of a restored content are applied with its pages at their own completion and place. With every group excluded the read fails as before (`incomplete catalog`). Only the life read uses it.
- **EQUALITY (I1):** while every listed group's descriptor and members are present and consistent, the fold, each kind's last issuance, the pollen day+3, the applied set and the last applied acquisition equal restoring every group, for the initial, incremental and full reads.
- **COST (I2):** a partition's descriptor and body GETs are bounded by its distinct contents; each failed restore adds one restore; parsing, ordering and folding stay linear in the listed groups.
- **PUBLISH (D2):** a complete UV or pollen acquisition is not published when a stored group of its catalog with the same member raw hashes restores completely within the check budget (`LifeOutcome::Stored`). Otherwise, and on any error or timeout, it is published as before. MFDS and KASI are unchanged.
- **BUDGET:** the owned time of a UV or pollen request adds `CHECK_BUDGET` (3 s), still capped at `MAX_OWNED` per flight; the provider deadline of each attempt is unchanged; the flight passes its one owner deadline to the acquirer, and the check runs only while 3 s plus the 10 s publication budget remain, under one deadline.
- **OVERLAY:** a `Stored` acquisition answers the waiting requests at once without counting an own publication, and stays over the fold until a committed read's applied set holds its stored group; the needed-first fold does not count.
- **PLACEMENT:** the placement gate and the artifact policy pass.

## Notes for AK

- Stated difference: a later copy whose own descriptor or bodies are lost is now applied with the restored copy's pages; before, it was excluded, or a corrupt one failed the read. S06's output and control byte budgets bound each group restore instead of a whole partition.
- A skipped acquisition's own completion is not replayed, its stored copy's earlier one is: UV `remove_old` may keep rows dated between the stored copy's completion minus 10 days and the skipped one's minus 10 days until the next UV acquisition (dates no response shows). Other hosts' acquisitions appear within the 60 s memo instead of at once after an identical acquisition.
- An absent catalog of a listed partition gives an empty partition, as the design states; `lookup` answered the incomplete-catalog error for it. Listed partitions are catalog objects and nothing deletes them.
- The restart effect (today's partition restored before the 700 ms head start) is shown locally, not measured on EC2.
- Identical groups already stored stay in S3; nothing is deleted.

## Exclusions

Not in this change: other per-start kinds (`pwn-cd` warnings), MFDS and KASI, sharing contents across partitions, a wide variant of `members`, deleting stored copies, copies two hosts publish at the same moment, and the EC2 re-measurement.
