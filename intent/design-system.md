# TodayWeather design system
Current authority (2026-10-01): shared creation [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651), PWA adoption [#2649](https://github.com/WizardFactory/TodayWeather/issues/2649), life-index data [#2650](https://github.com/WizardFactory/TodayWeather/issues/2650). Dated amendments below supersede conflicting initial assumptions and exclusions.
Source: AK chat request on 2026-09-30, "todayweather를 위한 디자인 시스템 설계", amended in the same turn to reference the existing Cordova app, the iOS 27 built-in Weather app and the Samsung "S29" Weather app. Mode plan-only, endpoint local: write intent, spec, plan and design diagram; no source, style, asset or build change.

## Problem
TodayWeather is moving from the Cordova app (`client/www/`) to the responsive PWA in `web/`, while iOS widgets and the watch keep their own styling. Visual decisions (color, type, spacing, weather/air-quality color scales, icons, motion) live as literals in individual stylesheets and native code, so surfaces drift and new screens re-decide the same things. There is no maintained reference for brand continuity from the Cordova app or for which platform conventions the product should follow.

## Desired outcome
A single, implementation-ready design system specification that `web/` can adopt incrementally and native surfaces can consume through generated tokens.

## Acceptance criteria
- AC1: Principles and brand continuity are grounded in the existing Cordova app and PWA, with cited source locations.
- AC2: A token architecture (primitive → semantic → component) with concrete values for color (light/dark), type, spacing, radius, elevation/material, motion and breakpoints, plus the mapping from current literals.
- AC3: Weather data-visualisation rules: temperature scale, precipitation, wind, UV, air-quality grade colors per the KR standard used by the service, yesterday comparison, warnings, and condition-driven backgrounds, each with non-color redundancy.
- AC4: A component inventory with anatomy, states and responsive behavior covering current PWA screens, informed by the iOS 27 and Samsung Weather patterns (highlights summary, switchable forecast metric, activity/life index, detail cards).
- AC5: Accessibility and i18n requirements (WCAG 2.2 AA contrast, target size, reduced motion, text scaling, seven languages) that are testable.
- AC6: Multi-platform delivery design (token source → web CSS variables, iOS asset catalog/Swift, watch), with an Archify diagram validated by its artifact, browser and visual checks.
- AC7: An ordered, reversible adoption plan with file operations, verification (visual regression across existing layout matrix) and risks.

## Out of scope
Changing `web/`, `client/`, native or widget code; new icon artwork; copying Apple or Samsung proprietary assets, typefaces or animations; production deployment; issue or PR creation.

## Assumptions and open questions
- "Samsung S29" is not a verifiable device on 2026-09-30; the current Samsung Weather generation (One UI 8/8.5 on Galaxy S26) is used. AK may correct.
- Reference-app observations come from public reporting, not device inspection.
- Brand color/typeface changes beyond continuity require AK's product decision; the spec proposes defaults.
- Historical assumption, superseded: TodayAir remains a variant of one combined web product. AK confirmed TodayAir retirement on 2026-09-28; retained source is a reference, not an active consumer (docs/architecture/service-overview.md).

## Risks
Visual regressions when replacing literals; contrast failures on animated/gradient backgrounds; bundle/performance cost of motion; native-widget compatibility if shared preference keys or assets change.

## 2026-09-30 amendment: typography first
Source: AK, same session: "무엇보다 글자 사이즈를 desktop / tablet / mobile 를 고려한 적절한 사이즈를 결정하는 것이 매우 중요함". The responsive type scale becomes the primary deliverable and the first adoption phase. AC2 now requires, before other token groups, per-role font sizes, weights and line heights for mobile, tablet and desktop, the rule assigning a viewport to each tier (including landscape tablets and desktop windows narrower than 1024 px), a minimum size floor, the hero-temperature rule, user text-scaling behavior and the verification that proves them. Other ACs are unchanged; downstream stages are refreshed.

## 2026-09-30 amendment: Cordova charts are the core content
Source: AK, same session: "cordova에 들어간 시간별날씨 차트, 일별날씨 차트 매우 중요함 가장 중요한 컨텐츠임". The Cordova hourly chart (3-hourly today/yesterday temperature lines with value circles, current-time marker, icons, precipitation, day titles, wind/humidity expander) and daily chart (weekday/date columns including past days, AM/PM icons, precipitation, vertical min–max bars on one shared temperature scale, current-temperature marker) are the product's primary content. AC3 and AC4 now require a chart specification that preserves their information model and reading order on every tier, defines how their typography, colors and geometry scale, and replaces the PWA's divergent daily list with the Cordova daily chart as the default daily view. Reference-app patterns may add to the charts but must not replace them. Other ACs unchanged; downstream stages are refreshed.

## 2026-10-01 amendment: AK decisions
Source: AK, same session.
- D1: self-host Pretendard, served by the existing S3 + CloudFront static hosting.
- D2: keep the recommendation (in-app text size 90/100/115/130%).
- D3: review against the Cordova app's text-scaling behavior, then adjust.
- D4: keep the legacy 6-grade hues.
- D5: keep the recommendation. When life-index data is missing, track it in a separate issue.
- D6: the Samsung reference is the Galaxy S26 (One UI 8.5).
- D7: keep the current approach, with no MetricSwitcher. The Cordova chart plus its expander stays.
- D8 (new): apply the PWA daily list's temperature-bar colors to the Cordova-style daily chart bars.

AK also requested publishing the organized content as issues. This supersedes the plan-only "issue creation out of scope" exclusion for issue creation only. Code, commits and PRs remain out of scope.

## 2026-10-01 amendment: shared creation and steps 1–2

Source: AK approved a new parent issue with shared design rules and PWA-first reference outputs, then requested "2번까지 진행". #2651 is the shared-creation issue; #2649 remains production PWA adoption and #2650 remains data acquisition.

Authorized now: reconcile the existing planning documents, define documentation/planning deliverables, and build/verify isolated typography reference screens. This supersedes the earlier exclusion of reference styles/assets only for this task. The production PWA, Cordova/native runtime, shared token package, AWS deployment and external publication are excluded from this local step. TodayAir is a retired historical reference. Physical-device D3 comparison remains pending.

Step acceptance:
- AC1: Current documents agree on D1–D8, issue ownership, lifecycle, and source-of-truth rules.
- AC2: A locally hosted, licensed Pretendard specimen demonstrates all roles, mobile/tablet/desktop tiers, hourly/daily chart text, and 90/100/115/130% settings.
- AC3: Browser verification checks type sizes, tier boundaries, scale floors, overflow and chart-label collisions, including 200% text/root enlargement and reflow-equivalent width.
- AC4: Reproduction instructions, selected visual evidence, independent verification, and browser-versus-device limitations are retained.

## 2026-10-01 amendment: incoming documentation policy

AK requested `git pull origin master` and applying the new document-management guidance while continuing. Pull fast-forwarded from `481aa49d` to `6ec6c68ceb518e22382ba2c24428964d4d2e0e67`, preserving scoped local work via a pre-pull backup. Follow [repository artifact retention](../docs/development/artifact-retention.md): maintained docs/tools and selected evidence are separate from ignored raw runs; validate intended staged content with the repository checker. Product implementation and remote publication remain excluded.

## 2026-10-01 amendment: creation steps 3–5 and pre-merge

AK requested “pre-merge까지 진행”, followed by shared token JSON/CSS/TypeScript generation and validation, Cordova hourly/daily reference implementation, component gallery and push. This supersedes the preceding local endpoint and token/gallery exclusions. Preserve the initial typography evidence as dated historical evidence.

Authorized: shared token package, generator and tests; standalone PWA-first hourly/daily references and interactive component gallery; scoped commit/push, PR creation, CI and corrections; task code/tests/evidence transfer to the existing OpenAI author and configured Anthropic/Paseo reviewer, using existing GitHub hwanjjang authentication. Reviewer uses the catalogue's latest released Claude model, medium effort and auto mode. No new accounts, secret transfer or permission-setting changes. Stop at pre-merge: no merge, auto-merge, merge queue or production deployment. Actual product-wide adoption remains #2649; native runtime/widget work and physical D3 stay deferred.

Additional acceptance:
- AC5: DTCG-style primitive → semantic → component JSON has every required role/category; aliases/types and allowed-surface contrast are validated; CSS/TypeScript output is deterministic and reproducible from a clean checkout.
- AC6: Hourly/daily references preserve Cordova field order, shared temperature axes, today/yesterday alignment, current observation marker, null/stale states, AM/PM and precipitation, wind/humidity expander, keyboard cursor and equal-valued table alternatives; D8 gradient and past dates remain.
- AC7: Gallery demonstrates buttons, inputs, tabs, cards, settings, dialogs, loading/empty/error/stale states in light/dark and three tiers, with accessible names/focus/keyboard interactions, selected captures and zero serious/critical automatic accessibility findings. Push/PR/CI and different-provider independent verification/review must satisfy pre-merge readiness, with merge explicitly unarmed.
