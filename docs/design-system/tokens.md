# Shared design tokens

Status: implemented reference outputs, 2026-10-01. Owner: TodayWeather design/frontend owner. Related: #2651 creation, #2649 production adoption. Source: [tokens.json](../../packages/design-tokens/tokens.json). The JSON is authoritative for executable numeric values; [spec](../../specs/design-system.md) owns usage and behavior. Production PWA imports remain deferred.

Primitive holds raw DTCG values, semantic names meaning, component aliases only a named semantic deviation. Explicit types follow the [2025.10 Format report](https://www.designtokens.org/tr/2025.10/format/) and [Color report](https://www.designtokens.org/tr/2025.10/color/). Supported subset: srgb color, px/rem dimension, number, font family/weight, ms/s duration, cubicBezier and shadow. This is a strict local subset checker, not complete DTCG schema/Resolver conformance. Group inheritance, JSON Pointer aliases and non-srgb spaces are intentionally unsupported. Tokens declare explicit types; aliases use `{semantic.path}`.

The `org.todayweather` extension records appearance/tier variants, floors, numeral intent, mandatory roles and contrast contracts. Color variants are light/dark; type/layout are mobile/tablet/desktop with wide desktop overrides. Tier precedence matches spec §3.2. The generator validates all six base contexts, required roles/full tiers, missing refs/cycles/type mismatches, component hierarchy, names and contrast before writing any file. Required text pairs need 4.5:1 and meaningful edges/focus 3:1. Decorative fills and grid lines have no sole information role. D8/AQI fills require edge and text; their raw fill is not certified as text.

```sh
npm ci --ignore-scripts
npm run generate:tokens
npm run test:design
npm run gallery
```

Five reproducible outputs live under ignored `packages/design-tokens/generated/`: CSS custom properties, TypeScript literal values and TokenName union, equivalent JavaScript values for the standalone gallery, a machine-readable token reference and full contrast pairs. Do not edit or commit output. `npm run gallery` validates/regenerates before serving, so a clean checkout works. No network font or production backend is needed. No root `html` font-size rule is generated.

Set `data-appearance="light"`, `"dark"` or `"system"` on the root; an unset attribute follows the OS color scheme. Appearance blocks emit only values that differ from the light base, so system dark cannot reset the responsive type/layout tier. Compact coarse-pointer rules follow wide overrides and retain mobile sizes on screens below 540px tall, including coarse pointers with hover. Gallery CI also checks OS light/dark × explicit/system/unset appearance and real computed CSS across six profiles. The coarse+hover profile synthesizes input-capability media features in CSSOM; it is a cascade regression, not physical-device certification.

```css
.card { background: var(--tw-bg-surface); border-radius: var(--tw-card-radius); }
.body { font-size: max(.8125rem, calc(var(--tw-type-body-size) * var(--tw-text-scale))); }
```

```ts
import { tokens, type TokenName } from '@todayweather/design-tokens/types';
const name: TokenName = 'text.primary';
const color = tokens.values['dark.tablet'][name];
```

Public property names omit `semantic.`/`component.`. Primitive values are not exported for component CSS; component and semantic CSS-name collisions fail. The today-dot foreground is `chart.today-on` to avoid treating a token as a nested group. `control.edge` is the meaningful input/button boundary, rather than decorative `border.strong`. Daily-bar edge is solid `#637088`/`#94a3b8`, preserving the specified D8 stops while meeting shape contrast.

For a rule change: edit JSON → run token tests/generator → update behavior documentation/examples and affected gallery checks → inspect captures → verify actual index. Renames require migration notes/aliases before consumers switch. Native/Cordova exporters, production pre-scripts, font subsetting/hosting, stored preferences and app-wide literal linting remain #2649 or separately authorized native work. Local full-font reference cost is documented in the typography guide.


## Production consumer (#2649)

The generator now also emits identical outputs to ignored `web/src/generated/` and generates the same-origin prepaint theme script. Root `predev/pretypecheck/pretest/prebuild/prebuild:web` and web `predev/prebuild` run it; unchanged output bytes retain their timestamps. The React PWA consumes these token outputs and self-hosts Vite-hashed Pretendard Variable plus its OFL license. `tw.web.v1.display` owns validated appearance, background, text scale, chart expansion and motion; legacy `settings.theme` remains a dual-written rollback value. See the [production adoption contract](../../specs/pwa-design-adoption.md). Native app/widget adoption is separate.
