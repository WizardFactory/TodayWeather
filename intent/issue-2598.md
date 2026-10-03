# Issue 2598 intent
Source: [GitHub #2598](https://github.com/WizardFactory/TodayWeather/issues/2598). AK authorized implementation through pre-merge on 2026-10-03, including scoped commits/push/PR, configured independent review, CI and corrections. Merge, auto-merge, queue and production actions remain excluded.

KMA PWA users must see forecast rain/snow periods and approximation supplied by D45, while older responses retain their current labels. Scope: weather-core normalization, web presentation and offline snapshot validation, regression tests, affected documentation/manual. No backend contract or native application change.

Acceptance IDs follow issue order: AC1 six-hour exact rain label; AC2 three-hour approximate rain label; AC3 zero-hour placeholder shows probability; AC4 daily 24-hour metadata and absent-field legacy fallback; AC5 exact shortest rain and absent-flag legacy approximation; AC6 six-hour snow label; AC7 representative-amount comments with undeployed lower-bound compatibility; AC8 typecheck and full unit suite pass.

Risk: conflating observation and forecast metadata, category range and aggregated approximate amount, or rejecting new periods in offline storage. Provider/deployment state is not inferred from local fixtures. No unresolved product decision. Rollback: revert the scoped commit.
