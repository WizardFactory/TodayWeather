# Webapp product specification

Originally proposed 2026-09-24; updated for the static-only implementation. This is a parity ledger, not a claim that every target is implemented. Authority and acceptance: [intent](intent.md). Architecture: [technical design](technical-design.md). Delivery: [implementation plan](implementation-plan.md).

## Product promise and audience

Users should be able to open a link on mobile or desktop and understand today's weather relative to yesterday, upcoming hourly/daily changes and air quality. Returning users can manage local preferences and cities. Installation and location permission are optional for browsing. Browser notifications are unavailable in the current static client; scheduled/condition-based alerts remain a future parity goal.

Primary journeys: checking before leaving home, comparing saved cities, inspecting a pollutant/station, reviewing national conditions/warnings, and, in future separately scoped work, receiving scheduled/condition-based city notifications. Preserve weather meaning and actions while adapting density and interaction to the browser.

Default product proposal: one TodayWeather web product with weather-first and air-first startup options. TodayAir's combined weather screen remains available. Existing translations and international weather are included where supported by data; national maps/warnings are explicitly Korean. Source definitions are in the [screen inventory](../rewrite/screen-specifications.md), not inferred from screenshots alone.

## Feature parity ledger

`Required` means required for a supported-browser parity release. `Adapted` preserves the outcome with web interaction. `Decision` is unresolved and must be accepted or implemented before claiming that area is equivalent. Internal delivery stages do not remove requirements. The current static release explicitly excludes implemented web alerts; it must not claim complete parity. See [implemented surface](implementation.md).

| Existing screen | Web target and behavior | Classification / release proof |
| --- | --- | --- |
| S01 Initial location | `/start`: search, recommended cities, user-triggered current location; no permission prompt on page load | Required: selected city loads; denied/timeout still permits search |
| S02 Favorites/search | `/locations`: add, select, delete, disable current location; current weather/air previews and notification entry | Required: stable city IDs survive reload/deletion and in-flight requests |
| S03 Hourly | `/weather/:locationId/hourly`: current hero, yesterday comparison, aligned temperature/rain/air series and expanded detail | Required: all supplied details, zero/missing values, midnight and scroll/touch/keyboard |
| S04 Daily | `/weather/:locationId/daily`: min/max, AM/PM conditions, precipitation, optional life/air detail | Required: day alignment, units and optional fields |
| S05 Air detail | `/air/:locationId?pollutant=...`: AQI/pollutants, grade/action text, station selection, hourly/daily outlook | Required: every supported pollutant/standard, missing station and source freshness |
| S06 Menu/settings | Persistent desktop navigation; mobile More drawer; feedback/about/version/external wind link | Adapted: existing eligible destinations and keyboard/back behavior |
| S07 Units | `/settings/units`: all six dimensions and the existing supported value sets | Required: request/display/cache units agree; any future alerts must use the same semantics |
| S08 Radio preferences | `/settings/:section`: units, startup page, 0/30/60/180/360/720-minute refresh choices, supported themes | Adapted: immediate preference save; refresh occurs while active/on return, not guaranteed in background |
| S09 Notifications | Current `/notifications/:locationId`: unavailable explanation, mobile-app guidance and a return-to-weather link, with no subscription or scheduling form | Future parity gap: requires separate service design and actual supported-device delivery, ownership, unsubscribe, timezones and duplicate handling |
| S10 Nationwide weather | `/nation/weather`: fixed KR map with temperature/weather, precipitation and wind modes; accessible list alongside | Required: all existing modes, missing city and unit handling |
| S11 Nationwide air | `/nation/air`: KR map/list, PM2.5/PM10/O3/NO2/SO2/CO selector | Required: field/grade mapping, real zero, partial regions |
| S12 Warnings | `/warnings`: announcement time, bulletin sections, image/text and explicit empty/error states | Required: safe text rendering, missing image and stale/offline distinction |
| S13 Purchase/ad removal | `/membership`: clear availability and benefit policy; hosted checkout/account entitlements if paid model chosen | Decision: no claim that local mobile receipts unlock web automatically |
| S14 Legacy guide | `/help`: browser location, notifications, installation, units and data freshness instructions | Adapted: replace obsolete native directions; the old guide is hidden in the legacy menu |
| S15 TodayAir weather | `/weather/:locationId/overview`: combined hourly/daily conditions, reachable from air mode | Required: retain combined information, no forced switch to a different product |
| S16 TodayAir primary air | Air-first home/startup option using S05 with TodayAir information priority | Required: restored startup preference and accessible weather switch |

