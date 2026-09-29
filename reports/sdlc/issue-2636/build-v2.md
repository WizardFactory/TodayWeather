# Corrective build, iteration 2
Candidate: candidate-v2.json, compared with initial base; all 13 source/test/config files are hashed. Initial implementation details remain in build.md.

F1 is corrected: accepted observations from the shared global flow are used directly, preserving both exactly-eight-hour and sub-minute observation behavior. AirKorea stored rows retain their existing strict window. F4 is corrected: stored failures distinguish stale, future, invalid, missing and database-error. New regression cases include real observation.evaluate output. Total focused tests: 16 collector + 13 nation.

F2/F3/F5/F6/F7 are explicitly dispositioned in operations.md: unchanged shared provider caps, quantified worst-case consumption and operator pre-rollout decision; hung Mongo acknowledgement requires quiescence/diagnosis rather than unsafe lock expiry and overlapping buffered writes; keep one renewed key (collector selects last); existing serial route sequencing adds bounded cold-cache delay; verify live province labels. F8 needs no change (historical rows use station+time keys).

The original independent report is retained as independent-verification-v1.md. Its F1 Must Fix requires reviewer closure on this revised source. No live recovery, entitlement, production wire compatibility or device claim is made.

Red logs boundary-red.log/status-red.log reproduce behavior before respective fixes. One initial green run hit a VM cross-realm array assertion issue in the new test; Array.from normalizes the assertion without changing application behavior. Final green/post-refactor and real Mongo smoke passed. Additional full offline regression is recorded separately.
