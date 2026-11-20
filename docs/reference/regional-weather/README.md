# Regional weather source qualification

These sources cover [#3075](https://github.com/WizardFactory/TodayWeather/issues/3075) and [#3076](https://github.com/WizardFactory/TodayWeather/issues/3076). Use the [focus market roster](../../operations/mobile-focus-cities.md) and [seasonal atlas](../../evidence/research/mobile-markets-2026-11-20/README.md) for applicable cities and seasons. Retrieval date was 2026-11-20 unless specified.

## Delivery through server1

WebApp (desktop and PWA) and native iOS and Android use the selected forecast location. Preserve the source, native units or scale, and publication/valid times. Measurements use their observation time and station identifier. Model forecasts use the supplier's grid and reference run. Official declarations include their issuer, area, effective period and status. An archive needs a verified refresh path for live delivery.

- [Environmental health and fire risk](environmental-health.md)
- [Sunshine, terrain, rainfall and estuary levels](regional-forecasts.md)

[Selected request and parse results](sample-checks.json) record counts and units. Provider values and credentials are excluded.
