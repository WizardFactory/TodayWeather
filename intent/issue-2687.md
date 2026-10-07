# S02: freeze the used-API parity oracle

Source: [#2687](https://github.com/WizardFactory/TodayWeather/issues/2687), parent [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614).

Existing clients require exact used API behavior while server2 changes storage and implementation. Traffic inventory establishes 19 observed method/path groups; it cannot establish response bytes. Record actual legacy handler output against fixed provider/store/dependency inputs, then use those raw responses as the independent oracle for later ports.

Affected users: mobile clients, widgets and web callers, and developers implementing server2. The accepted traffic window is 2026-08-23..2026-09-22 UTC, 220,583 requests. The oracle source revision is f568508da68d408a282752f55614407899631c88; deployed revision differences remain a cutover reconciliation gate, rather than a fabricated runtime result.

## Acceptance

- AC1: Every accepted group has actual handler wire capture, and the domestic v000901/v000902/v000903, town, world, nation and special backends needed by used paths execute their real assembly logic. Gateway dependency fixtures alone do not count as backend coverage.
- AC2: Two consecutive offline recordings are byte identical. Deterministic fixtures cover units/locales, aliases, input/auth errors, OPTIONS, ETag/304, non-JSON errors, warnings, POP including old rows without POP, yesterday/midnight and missing history. Failure-only groups use frozen handler/dependency failures. No live Mongo/provider/geocoder/push is contacted.
- AC3: Declared placement, current foundation checks, owned golden CI and operator instructions pass; editable manual and actual CLI capture/PDF are visually checked.

Authority: AK requested implementation and parallel execution. [Path declaration](https://github.com/WizardFactory/TodayWeather/issues/2687#issuecomment-6016577542) binds exact outside files. This task ends at an independently reviewed unmerged PR. No merge, production action, cutover or downstream implementation is authorized. Current legacy push baseline includes #2684; D02 no-resend and D03 new-registration-only are explicit future server2 differences, not silent golden rewrites.

Risks: accidentally recording stubs instead of real handlers; freezing unstable fields incorrectly; triggering startup side effects; mistaking source parity for deployed parity. Mitigate with handler provenance, frozen dependency traces, fail-closed IO, byte comparison and explicit cutover limits.
