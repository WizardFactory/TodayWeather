# User amendments, 2026-09-29
- Add nationwide missing-data recovery using the same global-air flow as domestic weather.
- Consider parallel processing for multiple cities: implemented bounded concurrency four for both province collection and request fallback.
- If Mongo lacks AirKorea data, request-triggered recovery proceeds directly to global-air providers without checking/calling AirKorea.
- User confirms the AirKorea operating key is expired and will be renewed later. No live entitlement claim; renewal and provider acceptance remain operator-owned before rollout.
These are user instructions extending/clarifying the initial issue, not inferred authority from issue text. Merge and production deployment remain excluded.
