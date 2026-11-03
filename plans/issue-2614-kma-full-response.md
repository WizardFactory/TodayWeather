# Plan for the KMA full response

Root notebook: `.planning/2026-10-23-kma-cold-requirements`. Task declaration: `server2/config/tasks/KMA-FULL-RESPONSE.json`.

1. Commit the declared candidate on a new branch and merge current `master`, resolving overlaps in favour of both sides' behavior.
2. Run focused tests, the server2 CI script's checks where locally possible, the placement gate and the artifact policy on the merged tree.
3. Push and open a PR that is not merged. Wait for CI.
4. Run the required cross-provider review at high effort with the additional reviewers, correct selected findings and repeat until PASS.
5. Check documents, then record merge-ready readiness with `merge_authorized: false`.

User scenarios are in `reports/sdlc/issue-2614-kma-full-response/user-scenarios.json`.
