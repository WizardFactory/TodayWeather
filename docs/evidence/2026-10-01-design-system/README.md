# Design-system creation evidence — 2026-10-01

Owner: TodayWeather design/frontend owner. Author: root Codex/OpenAI. Scope: #2651 authorized steps3–5, standalone tokens/charts/gallery, pre-merge without integration. Original typography evidence remains a separate dated record.

Actual checks: token/model12 passed; generated TypeScript and existing app typecheck passed; existing151 tests passed.435 source tokens;606 allowed appearance/tier/foreground-background contrast pairs validated before output. Generated output hashes were identical across repeated generation. Chromium153.0.8010.12 and WebKit26.6:128 renders,8 control groups, zero serious/critical axe findings. Matrix:402×874 touch,820×1180 touch,1440×900 fine and320×694 touch ×ko/de ×light/dark ×100/130% ×16/32px root ×2 engines. Control checks exercise cursor, table parity, resize focus, expander, tabs, input errors, modal focus/Escape/restore, state samples and reduced/forced colors. Server path restrictions and external request blocking were exercised.

| Tier | Light | Dark |
| --- | --- | --- |
| Mobile | [402×874](mobile-light.png) | [402×874](mobile-dark.png) |
| Tablet | [820×1180](tablet-light.png) | [820×1180](tablet-dark.png) |
| Desktop | [1440×900](desktop-light.png) | [1440×900](desktop-dark.png) |

Selected six captures retain baseline compositions; bulk repeated runs remain ignored. Main inspected mobile-light,tablet-dark,desktop-light plus earlier contrast counterparts; chart/header hierarchy, visible negative/missing extrema and card wrapping were assessed. Source/capture hashes and PNG dimensions are in [verification summary](verification-summary.json). [Reproduction and behavior limits](../../design-system/gallery.md), [token usage](../../design-system/tokens.md). Source aggregate is recorded in [source digests](source-digests.json). Evidence outputs are excluded from the source aggregate to avoid self-reference.

Initial first token test had a syntax setup failure, preserved as a failed attempt and not accepted Red. Corrected tests were exercised against an isolated preimplementation empty stub for assertion Red, then real Green/post-refactor. The first chart-model assertions failed against empty model APIs before implementation. Initial gallery root-relative resource404 was fixed; a later resize/hover cursor race was caught and corrected. Only the final matching source/captures support acceptance.

This does not certify physical devices, real zoom gestures, native D3, all seven languages, provider unit/sentinel/timezone adaptation, storage/refresh/retry, production PWA adoption or AWS deployment. Normalized fixtures use explicit offsets and Korea24h yesterday comparison. Full font is local reference-only; production subset hosting remains deferred. Independent verification and PR review are separate pre-merge duties retained in the actual PR record after execution; this author's results are not independent. CI diagnostic artifacts expire after30 days; these selected assets/summary remain maintained.
