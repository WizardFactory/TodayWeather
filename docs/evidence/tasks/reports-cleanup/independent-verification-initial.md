# Independent verification — repository artifact cleanup

Date: 2026-09-30. Reviewer: separate delegated verification context `/root/verify_reports_cleanup`; not the implementation author. Endpoint: local repository review only. No cross-provider PR-review claim.

Verdict: **CHANGES_REQUIRED**. Two medium-severity requirement failures are reproducible. The migration itself preserved the inspected local originals, selected evidence and reference assets.

## Candidate and scope

- Baseline: `a5fdde1fb5bf0d84a4af7aac8815b3690a57a8c2`.
- Initial staged-entry digest independently matched `candidate.json`: SHA-256 `12e5786e013fe38ea221b763503edf186dca1ab6037b8fda5e234d5ccc5feb18` over `git ls-files --stage -z`.
- Read repository AGENTS, architecture index/evidence, intent/spec/plan, build/self-verification/candidate/test-results, migration records, retention and skill-upgrade guide, staged diff, checker/hooks/CI, moved verification tools. Shared `~/.agents/policies/sdlc.md` was absent; installed SDLC skill and normative verification/retention rules were read.
- Author added a probes README during this review. It was read, but the initial candidate digest above predates that addition; renewed candidate verification is required after corrections.
- No author files, author Git index, repository configuration or global skills were modified by this reviewer. New fixture source is only `/private/tmp/verify-reports-cleanup-edge-cases.py`. Its disposable Git repositories are removed by `TemporaryDirectory`.

## Findings

### F1 — local file URIs escape snapshot validation

Severity: MEDIUM. Category: correctness / portable documentation. Location: `scripts/check-artifact-policy.py:101-104` (`resolve`). Requirement: AC2 / AC4, reject maintained links dependent on local-only output. Confidence: high. Disposition: Must Fix.

A staged `docs/README.md` containing `[local output](file:///private/tmp/nonexistent-local-report.json)` passes with exit 0. `resolve` treats every URI scheme as external and skips `file:` URLs. A workstation-only report can therefore satisfy the new gate despite being absent from the indexed/committed delivery.

Reproduction: `python3 /private/tmp/verify-reports-cleanup-edge-cases.py`, case `test_uri_local_link_should_not_pass`; expected nonzero, actual 0 and `Artifact policy passed: 1 snapshot(s)`. Reject local-file URI dependencies explicitly; retain legitimate external-link handling. Cover Markdown and HTML variants with regression cases.

### F2 — probe reproduction commands write generated results into source tooling

Severity: MEDIUM. Category: generated artifact placement. Locations: all six executable Node probes under `scripts/verification/rewrite/probes/`, line 2 and their emitted `command` fields (for example `server-unit-conversion.js:160`, `server-kmatimelib-timezones.js:82`, `client-storage-migration.js:256`). Requirement: AC3. Confidence: high. Disposition: Must Fix.

The move rewrote commands from `node reports/...js > reports/...json` to `node scripts/verification/rewrite/probes/...js > scripts/verification/rewrite/probes/...json`. Following those exact commands creates generated JSON under an unignored source directory. The new probes README says results belong under ignored `reports/verification/rewrite/probes/` or outside the repository, so the executable headers and emitted provenance contradict that guidance.

Verification: compared every moved tool against its preserved original and inspected `rg -n '> scripts/verification/rewrite/probes' scripts/verification/rewrite/probes/*.js`. Change output redirection and emitted command metadata to the ignored result directory, with a reproducible directory-creation step. Do not rewrite the preserved dated evidence records.

### F3 — valid repository-root links are rejected

Severity: LOW. Category: checker usability. Location: `scripts/check-artifact-policy.py:57-72`. Confidence: high. Disposition: Recommended.

A staged `docs/README.md` containing `[repository root](..)` fails even though the repository root is a valid portable target. Resolution produces `.`, but `target_exists` searches for `./`-prefixed indexed names. Additional case `test_repository_root_link_is_portable` expected 0, actual 1. Handle normalized root targets without accepting paths outside the snapshot.

### F4 — records and executable probes use the same navigation label

Severity: LOW. Category: documentation navigation. Locations: `docs/rewrite/README.md:8,35`, `scripts/verification/rewrite/capture/README.md:57`. Confidence: high. Disposition: Recommended.

