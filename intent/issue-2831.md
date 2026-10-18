# Preserve hourly air forecasts with fallback observations (#2831)
Source: https://github.com/WizardFactory/TodayWeather/issues/2831 and AK request 2026-10-19: legacy server, SDLC through pre-merge.
Current OpenWeather observations must retain stored nearby AirKorea/KAQ forecasts without changing current values or attribution. App users should see future PM10, PM2.5 and derived AQI slots.
Authorized: implement, test/smoke, commit/push, PR and issue updates, CI, independent review/corrections using configured accounts. Endpoint pre-merge; merge, auto-merge, queue, production deployment/restart, secret transfer and permission changes excluded.
AC1: isolated regressions cover stale AirKorea -> fallback current + verified nearby stored forecasts, single/list paths, selection and safe missing/invalid/error behavior.
AC2: separate real local HTTP -> actual legacy chart-data assembly proves numeric future PM/AQI, KST/provenance and unchanged current fields, against captured current-only baseline.
AC3: document acquisition limitation and approved rollout/rollback; live origin/public proof explicitly deferred until separate deployment approval. Keep issue open.
Risks: untrusted station identity, stale-observation horizon, accidental current mutation, selective deployed overlays. No observation freshness/quota/KAQ-enable/provider acquisition changes.
