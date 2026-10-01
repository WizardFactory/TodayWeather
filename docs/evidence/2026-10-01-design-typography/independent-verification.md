# Independent verification — documentation and typography references

Date: 2026-10-01 (Asia/Seoul). Task: #2651 authorized local steps 1–2. Stable independent-verification iteration: 1; assignment reports 9 attempts remaining. Verifier context: `/root/verify_docs_typography`, fresh-context QA child of `/root`, distinct from the author. Provider/harness: OpenAI/Codex, system-described as based on GPT-6; exact serving model/version and reasoning setting are not exposed in this context. This is same-provider independent verification, not different-provider PR review.

Verdict: **PASS** for the bounded frozen candidate, with one LOW advisory and a required final retention action. Proposed HOTL decision: **PROCEED** to retain this report in selected versioned evidence, link it, and run the staged artifact-policy check on the final evidence-inclusive index before claiming completion. There are no unresolved mandatory findings against the inspected candidate. This does not authorize production adoption, a commit, push, PR, issue update, AWS or native runtime.

## Candidate and consumed inputs

- Worktree: `/Users/ak/.paseo/worktrees/2xgmy5rd/massive-elk`.
- Observed HEAD/base: `6ec6c68ceb518e22382ba2c24428964d4d2e0e67`.
- Frozen source candidate: `6d32d7f2260da9b188b0549690368f0ad61c153fefafc3e867d92897c3116a19`.
- Independently recalculated identity using `sha256(json.dumps(source_manifest['files'], sort_keys=True).encode()).hexdigest()`, Python default spaces/separators, no newline. Result matches the assigned candidate. This is a source-manifest aggregate, not a Git commit/tree identity or an aggregate of later evidence files.
- All 15 source-manifest paths were independently SHA-256 checked against both working-tree bytes and `git show :<path>` index blobs. All matched. Six selected PNG hashes likewise matched working-tree and index bytes. Browser-summary source digests matched the manifest and authored full-run result. Selected PNG bytes also matched their named authored originals.
- Read repository `AGENTS.md`, architecture index and `web-client.md`, repository artifact-retention policy and evidence index; installed SDLC skill, normative playbook including retention amendment, verification requirements and subagent contract. The shared user policy was absent, so the installed normative playbook applied.
- Read full current intent, spec, plan, design-system index, documentation guide, typography guide, reference HTML/CSS/JS, font provenance/license, verifier script, diagram source proposal, selected evidence README/manifests/summary, relevant artifact-index entries and authored full-run evidence. Historic diagram provenance remains pinned to `481aa49d`; it was not re-certified by the master pull.
- `git status --short` and staged diff showed 24 added documentation/reference/tool/evidence paths. No production `web/`, `client/`, native, server, shared-token-package or package-lock change was present in the inspected candidate.

## Actual checks

| Command/check | Actual result |
| --- | --- |
| `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/todayweather-design-browsers node scripts/verification/design-typography-check.mjs --quick --out reports/sdlc/issue-2651-docs-type/independent-quick` in default sandbox | Exit 1, `listen EPERM` on `127.0.0.1`; no browser verdict from this attempt. |
| Same command with scoped `require_escalated` for loopback/browser execution | Exit 0. Both Chromium `153.0.8010.12` and WebKit `26.6`: 72 renders passed, zero findings/errors/unavailable engines; 6 control/resize checks passed. All browser resources are restricted by the script to loopback; no product service was started. |
| `python3 scripts/check-artifact-policy.py --staged` | Exit 0: `Artifact policy passed: 1 snapshot(s); files and index were not changed.` This checked the author's then-current staged candidate, before retention of this new report. |
| `node --check docs/design-system/references/typography.js` and `node --check scripts/verification/design-typography-check.mjs` | Both exit 0. |
| Python read-only SHA-256/index-blob comparisons | All 15 source and 6 capture identities matched; no mismatches. Aggregate source identity matched the assigned candidate. |
| Authored full-run JSON inspection | Reviewed, not independently rerun: 672 unique render IDs, 336 per engine; 14 viewport/input cases; ko/de, light/dark, six setting/root pairs including 90/115% and 130% at root 32. Zero findings/errors/unavailable engines, 28 passing controls. Summary and source identities matched. |
| Six selected PNGs opened with `view_image` | Direct visual inspection completed for all six; observations below. |

The independent quick result is `reports/sdlc/issue-2651-docs-type/independent-quick/results.json`, SHA-256 `008652217121ff10e7dec3d4ea97eb5d705b779fa04d3f90536a4f353b3e2061`. Its source digests match the retained browser summary. The quick matrix covers the three core tiers, ko/de, both appearances, 100/130% and 200% root; boundaries, 90/115%, 320px and half-width reflow are supported by the inspected author's full matrix, not a separate independent full rerun.

Boundary exception: a later verification helper attempted `git write-tree` solely to obtain a staged tree identifier. This was an incorrect command choice under the read-only index assignment because it tries to create `index.lock`. The sandbox rejected lock creation with EPERM (Git exit 128, helper exit 1); it was not retried or escalated. No index change resulted. The preceding digest outputs were independently available, and no tree identity is claimed. Source freshness was established through read-only index-blob comparisons instead. The only verifier writes were this distinct report and private independent-quick output.

