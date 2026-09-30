# Documentation and planning deliverables

Status: approved guidance for [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651), reconciled 2026-10-01 at base `6ec6c68c` after AK-authorized master pull. Applies to shared rules and PWA reference outputs. [#2649](https://github.com/WizardFactory/TodayWeather/issues/2649) owns production PWA adoption; [#2650](https://github.com/WizardFactory/TodayWeather/issues/2650) owns missing life-index data. Follow the [repository artifact-retention policy](../development/artifact-retention.md); this guide adds design-specific requirements without replacing repository rules.

## Authority and maintenance

- [Intent](../../intent/design-system.md) records dated requests and amendments; later explicit AK decisions supersede earlier proposals. [Specification](../../specs/design-system.md) is the current normative rule/value reference. [Plan](../../plans/design-system.md) describes adoption and does not authorize deferred work.
- This guide owns documentation structure and maintenance. The [index](README.md) owns navigation/status and links to rules rather than duplicating them. Once the token package exists, token JSON becomes authoritative for numeric values and generated reference tables; prose owns usage and behavior. Until then, specimen constants are reference fixtures checked against the spec, not shared tokens.
- The common TodayWeather design/frontend owner in the index is inherited by this documentation set unless an artifact names another owner. Every maintained artifact states its status (proposed/approved/implemented/deferred), reviewed date/revision, related issue, owner role, and unresolved dependencies. An implemented reference is not an implemented product feature.
- Keep historic intent/spec/plan context with dated supersession notices. When a rule moves, leave a link to its maintained replacement. Do not keep conflicting active definitions.
- Change a rule, its examples and affected checks together. Record rationale and affected consumers; token renames/removals later require an alias/migration note. Native/Cordova adoption needs its own authorized implementation work.

## Deliverable requirements

| Deliverable | Minimum contents | Current location / status |
| --- | --- | --- |
| Principles and scope | Priorities, shared/platform-specific rules, lifecycle, exclusions, terminology | Spec §1; this guide; approved |
| Responsive typography | Role/use, size, weight, line height, numerals, minimum, tier precedence, user/browser scaling, locale rules, annotated samples | Spec §3; [typography verification guide](typography.md); references implemented separately from product |
| Hourly and daily chart planning | Annotated anatomy and reading order; field/unit/time meaning; today/yesterday alignment; current marker; shared axes; missing/stale data; label collisions; scrolling; expander; keyboard/table parity; D8 and past-day treatment | Spec §5; typography reference tests labels/geometry only; normalized reference behavior implemented; production provider adapter deferred |
| Token guide | Names, types, units, alias hierarchy, modes, allowed surfaces, semantic/component choice, CSS/TS examples, generation/change commands, machine-generated value reference | Spec §2/§4/§7; executable token package implemented under packages/design-tokens; generated numeric reference |
| Component inventory | Anatomy, token roles, applicable default/selected/focus/disabled/loading/error/stale states, interactions, responsive behavior, accessible name/role, keyboard/focus, localization | Spec §8; interactive reference gallery implemented; production adoption deferred |
| Screen planning | Mobile/tablet/desktop compositions, content hierarchy, annotated role/layout choices, light/dark and enlargement examples, unavailable-data states | Spec §5.3; typography and chart/component references now; production screens deferred |
| Decisions and adoption | D1–D8, rationale, sources and evidence limits, unresolved dependencies, phase deliverables/checks, owner role, follow-up issues | Spec §14; plan; approved |
| Verification | Candidate identity, font/browser versions, commands, test matrix/results, inspected images, independent findings, unperformed device checks | Typography guide and selected dated evidence; generated runs under ignored reports |

## Planning templates

For each **screen**, record: purpose → content order → mobile/tablet/desktop layout → type/token roles → navigation/actions → loading/empty/error/stale behavior → localization/accessibility → reference images → verification and dependencies.

For each **chart**, add: source fields and units → observation/forecast timestamp semantics → missing/sentinel handling → scale and marker geometry → scrolling/label collision strategy → cursor announcement and table mapping. Do not invent unavailable measurements or substitute a reference fixture for provider evidence.

For each **component**, record only applicable states, with explicit reasons for exclusions; not every component has every interactive state. Link shared patterns instead of repeating their rules.

For each **phase**, record: scope and deliverables → prerequisites/owner role → affected consumers → objective checks → risks/rollback → remaining work. Prioritize typography and the two core charts; metric switching remains excluded by D7.

## Acceptance and evidence

- Verify links from repository paths; maintained docs must not depend on ignored local reports. Keep selected reference captures and essential dated findings in versioned evidence, with reproduction commands and digests.
- Use ko and a long Latin sample (de) for typography references. Full seven-language product coverage remains in #2649. Record tested pointer/viewport/root/setting combinations rather than claiming generic device support.
- Record measured assertions and visual findings separately. Screenshot existence alone is not a readability result. Browser emulation, physical devices, provider responses and deployment are separate evidence categories.
- Reference-app features retained from public reporting are inspiration, not verified device behavior; S26 is AK's corrected reference. Do not copy Apple/Samsung assets.
- Follow repository CI retention (30-day diagnostic artifacts) without publishing broad execution directories. Raw runs are disposable; selected evidence plus reproducible checks are the durable record. Run the repository's read-only artifact checker on intended staged files; local hook installation and remote CI enforcement are separate claims. Device-specific D3 remains open until an actual iOS/Android comparison is recorded.
