# Localization inventory

Source baseline: `bd6640f2` (re-baselined 2026-09-25 from `ff7acf3996ccb66c912d2ed4710cf300197d6966`; client, iOS and watch source identical to `ff7acf39`). Neither `server/locales` nor `client/www/locales` changed upstream, so the §5 file counts carry over; the server reference counts in §5 and the fallback search in §2 were rerun at `bd6640f2` with the same results. The static web client added upstream is listed in §1. This file lists the languages each surface supports, where the resources live, how a locale is chosen, and whether the resource key sets match. Statements are **observed source** unless labelled otherwise. **Synthetic execution** means a Node VM run of a function copied verbatim from the checkout. The harnesses are not checked in; [§7](#7-reproduce-the-counts) describes how to rebuild them. **Historical deployment** refers to the dated 2026-09-20 gateway excerpts in the architecture documents. **Library expectation** is the documented behavior of a library whose code is not in this checkout; it is unverified. **Proposal** marks rewrite guidance. No server, app, simulator, provider, database or AWS call was made.

The per-request header chain is already documented in [client data contracts — language negotiation](client-data-contracts.md#language-negotiation). It covers weather and geocode through the gateway, national and warning requests direct to the service host, the push list and UI strings. The gateway facts are in [AWS/code correlation](../architecture/aws-code-correlation.md#mobile-request-exact-public-to-backend-mapping) and the [deployed Lambda excerpts](../architecture/deployed-lambda-excerpts.md). This file does not repeat them.

**How to use during a rewrite.**

- Treat §1 as the locale list to preserve or to change on purpose. Record any change in [decisions and open questions](decisions-and-open-questions.md).
- Use §2–§4 to reproduce the current selection rules, or to replace them deliberately. Proposal: every client should send an explicit, canonical language on each request whose response contains server prose. The server should then resolve that language in one documented place.
- Resolve the §5 findings before migrating strings. That section compares files only. It does not show which strings a screen actually displays.

## 1. Locales per surface

| Surface | Locales | Resource files | Entries per locale | Selection input | Missing or unsupported input | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Server response prose (Express `i18n`, `^0.8.3`) | `en, ko, ja, zh-CN, de, zh-TW` | [`server/locales/<locale>.json`](../../server/locales) | 322 keys | `twcookie` cookie, then `Accept-Language` (§2) | Source comment: "other locales default to en silently". No `defaultLocale` option is set; the library default is expected to be `en` (library expectation) | [app.js#L61-L74](../../server/app.js#L61-L74), [package.json#L41](../../server/package.json#L41); the lock file added in c80ee014 resolves `i18n` to 0.8.3 ([package-lock.json](../../server/package-lock.json), entry `node_modules/i18n`) |
| Server push text (per message) | Same list, same files (`__dirname + '/../locales'`) | Same | 322 | Stored `pushInfo.lang` → `trans.setLocale` (§3) | The route stores `en` when the header is missing. Workers use `ko` for a record without `lang` | [controllerPush.js#L618-L630](../../server/controllers/controllerPush.js#L618-L630), [#L860-L870](../../server/controllers/controllerPush.js#L860-L870), [alert.push.controller.js#L531-L546](../../server/controllers/alert.push.controller.js#L531-L546) |
| Client UI (angular-translate) | `en, de, ko, ja, zh-CN, zh-TW`, plus aliases | [`client/www/locales/<locale>.json`](../../client/www/locales), loaded as `locales/<key>.json` | 327 keys | First browser language, then alias matching (§4) | `preferredLanguage('en')`, `fallbackLanguage('en')`. An unmatched tag stays the preferred language (§4) | [app.js#L422-L439](../../client/www/js/app.js#L422-L439) |
| Bundled iOS `www` copies | Same six | [`tw.ios/www/locales`](../../tw.ios/www/locales), [`ta.ios/www/locales`](../../ta.ios/www/locales) | 251 (TW) and 294 (TA) keys | Same alias table ([tw.ios app.js#L164-L171](../../tw.ios/www/js/app.js#L164-L171)) | — | Older snapshots: each lacks 77 (TW) or 34 (TA) client keys and has one extra, `LOC_THANK_YOU_FOR_USING_TODAYWEATHER`. Whether a release build replaces them is covered by [native consumers](native-consumers-and-plugins.md#2-build-variants-and-cordova-plugins), not here |
| iOS Today widgets (TW and TA) | `Base, en, ko, ja, de, zh-Hans, zh-Hant` `.lproj` | `<tw\|ta>.ios/widget/<lproj>/Localizable.strings`, `MainInterface.strings`, `InfoPlist.strings` | 10, 20 and 1 (`CFBundleDisplayName`) entries | iOS bundle localization chosen from the device languages (platform behavior, not executed) | In TA `zh-Hant` the key `LOC_TODAYAIR` is missing (§5) | [tw LocalizationDefine.h#L19-L31](../../tw.ios/widget/LocalizationDefine.h#L19-L31), [ta LocalizationDefine.h#L19-L31](../../ta.ios/widget/LocalizationDefine.h#L19-L31) |
| iOS app display name | Same seven `.lproj` | [`tw.ios/TodayWeather/<lproj>/InfoPlist.strings`](../../tw.ios/TodayWeather/ko.lproj/InfoPlist.strings), `ta.ios/TodayAir/...` | 1 | Platform | — | `CFBundleDevelopmentRegion` is `English` ([TodayWeather-Info.plist#L5-L6](../../tw.ios/TodayWeather/TodayWeather-Info.plist#L5-L6)) |
| Apple Watch (WatchKit 1 app) | `Base.lproj` only | `applewatch/TodayWeather WatchKit 1 App/Base.lproj/Interface.storyboard` | Not counted | — | No localized variants | Directory listing |
| Android widgets | **Source absent** (external plugins) | — | — | — | — | [Native consumers §1](native-consumers-and-plugins.md#1-consumer-inventory) |
| Static web PWA (`web/`, added upstream in 5722be5e and later) | Korean only | No catalog: UI text is literal Korean in `web/src` (`grep -rln "LOC_\|locales/" web/src` finds no key use); `<html lang="ko">` in [index.html](../../web/index.html) | — | None; every direct API call sends a fixed `Accept-Language: ko` ([direct-api.ts#L118](../../web/src/direct-api.ts#L118), branch `webapp-docs-gap-corrections`) | Server prose is always requested in Korean. Normalization errors thrown by `packages/weather-core` (for example `Unsupported weather response`) and a string `error.message` from an upstream JSON error body are displayed unchanged, so they can appear in English; localizing them is deferred with the D50 error-envelope work | [Static web client](../architecture/web-client.md). Its [feature ledger](../webapp/specification.md#feature-parity-ledger) proposes reusing the translation catalog with a browser-locale override; that is a proposal, not implemented |

The widget `Info.plist` files set `CFBundleAllowMixedLocalizations` to true and `CFBundleDevelopmentRegion` to the literal `$(EXECUTABLE_NAME)` ([widget-Info.plist#L5-L8](../../tw.ios/widget/widget-Info.plist#L5-L8), same in `ta.ios`). The effect of that region value is unverified. The widgets set no `Accept-Language` header: the override is commented out ([native consumers §4.1](native-consumers-and-plugins.md#41-request-and-transport)). Server prose in widget responses therefore follows whatever header the platform sends by default, which is not captured.

## 2. Server request locale

1. `i18n.configure` sets the six locales, `cookie: 'twcookie'`, `directory: server/locales` and `register: global` ([app.js#L63-L74](../../server/app.js#L63-L74)). `cookieParser()` runs before `i18n.init` ([L93](../../server/app.js#L93), [L96](../../server/app.js#L96)). Request code relies on the translator that `i18n.init` attaches to `res` (library behavior, inferred from the `ts.__` calls on `res` below).
2. Precedence, as a library expectation for `i18n` 0.8.x: a `twcookie` cookie overrides `Accept-Language`, and the default locale `en` applies when neither matches. The module is not installed in this checkout (the lock file pins 0.8.3 but `server/node_modules` is absent), so this order and the matching rules are unverified. That includes case sensitivity (`zh-tw`), a bare `zh`, script subtags (`zh-Hant-TW`) and q-values. No client or widget sets `twcookie` (`grep -rln twcookie client/www tw.ios/widget ta.ios/widget applewatch` returns nothing). The 2026-09-20 weather/geocode gateway behaviors forward no cookies ([AWS/code correlation](../architecture/aws-code-correlation.md#geocoder-and-layered-caching)), and [client data contracts](client-data-contracts.md#language-negotiation) reports no cookie-forwarding CloudFront behavior in that configuration.
3. Request code passes `res` as the translator, usually named `ts`. Examples: [controllerTown.js#L2145](../../server/controllers/controllerTown.js#L2145), life-index labels [#L2756](../../server/controllers/controllerTown.js#L2756) and [#L3730-L3734](../../server/controllers/controllerTown.js#L3730-L3734), [world summaries](../../server/controllers/worldWeather/controller.ww.units.js#L94-L96) and [warnings](../../server/routes/v000903/route.kma.v000903.js#L75). The response fields that carry this text are listed in [client data contracts](client-data-contracts.md#language-negotiation) and [server response assembly §8](server-response-assembly.md#8-weather-warnings).
4. `register: global` also installs a process-wide translator. Its non-test consumers are fallbacks of the form `translate == undefined ? global : translate` in [lifeIndexKmaController.js#L17-L38](../../server/controllers/lifeIndexKmaController.js#L17-L38), `controllerTown.js` ([#L3619](../../server/controllers/controllerTown.js#L3619), [#L3813](../../server/controllers/controllerTown.js#L3813), [#L5195](../../server/controllers/controllerTown.js#L5195)), [unitConverter.js#L301](../../server/lib/unitConverter.js#L301) and [#L326](../../server/lib/unitConverter.js#L326), [aqi.converter.js#L550](../../server/lib/aqi.converter.js#L550), plus `res || global` in [`makeSummaryAir`](../../server/controllers/controllerTown24h.js#L1349). Every caller found passes `res` (push workers pass their per-message translator). The search was `grep -rnE "\?\s*global\s*:|\|\|\s*global\b" server --include='*.js'`, then a caller search, excluding `test/` and `node_modules`. Library expectation: the global translator would not follow the request locale.
5. Server-to-server forwarding copies the incoming header unchanged:
   - the nation fan-out ([route.nation.js#L57](../../server/routes/v000803/route.nation.js#L57), [#L117-L124](../../server/routes/v000803/route.nation.js#L117-L124); [assembly §6](server-response-assembly.md#6-nationwide-screens-regional-air-plus-http-fan-out))
   - `coord2addr` ([controllerTown24h.js#L1832-L1837](../../server/controllers/controllerTown24h.js#L1832-L1837), [#L1875-L1877](../../server/controllers/controllerTown24h.js#L1875-L1877); [assembly location resolution](server-response-assembly.md#location-resolution-ordered)).

   The legacy `/v000803/geo` controller takes `lang` from the query first, then from the header up to the first `-`. It uses that value for the provider `language=` parameter and for `ko`-only branches ([geo.controller.js#L505-L526](../../server/controllers/geo.controller.js#L505-L526), [#L475-L476](../../server/controllers/geo.controller.js#L475-L476)).
6. Historical deployment (2026-09-20): the weather and geocode Lambdas keep only the text before the first `-` of `Accept-Language` and use `en` when the header is absent ([excerpts](../architecture/deployed-lambda-excerpts.md)). Every Chinese tag therefore reaches Express as `zh`, which is not a configured locale. Library expectation (unverified): Chinese users receive English server prose on gateway paths, and `zh-CN`/`zh-TW` resources are reachable only on direct paths such as national and warning requests.

## 3. Push worker language

| Step | Behavior | Source |
| --- | --- | --- |
| Registration | Client `POST /v000902/push-list` sends `Accept-Language: Util.language` (`navigator.userLanguage \|\| navigator.language`) | [service.push.js#L244](../../client/www/js/service.push.js#L244), [app.js#L129](../../client/www/js/app.js#L129) |
| Normalization | Keeps the text before the first `,`. If that text contains `ko`, `en`, `ja` or `de` anywhere (substring test), the first two characters are kept; otherwise the text is stored as is. A missing or empty header becomes `en`. The older `/v000705` push POST has the same block | [route.push.update.list.js#L79-L100](../../server/routes/v000902/route.push.update.list.js#L79-L100), [routePushNotification.js#L30-L50](../../server/routes/v000705/routePushNotification.js#L30-L50) |
| Storage | `pushInfo.lang = language` for every item in the batch | [route.push.update.list.js#L12-L22](../../server/routes/v000902/route.push.update.list.js#L12-L22), [model comment](../../server/models/modelPush.js#L20) |
| Worker default | Records without `lang` are sent as `ko`, not `en` | [controllerPush.js#L1037-L1038](../../server/controllers/controllerPush.js#L1037-L1038), [alert.push.controller.js#L57-L58](../../server/controllers/alert.push.controller.js#L57-L58) |
| Weather fetch | `Accept-Language: pushInfo.lang` to `SERVICE_SERVER` | [controllerPush.js#L702-L708](../../server/controllers/controllerPush.js#L702-L708), [#L911-L917](../../server/controllers/controllerPush.js#L911-L917), [alert.push.controller.js#L31-L36](../../server/controllers/alert.push.controller.js#L31-L36) |
| Text | For each message: `i18n.configure({locales, directory, register: trans})`, then `trans.setLocale(pushInfo.lang)`. The alert worker also branches on `lang.indexOf('ko')` | [controllerPush.js#L618-L630](../../server/controllers/controllerPush.js#L618-L630), [alert.push.controller.js#L531-L546](../../server/controllers/alert.push.controller.js#L531-L546), [#L626](../../server/controllers/alert.push.controller.js#L626) |

Synthetic execution of the normalization block (§7):

| Header | Stored `lang` | Header | Stored `lang` |
| --- | --- | --- | --- |
| absent, `""` | `en` | `zh-TW`, `zh-CN` | unchanged |
| `ko-KR`, `ko-kr,ko;q=0.8` | `ko` | `zh-HK`, `zh-Hant-TW`, `zh` | unchanged (not configured server locales) |
| `en-US,en;q=0.9`, `en-GB` | `en` | `fr-FR` | `fr-FR` |
| `ja-JP` / `de-DE` | `ja` / `de` | | |

For stored values that are not configured locales, the source comment expects English text. That outcome is unverified.

Push workers run only in `SERVER_MODE=push`, inside the same process that also mounts the Express app ([app.js#L131-L139](../../server/app.js#L131-L139)). Upstream 45b2eb3f removed the `apnFeedback` call from this block and the direct APNs path; iOS records without `fcmToken` are rejected at submission, after the text is built, so language handling is unchanged ([provider submission](../architecture/push-notifications.md#provider-submission-and-app-handling)). Each message calls `i18n.configure` again on the shared module without `cookie`. **Unverified risk:** whether this resets the app-level cookie option or the global registration for requests served by that process. The library is not installed. Message formats are in [server push and purchase](server-push-and-purchase.md#1-inputs-shared-by-both-push-workers).

## 4. Client UI language

`determinePreferredLanguage()` uses the first non-empty `navigator.languages` entry, else `navigator.language` (then older browser properties). It replaces `-` with `_` and negotiates against the registered keys and aliases. An unmatched tag is kept as the preferred language ([vendored angular-translate 2.16.0 #L456-L498](../../tw.ios/www/lib/angular-translate/angular-translate.js#L456-L498), [negotiateLocale #L547-L597](../../tw.ios/www/lib/angular-translate/angular-translate.js#L547-L597), [#L1259-L1270](../../tw.ios/www/lib/angular-translate/angular-translate.js#L1259-L1270)). The library is vendored only in the bundled iOS trees. `client/bower.json` declares `^2.13.0` and `client/www/lib` is not checked in, so the version in a build can differ.

Synthetic execution of the vendored `negotiateLocale` with the app's key and alias table (§7):

| Browser tag | Result | Browser tag | Result |
| --- | --- | --- | --- |
| `ko-KR`, `ko`, `ko-Kore-KR` | `ko` | `zh-CN`, `zh-SG`, `zh-Hans-CN` | `zh-CN` |
| `en-US`, `en` | `en` | `zh-TW`, `zh-HK` | `zh-TW` |
| `ja-JP` | `ja` | `zh-MO`, `zh-Hant-TW`, `zh-Hant-HK` | `zh-CN` (Simplified, through the `zh_*` alias) |
| `de-DE`, `de-AT` | `de` | `zh`, `fr-FR`, `es` | No match; the preferred language stays `zh`, `fr_FR` or `es` |

For an unmatched key, the static loader would request `locales/<key>.json`, which does not exist. Strings would then come from `fallbackLanguage('en')`. This is a library expectation; neither the load failure nor what is displayed was executed. The captured `ko-KR` and `en-US` screens ([screen specifications — locale and region](screen-specifications.md#locale-and-region)) exercise only those two tags. `Util.language` is a separate raw value, used for push, the share URL, the About menu and update text ([device-derived values](client-data-contracts.md#device-derived-values)). No in-app language override exists: no source file calls `$translate.use`.

## 5. Key-set parity (file comparison only)

| Check | Result |
| --- | --- |
| Server locales against each other | `en`, `ko`, `ja` and `de` have identical key sets. `zh-CN` and `zh-TW` name one key `LOC_PLEASE_RESTORE_AFTER_1-2_MINUTES` where the other locales use `LOC_PLEASE_RESTORE_AFTER_1_2_MINUTES` (1 missing and 1 extra per file) |
| Client locales against each other | Same single mismatch in `zh-CN` and `zh-TW` ([zh-CN.json#L148](../../client/www/locales/zh-CN.json#L148)). The client uses the underscore key ([controller.purchase.alexdisler.js#L293-L297](../../client/www/js/controller.purchase.alexdisler.js#L293-L297)), so Chinese users would get the `en` fallback for that restore message. That is a library expectation, not executed |
| Server against client | The server key set (322) is a subset of the client set (327). Five keys are client-only: `LOC_SPECIAL_WEATHER_NOTE`, `LOC_NEEDS_ACCESS_TO`, `LOC_STORAGE_SPACE`, `LOC_LOCATION_ACCESS`, `LOC_CALL_INFORMATION`. All 322 shared keys have identical parsed values in all six locales |
| Duplicate key lines | Server files repeat `LOC_SUNRISE`, `LOC_SUNSET` and `LOC_WEATHER`. Client files repeat those three plus `LOC_TYPE_SPECIAL_WEATHER`. A `JSON.parse` loader keeps the last value. Values differ for `LOC_WEATHER` in `ko`, `ja`, `zh-CN` and `zh-TW`, and for `LOC_SUNRISE`/`LOC_SUNSET` in `ja` (for example client `LOC_WEATHER` at [ja.json#L194](../../client/www/locales/ja.json#L194) against [#L283](../../client/www/locales/ja.json#L283)) |
| Values identical to `en` (may be untranslated, or intentionally the same such as units) | Server/client: `ko` 0/0, `ja` 21/26, `zh-CN` 20/25, `zh-TW` 20/25, `de` 44/49 |
| Literal key references | Distinct `LOC_*` tokens in non-test server JS: 131, all present in server `en.json`. In client `www/js`, `www/templates` and `index.html`: 192, all present in client `en.json`. Locale keys with no literal reference: 191 server and 135 client. These were not classified as dead, because keys can also arrive dynamically |
| iOS widgets | TW: all seven `.lproj` have identical key sets for all three files. TA: `zh-Hant` `Localizable.strings` has `LOC_TODAYWEATHER` instead of `LOC_TODAYAIR` ([zh-Hant#L24](../../ta.ios/widget/zh-Hant.lproj/Localizable.strings#L24) against [en#L25](../../ta.ios/widget/en.lproj/Localizable.strings#L25)). The TA button title uses `LOC_TODAYAIR` ([LocalizationDefine.h#L30](../../ta.ios/widget/LocalizationDefine.h#L30), [TodayViewController.m#L362](../../ta.ios/widget/TodayViewController.m#L362)). Platform expectation, not executed: the raw key is displayed in Traditional Chinese. Eight of the ten widget keys also exist in the client locale; `LOC_UPDATE` and `LOC_PLEASE_EXECUTE_MAIN_APP` do not |

## 6. Rewrite rules (proposal)

- Define one supported-locale list and one tag format (BCP 47). Map `zh-Hant-*`, `zh-HK` and `zh-MO` deliberately rather than through `zh_*` → `zh-CN`.
- Make clients send the language explicitly on weather, geocode, national, warning and push-registration requests. Do not rely on WebView or `NSURLSession` defaults. Decide whether the gateway still truncates to the primary subtag.
- Use one default for a missing language on every surface. Today the route default is `en` and the worker default is `ko`.
- Keep the server and client string catalogs separate, but enforce key parity per surface in CI. Remove duplicate keys and fix the `zh` key name and the TA `zh-Hant` widget key before migration.

## 7. Reproduce the counts

Run from the repository root:

- Key counts, per-surface parity and server/client comparison: `node -e` loading `server/locales/*.json` and `client/www/locales/*.json` with `JSON.parse` and diffing `Object.keys` (the bundled `tw.ios/www/locales` and `ta.ios/www/locales` compared the same way).
- Duplicate lines: `grep -oE '^\s*"[^"]+"\s*:' <file> | sort | uniq -d`; value differences by a regex scan that keeps the first and later values.
- Literal references: `grep -rhoE "LOC_[A-Z0-9_?-]+"` over `server` (`--include=*.js`, excluding `node_modules`, `test`, `locales`) and over `client/www/js client/www/templates client/www/index.html`, then `sort -u` and set difference against `en.json`. The `?` in the class is needed for the key `LOC_TODAY_THAN_YESTERDAY?`.
- Widget keys: regex `^\s*"?([^"=\n]+?)"?\s*=\s*"` over each `.strings` file after stripping comments.
- Push normalization: `vm.runInNewContext` over [route.push.update.list.js#L79-L100](../../server/routes/v000902/route.push.update.list.js#L79-L100) wrapped as `function(req, log){…; return language;}`.
- Client negotiation: `vm.runInContext` over the `indexOf`, `lowercase` and `negotiateLocale` source text from the vendored `angular-translate.js`, with the key and alias table from [app.js#L427-L435](../../client/www/js/app.js#L427-L435). Input tags were first converted by the `default` resolver (`-` → `_`, [#L433-L435](../../tw.ios/www/lib/angular-translate/angular-translate.js#L433-L435)).

## Limitations

- The `i18n` module is not installed (0.8.3 per the lock file), so every server precedence, matching and unsupported-locale outcome in §2–§3 is a library expectation. The same applies to the per-message `i18n.configure` side effect. None was executed against Express.
- The client negotiation used the vendored iOS copy of angular-translate. The build-time Bower version and real WebView `navigator.languages` values per OS locale were not captured. The fallback display for unmatched keys was not rendered.
- The widget and app `.lproj` selection, the effect of `CFBundleDevelopmentRegion = $(EXECUTABLE_NAME)`, and the default `Accept-Language` sent by `NSURLSession` or a WebView were not observed on a device or simulator.
- Android widget localization is unknown because its source is absent.
- The parity results compare files. They do not establish which strings a user sees or whether an unreferenced key is dead.