## Acceptance assessment

| AC | Assessment and evidence |
| --- | --- |
| AC1 — documentary agreement and authority | PASS. Intent's dated amendments and spec/plan/index agree on D1–D8, #2651 shared creation versus #2649 adoption/#2650 data, TodayAir retirement and Cordova chart priority. Spec owns current values until token JSON exists; prose owns use/behavior; fixture constants are not presented as tokens. Deferred phases do not supply implementation authority. Common ownership is evident in the index, with an advisory about inheritance wording below. |
| AC2 — licensed local specimen and roles/settings | PASS. Local Pretendard Variable v1.3.9 provenance and accompanying OFL are present; actual font loading was asserted. Thirteen roles including fluid hero are demonstrated. Three tiers, hourly today/yesterday labels, shared-scale daily text/bar geometry, ko/de, appearances and four D2 options are implemented. Full font cost and future production subsets/hosting are explicitly distinguished. |
| AC3 — browser checks and scaling | PASS for reference geometry. Quick execution directly checked spec-derived sizes/weights/leading, font load, page/text/SVG bounds, dot containment, retained today values, visible separated yesterday values, intersections, legend placement, internal scrolling and live control/resize changes in both engines. Source inspection and matching full-run evidence establish the additional tier boundaries, scale floors, 200%/130% root and reflow-equivalent cases. Expectations are parsed from the normative role table rather than the fixture role constants. |
| AC4 — reproducibility, selected visuals, independence and limits | PASS as a verification deliverable; final task completion requires main to retain/link this distinct report and recheck the resulting index. Guides give dependencies, commands and matrix; selected evidence is portable and digest-bound, with raw runs ignored. Current docs correctly distinguish browser geometry from devices/native/provider/product behavior. This report supplies actual independent execution and inspection rather than relabelling author results. |

## Visual observations

Inspected `mobile-baseline.png`, `tablet-baseline.png`, `desktop-baseline.png`, `mobile-130.png`, `tablet-200.png` and `desktop-de-130.png` directly. The hero dominates, hourly/daily cards remain primary, current/yesterday series are distinguishable, negative/two-digit numbers fit their circles, daily extrema are independently printed and the D8 cool-bottom/warm-top bar appearance is visible. Enlarged captures preserve reading order and wrap prose/role samples without hiding it. German desktop enlargement uses narrow-column wrapping/hyphenation without clipping. Tablet-200 retains tablet measurement labels rather than the previous wrong desktop capture tier.

Chart columns partly visible at the right edge of narrow captures are consistent with deliberate internal horizontal scrolling, which was exercised. Daily all-day fit at desktop is visible. The red illustrative marker lies near a value and does not demonstrate production current-time semantics; chronology/marker mapping and full chart parity are explicitly excluded in the maintained guide/evidence. These screenshots support hierarchy and geometry, not physical reading comfort.

## Findings

| Severity | Category | Location | Finding | Evidence / impact | Reproduction | Requirement | Confidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LOW | Documentation | `docs/design-system/documentation-guide.md:10`; `specs/design-system.md:1`; `plans/design-system.md:1` | The guide says every maintained artifact states its owner role, while spec/plan/guide rely on the index's common maintainer instead of explicitly declaring inheritance. | `docs/design-system/README.md:3` supplies a clear common TodayWeather design/frontend owner, so the documentation set has reviewable ownership and this does not block AC1–AC4. Literal per-artifact metadata wording may nevertheless confuse future maintainers. | Compare guide's maintenance bullet with document headers/index. | Guide authority/maintenance; step AC1 | High | Advisory: explicitly record the common ownership inheritance and its scope in the retained evidence/index when closing the task. No human identity assignment or production scope change is needed. |

No BLOCKER/HIGH/MEDIUM findings or unresolved Must Fix findings were identified. The review did not assume that author's PASS alone established acceptance.

## Limits and final owner action

No physical iOS/Android device, Dynamic Type/system font scale, real zoom gesture, iPad trackpad, production UI, complete seven-language product matrix, axe scan, provider response, native build, AWS state or deployment was tested. D3 remains pending. Root doubling and half-width viewport are text/reflow simulations; the browser engine/device labels do not imply physical hardware support. Fixed stress data, simplified icons and static expander/table fixtures do not establish production chronology, AM/PM/precipitation amount, missing/stale behavior, cursor announcements, storage or accessibility parity.

Public reference-app claims and historical source/diagram investigations were consumed as dated context, not freshly externally re-certified. No new Archify artifact/browser/visual result is claimed: the unchanged pipeline remains a proposal and this change has no token-pipeline topology modification. Hook installation, remote CI enforcement, cross-provider PR review and Git integration were not performed or inferred.

Main must copy this report as selected dated evidence, link it without maintained dependence on ignored runs, clarify common ownership inheritance, and run the read-only artifact checker against that final intended index. The source candidate and this report's verdict should remain distinguishable from any later changed source candidate. After those retention actions, the bounded local task can complete with the stated device/product limitations.