The descriptions say the linked probes directory contains the eight result records or both harness results, but the new link points to `scripts/verification/rewrite/probes/`; the saved JSON is in `docs/evidence/rewrite/probes/`. The added probes README supplies an indirect evidence link, so content is retained, but direct labels/targets should distinguish executable probes and dated records.

## Checks independently executed

Environment: macOS; Python 3.9.6, Node v24.19.0, Git 2.54.0 (Apple Git-157).

1. `python3 scripts/verification/test_artifact_policy.py`: PASS, 14 tests. These exercise staged/working-tree mismatches, commit-tree independence, generated directories, missing refs, multiple/new/deleted push refs, transient forbidden history, manifest target checks, and file/index fingerprint immutability on success and failure.
2. `python3 scripts/verification/smoke_artifact_hooks.py`: PASS, six real local hook scenarios: deliberate installation, valid commit, forced-output rejection/local-byte retention, staged-link dependency, local bare push, add-then-delete history rejection, and preservation of existing hook configuration. No network remote was used.
3. `python3 scripts/check-artifact-policy.py --staged`: PASS for initial candidate, one snapshot. `git diff --cached --check`: PASS. `git diff --name-only`: initially empty. `git ls-files reports/`: empty.
4. Independent five-case fixture `/private/tmp/verify-reports-cleanup-edge-cases.py`: three PASS (snapshot symlink target resolution, documented pre-policy exemption, forbidden intermediate commit on a merged side branch); two FAIL as F1/F3. Fingerprints checked for every invocation using the existing fixture helper.
5. Independently compared all 652 recorded original local report hashes to both `original-reports.json` and baseline Git blobs: all match. Checked all 143 migration destinations are in the index and source hashes match: PASS. 116 retained destinations are byte-identical; 27 have path/root/output/document edits, reviewed in the relocation diff. There are zero indexed `reports/` paths.
6. Independently parsed all 89 entries of `docs/evidence/source-link-repairs.json`, checked the historical Git blob exists, line ranges fit the blob where present, and the corresponding historical URL appears in the target document: PASS. This is local object validation, not a remote GitHub availability check.
7. In the author's reports-free temporary snapshot `/private/tmp/tw-reports-clean-g2lo_2jf/snapshot`, independently reran `python3 scripts/verification/rewrite/validate-package.py`: PASS, 82 JSON files, 5,046 local links, 2,773 line anchors, 74 reference screenshots, 45 capture diagnostics, eight Python files; no errors. `python3 scripts/check-artifact-policy.py --staged`: PASS. `git status --short`, `git ls-files reports/`, and `git diff --exit-code -- docs/rewrite/screenshots docs/architecture/diagrams`: clean. No validator output file was requested.
8. Inspected reconstructed `docs/operations/historical-observations.md` against current `server/bin/backfill-history.js`, `server/lib/history/cli.js` and `policy.js`: explicit CLI key/station checks, completed KST dates, bounded 1–7 day range, exit status and lack of scheduler-flag CLI guard are supported. No CLI/provider/database operation executed.
9. Inspected `.githooks`, installer and CI wiring: same checker is used; local hook installation is opt-in; workflow has no docs-excluding path filter and fetches full history; missing Git objects fail instead of falling back to a clean tip. Web browser diagnostics changed to 30 days and relocated screenshot output; existing 90-day deployable artifact retention and existing test commands are preserved.
10. Staged paths do not modify app runtime `client/www`, server controllers, diagram source/HTML or skill configuration. The only app-test edits inspected change result defaults. Shared-skill output is a guide, not an installation or execution claim.

## Limits and handoff

No production, provider, database, native build, browser-render execution, remote CI, issue edit, remote branch-rule change, author commit/push or global skill execution. Existing historical source probes were inspected for relocation and limits; this verifier did not re-certify all their historical behavior. The author reports two probes already fail against current source in both original and relocated locations, and the added README labels that limitation.

The current repository hooks are intentionally not installed; actual hook wiring was observed only in isolated fixture repositories. GitHub merge enforcement is not established by adding a workflow. The clean snapshot predates corrections and the new probes README. After F1/F2 correction, rerun affected regression/smoke, check the final staged digest and obtain reviewer resolution. Preserve this distinct initial report rather than replacing its findings silently.
