# TodayWeather design system

Status: shared tokens and isolated typography/chart/component references (2026-10-01, current base `6ec6c68c`; original investigation/diagram base `481aa49d`). Shared creation is tracked in [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651), production PWA adoption in [#2649](https://github.com/WizardFactory/TodayWeather/issues/2649), and missing life-index data in [#2650](https://github.com/WizardFactory/TodayWeather/issues/2650). The production PWA still uses its original stylesheet. Maintainer role: TodayWeather design/frontend owner.

| Read | Purpose |
| --- | --- |
| [Specification](../../specs/design-system.md) | Principles; responsive typography; the Cordova hourly and daily charts as core content; color and contrast on every surface; weather visualization; components; accessibility; verification; decisions D1–D8 (AK, 2026-10-01) |
| [Adoption plan](../../plans/design-system.md) | Phases: tokens → typography → Cordova charts → color → space → components → sky → optional native |
| [Intent](../../intent/design-system.md) | Request, acceptance criteria and the typography-first and core-charts amendments |
| [Documentation and planning guide](documentation-guide.md) | Required deliverables, templates, authoritative sources, lifecycle/status and evidence rules |
| [Token usage guide](tokens.md) | JSON architecture, generation, typed outputs, contrast policy and migration |
| [Chart and component gallery](gallery.md) | Standalone gallery, chart fixture contract, keyboard controls and verification |
| [Typography verification guide](typography.md) | Selected role sizes, scaling/tier rules, local reproduction, browser matrix and device limitations |
| [Interactive typography reference](references/typography.html) | Locally hosted Pretendard; ko/de; light/dark; 90/100/115/130%; 200% root text; core chart text |
| [Dated typography evidence](../evidence/2026-10-01-design-typography/README.md) | Measured outcomes, retained screenshots, source identities, reproduction and verification limitations |
| [Token pipeline diagram](diagrams/token-pipeline.html) | Token source → generator → web and native consumers → tests ([editable JSON](diagrams/token-pipeline.json)) |

**Core content.** The Cordova hourly chart and daily chart come first. The hourly chart plots today's temperature against yesterday's and marks the current time. The daily chart shows min–max bars on one shared scale, including past days. The bars use the PWA's cool-to-warm gradient, `#9bcdf0` to `#f0c77f` (D8). They keep their information model on every screen size, and the PWA's daily list becomes their table alternative.

**Typography.** [Spec §3](../../specs/design-system.md#3-typography-ac2-first-priority) is the normative role table. Tier selection uses viewport and primary pointer with explicit precedence, independently of layout. The [reference and guide](typography.md) demonstrate the values and their scale floors. Browser checks validate geometry and font metrics; physical-device reading comfort and D3 system scaling still require device comparison.

**Current adoption boundary.** Documentation and an isolated reference are available. The shared token package/generator and standalone chart/component gallery are implemented. Production PWA migration remains later work. Cordova/native output and widget alignment are deferred; TodayAir is retired and its source is historical only. The historical token pipeline diagram is unchanged; its optional native outputs remain deferred.

**References.**
- The Cordova app (`client/`).
- The iOS 27 Weather app, from public reporting.
- The Samsung Weather app on the Galaxy S26 (One UI 8.5).

No Apple or Samsung assets are used.
