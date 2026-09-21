# Independent verification — PR #2551 publication cleanup

Verdict: **PASS**. No Must Fix or other finding.

Verifier: `/root/architecture_verification`, separate from builder `/root`. Candidate: `sha256:e6eaf244f617ef5deb3c069de5fb6c2470e4ef1af4a777ff08947c3b71dbb996`. Compared against preserved commit `a99a5bd54b3905c3b038146b7b7967e303b7b55f`. Scope is the authorized archive deduplication and reading-order correction; endpoint remains stop-at-PR, with no merge authority. This is independent local verification, not a cross-provider PR review.

## Actual checks

- Independently compared `git diff --name-only --diff-filter=D` with removed-snapshots.json: exactly **59** unique paths, all in the two historical `deliverables/` directories, with no additional deletions.
- Read all 59 original blobs using `git show <preserved-commit>:<path>` without writing restored files. Every SHA-256 and byte count matches the manifest; total **6,808,586 bytes** remain recoverable from that immutable commit.
- Read both new archive READMEs. Their immutable GitHub URL paths resolve to existing trees in the preserved local commit via `git cat-file -e`. The text accurately separates historical candidate content hashes from Git commit IDs and explains retained receipts/reports. No remote HTTP check or new publication was performed.
- Compared **84 retained historical evidence files** outside the removed deliverables directories byte-for-byte with the preserved commit: unchanged.
- Independently compared **50 protected files**—current tracked diagrams, diagram validation/delivery/browser receipts and handoff, canonical AGENTS/CLAUDE, paseo.json, .gitignore and root README—with the preserved commit: unchanged.
- Verified that docs/architecture/README.md differs only by changing the SSH access entry from `6.` to `7.`. Ordered entries now run 1–7.
- Executed `python3 reports/sdlc/service-architecture/publication-cleanup/check.py`: exit 0; **182 local links**, six unchanged HTML/JSON/browser bindings, preserved product/configuration/guidance, retained HTML/JSON and exact deletion scope pass.
- Executed `python3 reports/sdlc/service-architecture/guidance-check.py`: exit 0; Claude import and Codex entrypoint still resolve one canonical source. No behavioral instruction reevaluation or real Claude launch was needed because those bytes are unchanged.
- Executed `git diff --check`: exit 0.
- Independently bound all candidate entries: **32 present files** match their SHA-256 and **59 absent entries** are absent. Main-owned stage-ledger/report additions are workflow evidence, not additional architecture changes.

Observed final output:

```text
PASS: 59 deletions exactly; 6808586 historical bytes recoverable; 182 local links; numbering1–7; six unchanged diagram bindings; historical evidence/current guidance/paseo/product preserved; HTML/JSON retained.
PASS: Codex AGENTS.md and Claude @AGENTS.md resolve one canonical source; required rules and links present.
INDEPENDENT_BINDING sha256:e6eaf244f617ef5deb3c069de5fb6c2470e4ef1af4a777ff08947c3b71dbb996 present 32 absent 59 retained_historical_evidence_unchanged 84
```

## Evidence reuse and limits

Current rendered diagrams and existing receipts are byte-identical, so prior browser/perceptual results remain applicable; no regeneration or browser rerun was necessary. The original document-check.py retains historical working-tree assumptions; this correction uses the reviewed publication-cleanup/check.py instead. No product behavior changed, so no application tests or provider checks were run. No AWS/SSH, credential access, delegation, commit, push, PR comment or merge was performed by this verifier. Remote availability of the historical commit is the existing publication context; this review proves local Git-object recovery and URL-path correctness, not a fresh network retrieval.

## Inspected correction hashes

| Artifact | SHA-256 |
| --- | --- |
| `docs/architecture/README.md` | `23de8102c6847bfa7772e7b261d11bd7216151295605231b766d187d97be8eaa` |
| `reports/sdlc/service-architecture/publication-cleanup/scope.md` | `8f055069f9f3ea0f7dbd2918a8c9fb3a1ffa68aad631684eb62df8a7c13f5fd6` |
| `reports/sdlc/service-architecture/publication-cleanup/removed-snapshots.json` | `7a74cf05b8d8d170db0adb3ddc9e76d1d89d70379a0621aa04eb76e742277a06` |
| `reports/sdlc/service-architecture/publication-cleanup/check.py` | `dbe37afe7831c4619f1d9a91124ac8216905a8da6e96ee0ddca0233645add281` |
| `reports/sdlc/service-architecture/revisions/01-source-only/README.md` | `6922f3310c6fdc1286e702b21d6ff5c8b77a2a57c01151835fa1ebc181e7a9a4` |
| `reports/sdlc/service-architecture/revisions/02-aws-correlated/README.md` | `a9cb6477f79827314443c6841705d97c5ee3d9626eb62b89d4e6a383dc226f7f` |

Verified UTC: 2026-09-21T08:39:32.801224+00:00
