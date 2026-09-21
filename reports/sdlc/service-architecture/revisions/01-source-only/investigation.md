# Investigation
Reviewed entrypoints, current/legacy routers, Manager timers and persistence selection, KMA request/merge paths, DSF and AQI cache fills, Angular request and response code, shared storage, native widget constants, Gulp and historical Travis recipes.
Primary findings are preserved in docs/architecture/service-overview.md, weather-collection.md, mobile-api.md and evidence.md, with file/function references.
Confirmed unknowns: public /weather and /geocode gateway implementation; actual release config; live topology/provider availability.
No application runtime, collectors or external APIs executed. No product source modified.
The client retries on slow response via 2-second timers, not conventional failure retry. Domestic scheduling uses UTC minutes and mixed queued/direct jobs. Latest DSF path is request-time; legacy recurring collector startup is absent.
Skills: canonical paths resolved through installed Codex skill links. sdlc, planning-with-files and archify contracts read. Archify 2.17 update checker returned silent/current. No skills installed or updated.
