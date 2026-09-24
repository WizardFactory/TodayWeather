# Webapp parity design handoff

Date: 2026-09-24. Mode: plan-only. Endpoint: local. Baseline: `87b8855f308611a07897cd3a39c45fefb3088d77`.

## Delivered

- [Overview](../../../docs/webapp/README.md), [intent](../../../docs/webapp/intent.md), [product specification](../../../docs/webapp/specification.md), [technical design](../../../docs/webapp/technical-design.md), [implementation plan](../../../docs/webapp/implementation-plan.md).
- [Standalone architecture](../../../docs/webapp/diagrams/webapp-architecture.html) and [source JSON](../../../docs/webapp/diagrams/webapp-architecture.json).
- Repository README entry, source research, stage records, document checker and diagram receipts.

Recommendation: separate responsive PWA, same-origin web BFF over existing versioned APIs, and web-specific subscriptions/notification scheduling. All S01–S16 are mapped, including TodayAir, nation/air, warnings, preferences and commercial/native-only boundaries. An internal core-read milestone does not replace final parity scope.

## Planning acceptance

| Criterion | Outcome / evidence |
| --- | --- |
| AC1 | S01–S16 ledger plus cross-cutting native integrations; decision rows are explicit, not implemented or silently waived. |
| AC2 | Responsive navigation, seven journeys, permission/cache/partial/offline/error behavior and accessibility targets specified. |
| AC3 | Source-rechecked browser/API/unit/storage/push boundaries, alternatives, official browser/hosting references and typed adapter direction. |
| AC4 | Ordered work packages, conditional 8–12 week estimate, optional commercial increment, release gates, migration/rollback and operations responsibilities. |
| AC5 | Local link/coverage/source/digest checks, deterministic artifact validation, real Chromium containment/captures and image review; evidence below. |

## Verification evidence

Run `python3 reports/sdlc/webapp-parity-design/check-documents.py`; its retained output is [document-check-results.json](document-check-results.json). It checks local Markdown links, screen coverage, selected current-source anchors, exact diagram hashes/bytes, artifact/browser receipts, source baseline and whitespace. Semantic assessment was performed by main; the script is not independent review.

Diagram: [delivery receipt](diagram-delivery.json), [browser receipt](diagram-browser-command.json), [visual handoff](diagram-handoff.json), [assessment](design-validation.md). Showcase passed 9/9, zero composition errors/warnings. Real Chromium measured 1440×900, 1600×1000, 1920×1080, 2048×1320; no document overflow. Main inspected all four light/dark endpoint captures. No product UI behavior or every viewer control/export interaction is claimed from these checks.

Specification SHA-256: `c379cb4cf72ab009947f6fadd556ddd02ba99815f4ed928b479c299ed3e88b51` (4796 bytes).
HTML SHA-256: `c8dcf67c9c923f97c777f2a95aaf7f50798ecd3d4dca350da477bb5b77536a05` (811453 bytes).

The initial renderer sandbox restriction and missing automatic Chrome discovery were repaired using authorized local execution and the existing installed Chromium path. Final actual commands passed; neither initial failure was relabeled as a pass. Screenshot sidecars remain local-only under repository policy; delivered HTML is self-contained.

## Remaining product and release decisions

AK still decides unified/separate branding, production monetization/native-purchase linking, domain/budget/owner, and acceptance of native widget/Watch differences. Current gateway/provider availability, international coverage, unit correctness, data/asset rights, push condition semantics/capacity and real-device delivery require implementation-stage evidence.

This completes the requested planning endpoint, not release readiness. No application code, native bundle, legacy server behavior or cloud resource changed. No application tests, live API/provider calls, deployment, purchase, commit, PR, independent verification or cross-provider review occurred. Independent assessment was explicitly excluded for this bounded local non-implementation proposal; it remains necessary for implementation readiness.
