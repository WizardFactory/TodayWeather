# Intent: temporary overseas weather unavailability

Source: https://github.com/WizardFactory/TodayWeather/issues/2635. AK explicitly requests review and implementation through pre-merge (2026-09-29). Repository: WizardFactory/TodayWeather; task branch eager-panther. Use existing authenticated GitHub account and configured Claude/Anthropic reviewer for task-only code/test/evidence. No secrets, account enrollment, permissions changes, merge, auto-merge, queue or production actions.

Return a meaningful temporary failure when VC is marked down or its daily record budget prevents a fetch and no usable stored current weather exists. Preserve fallback, success contracts, old API versions and generic failure behavior.

AC1: active marker yields 503 and positive integral Retry-After bounded by its expiry (whole-second resolution).
AC2: exhausted budget yields 503 and Retry-After bounded by next UTC midnight and 3600 seconds.
AC3: other errors remain 501; (0,0) remains 404; invalid input remains 400.
AC4: 503 carries CORS and no-store.
AC5: mobile API documentation and source/generated request diagram reflect the contract.

Boundary: subsecond remaining windows require a minimum one-second HTTP delay; document this unavoidable rounding exception. No quota accounting redesign, provider recovery policy or client rewrite. Native compatibility is source-based; production calls and mobile builds excluded.
