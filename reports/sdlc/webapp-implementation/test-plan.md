# Test design
AC3: KMA/world fixtures, finite lat=0, null/sentinel versus true zero, unit and day/hour=24 boundaries; preserve source timestamps.
AC4: real BFF HTTP with controlled upstream; allowlisted routes, bounded requests, redirects/HTML/errors, explicit sample provenance; live failures never become fabricated weather.
AC2/5: actual local browser plus actual BFF and built static app: favorites/search, all weather/air/map/warning/settings views, units, reload/deep links and offline/PWA capability flows.
AC5: notification ownership/revision/CSRF and deterministic schedule/rule tests; unconfigured sender never claims subscription success. Actual device delivery is separate external evidence.
AC6: typechecks/build, isolated deployment config and current architecture docs.
AC7: read-only independent verifier with fresh context and separate report. No legacy app/database/collector startup.