All rows derive from [S01–S16 definitions](../rewrite/screen-specifications.md); routes above describe the parity targets. Current implementation consolidates settings at `/settings`; use [implementation status](implementation.md) for actual route/feature coverage.

| Cross-cutting/mobile integration | Web treatment | Parity boundary |
| --- | --- | --- |
| Share | Public region URL, native share sheet when available, copy-link fallback | Never expose private favorite IDs, full current coordinates or alarm data in a public link; confirm approximate region preview |
| Location permission/native settings | HTTPS browser geolocation after a click; retry and browser-settings help | No automatic OS settings launch or continuous background tracking |
| Native preferences/app group | Versioned origin-local favorites/settings; export/import of web favorites | Browser cannot read native app storage; mobile transfer needs an explicitly added mobile export or account-sync project |
| Home-screen install | Manifest/icons/service worker; contextual installation help | Install shortcut is not an OS weather widget |
| iOS/Android widgets and Watch | Keep existing native apps; explain native availability and offer the web dashboard | Native-only: not claimed as equivalent PWA widgets/Watch app |
| Daily/condition push | Current static client offers native-app guidance only | Future design must establish scheduling, ownership and device delivery; PWA installation alone does not enable alerts |
| Ads/IAP/restore | Independent web policy and optional hosted billing; explicit signed entitlement service | Native store purchases and AdMob are not directly reusable web integrations |
| Photo/light/dark/old themes | Maintain information/accessibility and recognizable palettes; curated licensed photo assets if enabled | Photo provider and asset rights are a launch dependency; do not silently substitute a broken background |
| Locale, feedback, reviews | Reuse translation catalog after audit; browser locale override, feedback link, optional store links | No native review prompt; server summary language must match selected locale |
| External maps/links | Open a clearly labeled external destination with safe navigation | External service availability is distinct from core weather availability |

The recommended beta is ad-free, without account sign-in. This is a proposal for AK, not approval to omit S13 from a paid parity launch. At release, the ledger must contain no unexplained omission: each Decision needs a resolved policy, owner and user-visible behavior.

## Information architecture and responsive layout

Mobile, approximately 360–767 CSS px: city header plus search/refresh, current condition and yesterday delta, then active chart/detail; bottom navigation is Hourly / Daily / Air / Locations / More. Air-first mode changes the initial view, retaining access to the combined weather overview. Share and notifications are city-scoped actions.

Tablet, approximately 768–1023 px: compact sidebar or rail and one main chart column. Desktop, 1024 px and wider: saved cities/navigation on the left, hero plus hourly/daily content in the main column, air/warnings/detail panel to the right. The air screen gives the pollutant chart the main column. Maps always have a text/list alternative. Breakpoints are design starting points, to validate at 360/390/768/1024/1440 px and 200% zoom.

Do not stretch a phone screenshot to desktop. Keep horizontal scrolling inside forecast strips, not the whole page. Show source/publication time close to data; never encode AQI state solely by color. Charts need labels, focusable interactions and a table alternative. Respect reduced motion, keyboard navigation, focus after dialog dismissal, safe areas and sufficient touch targets. Target WCAG 2.2 AA through implementation review/testing, not a compliance claim from this document.

## Primary flows

