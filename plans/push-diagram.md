# Plan: Push diagram

Intent: ../intent/push-diagram.md. Specification: ../specs/push-diagram.md. Execution owner /root; selected plan .planning/2026-09-22-push-diagram; state reports/sdlc/push-diagram/artifacts.json.

1. Preserve the validated design JSON/HTML and receipt bytes.
2. Add docs/architecture/push-notifications.md with source-linked registration, token replacement, deletion, local storage, worker scheduling, provider choice, error limits and dated evidence. Add links in the architecture README.
3. Validate documentation links, route/token/schedule assertions and diagram evidence identity. Do not start server or integration tests for non-executable documentation.
4. Have a fresh-context independent verifier inspect source versus final artifacts and report separately. Main retains file ownership; verifier read-only except its report under /tmp.
5. Complete local delivery with HTML, JSON and explanation links. No commit, PR, merge or deployment.

Blast radius: documentation only. Main risk: treating registration HTTP success as delivery or attributing observed 403s without request evidence. Rejected alternative: a dense runtime sequence that implies API calls synchronously send pushes. Proof: Archify schema/composition, real browser, visual inspection, source claims/link checks and independent verification. Rollback: remove only the new diagram/docs and their README links; preserve existing traffic reports. No migration.
