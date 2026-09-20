# Service architecture intent
Owner: /root. Authority: AK's current request. Endpoint: local working files.
Explain the checked-out TodayWeather/TodayAir service with special emphasis on weather ingestion and mobile requests. Make the findings reusable by readers and coding agents.
AC1: Evidence-linked overall components, runtime modes, persistence and external boundaries.
AC2: Detailed schedules, fetch/normalize/persist operations, retry and failure behavior, and historical vs active collection paths.
AC3: Mobile entrypoints, URL/query construction, cache/retry behavior, API assembly, and missing gateway wiring stated explicitly.
AC4: Three Archify diagrams with JSON, delivery/browser/visual evidence; canonical AGENTS.md plus a thin Claude adapter, verified for representative tasks.
Exclude product changes, external API calls, credentials, deployments, skill installations, commits and remote publication. Current source is evidence of implementation, not live infrastructure or provider availability.
