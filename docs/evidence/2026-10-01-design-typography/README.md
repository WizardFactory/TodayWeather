# Typography verification — 2026-10-01

Scope: AK-authorized steps 1–2 of [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651): documentation reconciliation and isolated typography references. Current base `6ec6c68ceb518e22382ba2c24428964d4d2e0e67` after authorized `git pull origin master`; original investigation base `481aa49d`. Author root Codex/OpenAI. [Guide and reproduction](../../design-system/typography.md). No production UI, native runtime, shared token package, provider calls or deployment changed.

## Observed results

- `npm ci --ignore-scripts --no-audit --no-fund`: passed, 65 packages. No lockfile changes.
- JavaScript syntax checks: passed for reference and verifier.
- Local Markdown links: 7 documents / 24 targets checked before evidence indexing, no missing targets. A final link check includes the evidence index.
- Browser matrix: **672 renders passed**, **28 control/resize checks passed**. Chromium **153.0.8010.12**, WebKit **26.6**; Pretendard Variable **v1.3.9** (local full woff2, 2,057,688 bytes).
- Initial matrix found four compact German WebKit/200% text failures. A compact manual-hyphen/anywhere wrapping rule corrected them; the complete matrix was rerun with zero findings. Near yesterday labels are suppressed while separated yesterday labels and all today's values remain visible.
- Visual inspection then caught Chromium full-page capture changing touch media. Reference-only rendering is frozen during capture; touch emulation is restored with a retained CDP session and measured tier/body are rechecked. Earlier mismatched captures are not accepted evidence.
- Main visual inspection: mobile Korean baseline/130%, tablet Korean 200% dark, desktop German 130% dark; compared with retained Cordova hourly/daily screenshots for information hierarchy. Label sizes and internal chart scrolling are legible in the inspected captures. This is not a claim of physical-device comfort or complete production chart parity.

## Selected durable captures

These six captures are retained to demonstrate baseline hierarchy and enlargement across three tiers; bulk repeated captures remain local/ignored.

| Reference | Capture |
| --- | --- |
| Mobile 402×874, ko, light, 100% | [Baseline](mobile-baseline.png) |
| Tablet 820×1180, ko, light, 100% | [Baseline](tablet-baseline.png) |
| Desktop 1440×900, ko, light, 100% | [Baseline](desktop-baseline.png) |
| Mobile 402×874, ko, light, 130% | [Enlarged setting](mobile-130.png) |
| Tablet 820×1180, ko, dark, 200% root | [Enlarged root](tablet-200.png) |
| Desktop 1440×900, de, dark, 130% | [Long Latin sample](desktop-de-130.png) |

[Browser summary and measured-source hashes](browser-summary.json) retain the tested source identities, engine versions, counts, and exact selected capture provenance. The complete authored-source set is recorded in [source digests](source-digests.json); hashes exclude this evidence record and mutable execution logs to avoid self-reference.

## Limits and remaining work

The [fresh-context independent report](independent-verification.md) records PASS with no Must Fix findings: Chromium/WebKit 72 renders and 6 control checks independently passed, all 15 source and 6 capture hashes matched, and six selected images were directly inspected. This is same-provider independent verification, not cross-provider PR review. The author's full 672-render result is distinguished from the verifier's smaller execution. Browser emulation uses primary-pointer settings. Root doubling tests 200% text; half-width desktop tests reflow equivalent. Real browser zoom gestures, physical iOS/Android system settings, iPad trackpad behavior and full seven-language PWA coverage were not exercised. D3 integration stays pending.

Fixed weather stress data and simplified icons support typography only. Native provider/data normalization, chronology/current marker mapping, AM/PM and precipitation-amount states, persisted preferences, all production components and complete accessibility scanning remain later adoption work. Existing Archify pipeline source/HTML were preserved because topology did not change; no new diagram validation is claimed.

The master pull introduced the repository artifact checker, versioned hooks and CI workflow. This task follows [retention policy](../../development/artifact-retention.md) and runs the checker on its intended index; hook installation and remote CI enforcement are not claimed. Location-bound original diagram delivery receipt is preserved under ignored reports; portable source JSON/HTML remain. Selected evidence and reference assets belong in the repository; raw reports are disposable. No commit, PR, remote issue update, mobile build or deployment was performed.

## Ownership and verification closure

The common **TodayWeather design/frontend owner** in the design-system index is inherited by the intent, specification, adoption plan, documentation guide, typography guide and reference assets in this documentation set. This is a role assignment, not a named person's approval. The verifier's LOW ownership-wording advisory is clarified here without changing the frozen source candidate. Repository-wide retention policy retains its separate ownership.

This report and the independent report are selected dated evidence, excluded from the authored-source aggregate to avoid self-reference. The final evidence-inclusive staged artifact check is recorded at local completion; raw independent browser runs stay ignored. No author source changed after the independent verification.
