# Plan for empty and partly stored KMA requests

Root notebook: `.planning/2026-10-23-kma-cold-requirements`. Task declaration: `server2/config/tasks/KMA-STORED-READS.json`.

1. One LIST per existence question in the reader, the mid walk, warning discovery and KASI restore.
2. The release's land zones under the observed source until a forecast-zone list is stored.
3. Forecast coverage in the full-response check.
4. Absent publications requested without waiting for stored reads, and the 54-hour read window, under the observed source only.
5. The collector-written zone state, and one stored KASI fold with a short request wait.
6. Measure before and after with temporary code that is not committed, update the design documents, contract and diagram.
7. Commit, push and open a PR that is not merged. Wait for CI, then run the required cross-provider review at high effort with the additional reviewers, correct selected findings and repeat until PASS.

Scenarios SC1 to SC6 are in the task's `user-scenarios.json`. SC1 and SC2 map to EMPTY and PARTIAL, SC3 to PARTIAL and WINDOW, SC4 to KASI, SC5 to WARNINGS, SC6 to CHECK. No user-visible interface changes, so no manual applies.
