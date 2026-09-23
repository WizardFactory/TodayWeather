# Independent verification: push-diagram publication

Verdict: **PASS**. No unresolved mandatory findings. Stage iteration 3 of 10, resumed after interruption without restarting assessment.

Reviewer: `/root/verify_push_diagram`, independent of builder. This is independent verification for PR publication, not cross-provider PR review or merge readiness. Scope: read-only author worktree, report written only under /tmp.

Candidate: `3b5ddf5344452ecd6a36f1e2e4affc24e5e45f600bb593b0336bd32552aac2f5`.
Inspected local HEAD: `d14da457515407873fba28c9b0291bb23ce955a3`.
Publication base: `54b2d0f2802742123f5a016e37b0807fda775bab`.
Both commits have tree `5f280bd901514a254bd241391886ff9cf51eff9f`.

## Acceptance and actual checks

- AC1 PASS. Independently matched all 10 candidate file SHA-256 values to the manifest. Inspected the amended publication scope and build/self-verification evidence. JSON totals reconcile for 19 route groups and 31 intersecting UTC dates: 220,583 API requests, 264,880 viewer requests; route/day/status/cache/user-agent/object-count and compressed-byte totals agree. Daily and route CSV request/error/disconnect counts agree with JSON; covered hours sum to 720. Gateway completed-query results sum to 39,932 request-start records and 39,914 completion records. Markdown summary totals and evidence boundaries agree with these values. Push source reference bytes match their pinned revision for all 14 references; application-source diff against origin/master is empty.
- AC2 PASS. The report preserves dated 30-day and seven-day windows and distinguishes request starts, completions, viewer logs, heuristic device classification, delivery-delay limits and unproven root cause. Inspected evidence structure contains aggregates, normalized route paths, query definitions and query IDs, not individual personal request records. Every coordinate/address route group ends in `{location}`. A bounded scan of candidate files found no AWS access key IDs, private-key blocks or sensitive raw JSON fields (client IP/cookie/token/registration ID/secret-access-key). Account/resource identifiers and credential paths are not credential values. AWS access guidance explicitly limits authority and warns against exposing/overwriting credentials.
- AC3 PASS. Independently checked 61 relative Markdown links; all resolve. Six sh/bash fenced blocks passed `bash -n` without execution. `CLAUDE.md` contains only `@AGENTS.md`, and AGENTS links the canonical AWS guide, preserving shared instructions without duplication. Push explanation, JSON and HTML match the previous independently verified hashes. Their 9/9 artifact checks, four desktop viewport checks and independently viewed light/dark screenshots remain reusable evidence; no rerender required. Changes to the architecture index and AWS CLI guide were read directly. `git diff --check` passed for the unstaged diff at inspection time.

## Procedure and reuse

Read publication-amendment.md, publication-candidate.json, build-publication.md, self-verification-publication.md and the previous independent-verification.md. Used git status/diff/tree inspection, direct reads, Python standard-library SHA/link/aggregate/privacy checks, and bash syntax-only checking. The first aggregate script used an incorrect assumed Gateway field name `requests`, after all preceding CSV/aggregate assertions passed. Inspection showed the actual field is `calls`; the corrected targeted check passed. This was a verifier lookup correction, not a candidate failure.

The previous mandatory DELETE documentation finding remains resolved: the unchanged push explanation documents truthy cityIndex/id conditions and token-wide deletion for cityIndex 0/absent. No product code fix is claimed.

Main subsequently staged unchanged files and reported whitespace notices from standard CSV CRLF and historical literal diff-context evidence. These are preserved format/evidence bytes; this verifier did not repeat the staged whitespace check and does not claim that main's filtered staged check was independently executed.

## Limitations

No AWS/SSH/application/provider/database request, server startup, credential read, mobile build, browser rerun, mutating check script, commit or PR publication was performed by this verifier. Shell blocks were syntax checked, not authenticated against AWS. Historical access/collection and browser receipts were inspected rather than rerun. Sensitive-pattern checks plus structural inspection are bounded verification, not a general credential audit. Publication and any later CI/review/merge state remain the main agent's responsibility; no merge authorization is implied.

## Exact consumed file identities

- `AGENTS.md`: `91a5642fcf046673e9a018c34a52da6bd0607561058ba05b1666c9afc585fdc6`
- `docs/architecture/README.md`: `19330914bb466ab6318090dd6875d75521fb1ca03c028a46fb7f7f628f67cd1d`
- `docs/architecture/ec2-access.md`: `b26db0a488e98edcf5c6856d4730adc4ba1c78c794d83c28128ab5dfddfe004d`
- `docs/architecture/push-notifications.md`: `9bcae638f7fd23ec1a79ad3d343210e7952c1c4d5d1bfdca8abb1e05a65bd696`
- `docs/architecture/diagrams/push-notifications.json`: `3569ff5ba04bac46380404010b18e5b64a7a92aa1e5835d7c4e7f77e2e407ae3`
- `docs/architecture/diagrams/push-notifications.html`: `8dd9d4a93b93d0aa6d8a48f3f0ba21075906da988049ab754773a4aeccf79dfe`
- `reports/aws/api-traffic-2026-09-22-daily.csv`: `00ed357e49bf7af4d3e2f4e041ab15b637fb5743acc36fa5a126e0c5a814b915`
- `reports/aws/api-traffic-2026-09-22-evidence.json`: `0f15f96a401cc1b8a139d5a03a46e572b9982ae3875bfc57ae523560a2206140`
- `reports/aws/api-traffic-2026-09-22-routes.csv`: `769f88fdf3a32961954de4dc8fe8b72727956160471f5011c6ebae5f20fe7c7e`
- `reports/aws/api-traffic-2026-09-22.md`: `f8b75b81ea85ef044edf34a26c528cbe86eb424e6c4e33b13622902b34d813ed`
- `CLAUDE.md`: `336cc4fbf19beaada7ccf9986414fa91851a8d7a07dfb3ccbe800a69eed0ab49`
- `reports/sdlc/push-diagram/publication-amendment.md`: `c15f29a2af424983b4168f9b8e4c3b34e5b92105e8412ff6f453dd77fb8ed904`
- `reports/sdlc/push-diagram/publication-candidate.json`: `6517676e6b1d670440695fdcb903c1bbf3e5938b0a176acdc7966716b74c6cb8`
- `reports/sdlc/push-diagram/build-publication.md`: `a584be0dfc06974dd9bba343b11f8694c3e88a7f2541085748111ef348e0f3dc`
- `reports/sdlc/push-diagram/self-verification-publication.md`: `cc83862ba3b3adad5a9d93ec1b135a48771834b2ab7b8272fb09defe5a0787ea`
- `reports/sdlc/push-diagram/independent-verification.md`: `cd9cf273f159628ae9f0e2a046436221a4c5586bd532adc00553433d3cfb3e16`

Report finalized at 2026-09-23T05:26:57.694548+00:00.
