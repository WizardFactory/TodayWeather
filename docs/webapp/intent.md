# Webapp design intent

Original planning date: 2026-09-24. Current status: static client implemented; deployment method deferred. This document preserves the original planning acceptance and records the subsequent static-only decision.
Source baseline: `87b8855f308611a07897cd3a39c45fefb3088d77`.

AK requested planning/design for a deployable web client alongside iOS and Android, and explicitly prioritized matching existing mobile features as closely as possible.

The target is a responsive TodayWeather web application, installable as a PWA, preserving weather/air information and workflows from both TodayWeather and TodayAir. A single product with weather-first and air-first startup modes is a proposal; separate branding remains an AK decision. Preserve existing international weather where the live API supports it; Korean nationwide maps and warnings remain KR-specific.

Feature parity means equivalent user outcomes and meteorological meaning. It does not mean copying known defects, mobile pixel layouts onto desktop, or claiming browsers provide native widgets, silent background location or store receipt access.

## Current decisions

The web client calls the existing public API directly and is prepared for private S3 + CloudFront at `app.tdywx.xyz`. The requested bucket is `tdywx-app-141248341265-apne2`. The unused Node API workspace, proxy mode, Docker recipe and web reminder service are removed. Browser notifications display unavailable/mobile-app guidance; full mobile parity remains open. No additional API server is required for the current client. Deployment method selection is deferred.

## Acceptance of the original planning task

| ID | Observable deliverable |
| --- | --- |
| AC1 | All S01–S16 legacy screens and native integrations have a target, alternative or explicit decision in the parity matrix. |
| AC2 | Mobile/desktop navigation, primary journeys, permissions, stale/partial/offline/error states and accessibility are specified. |
| AC3 | Repository-grounded technology/API/data/storage/push boundaries and alternatives are documented; source facts and proposals are separated. |
| AC4 | Proposed hosting, isolated environments, rollout/rollback, work packages, conditional estimates and launch prerequisites are actionable. |
| AC5 | Local links/source anchors and the Archify diagram are checked; artifact, browser and visual evidence are reported separately. |

## Authority and boundaries

The original planning task ended with local documents and diagrams. Later user instructions authorized implementation and PR work; that original planning boundary does not prohibit those subsequent tasks. It does not grant production deployment, purchases or provider onboarding. Current implementation and release boundaries are maintained in [implementation status](implementation.md).

The eventual web rollout must preserve mobile API versions, native builds, collectors, database versions and existing push consumers. Plan new web components separately; any legacy server correction must carry its own regression evidence and compatibility review.

## Decisions remaining with AK

- Confirm one combined TodayWeather web product versus separate TodayWeather/TodayAir brands.
- Choose free/ad-supported launch versus paid web entitlements and native-purchase linking; do not silently remove commercial features from a parity promise.
- Select the deployment method, budget/operations owner and target date for `app.tdywx.xyz`.
- Decide whether native widget/watch alternatives are acceptable and whether login/device synchronization is desired beyond the existing local-storage experience.

Recommended defaults are developed in the [specification](specification.md); the [implementation plan](implementation-plan.md) identifies when each decision is needed. An internal read-only milestone is not the final feature-parity release.
