# Publication cleanup — 2026-09-21

Authority: AK requested corrections and push following review of PR #2551 comment5753720172. Same service-architecture task, AC1–AC4, stop-at-PR endpoint; no merge or deployment.

Accepted recommendations: remove 59 duplicate historical deliverable files, preserve their bytes at immutable published commit a99a5bd54b3905c3b038146b7b7967e303b7b55f with per-file hashes and archive index links; correct source reading order6→7. Keep current diagram HTML/JSON, evidence receipts and reports, canonical instructions and paseo.json unchanged.

Implementation plan: remove only tracked files under the two historical deliverables directories; add archive navigation and byte manifest; correct the index; validate deletion scope, historical byte recovery, current links, all six diagram bindings and unchanged product/configuration; independently verify the candidate; commit/push and update PR body. Rollback is git restore from the preserved commit. No architecture regeneration or application tests are needed because structure and generated artifacts do not change.

The historical completion/publication records describe their original local/PR snapshots. This amendment supersedes only their duplicate-file retention policy and current candidate identity. Full diff retrieval may still exceed GitHub's20000-line limit because current requested standalone HTML remains.