1. **First visit:** landing/last valid deep link → choose recommended city, search or current location → confirm region → fetch data → weather or air-first page. Location denied/timeout leaves the search form usable. A failed weather lookup offers retry and does not erase previously saved places.
2. **Daily use:** restore selected city/preferences → render last stored snapshot with its actual timestamp → refresh according to freshness → update each data section with its own provenance. A city switch or unit change invalidates ownership of a pending result; it cannot overwrite another city's screen.
3. **Search:** debounced input → predictions with region/country context → resolve coordinates → load weather → add favorite. Current bundled KR towns can support a limited fallback; global autocomplete needs the chosen provider. Clear no-results, provider-error and quota-limited messages remain distinct.
4. **Notifications:** choose city → explain that browser alerts are unavailable → recommend using the existing mobile app and offer a return-to-weather link. Do not request permission, collect a subscription or display a scheduling form. Future alert journeys require separate design and acceptance.
5. **Share:** preview a public region label → share/copy canonical region link → recipient resolves the region without the sender's favorites. Precise current location is not the default share payload.
6. **Offline:** load a previously visited shell and snapshot → persistent offline notice and observed/fetched time → cached forecast remains inspectable; no fresh-data claim. First-ever offline visit explains unavailable data. Notification scheduling remains unavailable online and offline.
7. **Update:** new app version detected → offer a user-initiated reload → activate compatible app/cache schema. Do not interrupt ongoing interaction on the first worker claim or imply that refreshing the app refreshed provider observations.

## State and data presentation rules

| State | User-visible behavior |
| --- | --- |
| Uninitialized/empty | Search/recommended cities, not an unexplained blank chart |
| Locating/loading | In-progress feedback and manual selection; retain useful prior data |
| Loaded | Values and matching units, observation/publication timestamps and attribution |
| Partially available | Render valid weather even when air is missing; unavailable section labeled explicitly |
| Stale | Show last available value with its own age and refresh action; missing new air cannot appear freshly updated |
| Offline | Cached snapshot clearly identified; warnings explicitly cannot confirm current safety |
| Permission denied | Functional manual search and contextual permission help; no repeated prompts |
| Rate limited/server error | Bounded retry, retry-after where supplied, clear retry action; no request storm |
| Storage unavailable | Session-only experience with notice; corruption/quota errors do not prevent weather access |

True zero, unavailable/sentinel, empty collection and unsupported product are different states. Yesterday and local midnight use the selected location's time context. Preserve precipitation durations and AQI grade standard; show the source's units and avoid converting a value twice.

## Product acceptance for implementation

- Every required/adapted ledger row has browser evidence against fixtures and, where relevant, staging integrations. Commercial and native-only exceptions have explicit product disposition.
- Supported-browser baseline: release-time current and previous major Safari/iOS Safari, Chrome/Android Chrome, Edge and Firefox for weather browsing; install behavior is separately tested; future push support requires its own device matrix. Pin exact versions in release evidence, not this timeless requirement.
- All weather/air/map/unit/date/race/error cases in the [existing verification matrix](../rewrite/verification-matrix.md) are mapped to new tests. Existing snapshots are characterization inputs, not proof that old bugs should be preserved.
- Performance targets, proposed: cached city content visible within 1 second; p75 initial LCP ≤2.5 seconds on an agreed mobile profile; API success ≥99% excluding rejected user input, with product freshness tracked separately. Establish load/traffic and sample definitions in the spike before treating these as release SLAs.
- Fresh-data success, failed searches, source age, API latency/errors, location permission outcomes are measured separately, without precise coordinates or subscription keys in analytics.

## Scope decisions

AK has confirmed the parity priority, static-only operation and `app.tdywx.xyz` domain. React/Vite and direct API reads are implemented. Deployment method, monetization and schedule remain decisions. Recommended defaults and tradeoffs are in the [technical design](technical-design.md). Paid entitlement, login/sync and separate TodayAir branding remain decisions, not hidden requirements. The [implementation plan](implementation-plan.md) sequences them without blocking independent browser/domain work.
