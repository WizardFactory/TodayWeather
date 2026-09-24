# Implementation plan
Revision 1. Read intent/issue-2564.md and specs/issue-2564.md. Owner /root; local endpoint.
1. Add isolated expected-behavior regressions for strict ASOS normalization, hourly/daily missing-only recovery, timestamp/field merge and operator limits. Run intended failing assertions before production edits.
2. Add pure history policy, HTTPS adapter, Mongo cache/lease adapter, bounded recovery service, configured gather job and explicit bounded CLI. New collection identity avoids retroactive index changes to legacy weather collections.
3. Integrate stored hourly fallback in the shared station middleware and daily observations at final daily composition. Add historical gap/provenance metadata while retaining all existing route cadence/unit/DB contracts. No provider work in a weather request.
4. Extend actual route smoke for multi-day history, daily-only/hourly-only and client parsers across both DB versions/units; test persistence/recovery with real local HTTP and Mongo. Run relevant offline suites and alternate-timezone policy checks. Fix only regressions justified by these changes.
5. Update affected architecture documents and checked Archify artifact. Complete independent verification via separate native agent context required by SDLC, correct findings and hand off local files/evidence.

Risk: station spatial approximation, ambiguous old scraper dates, partial hourly precipitation and KST midnight alignment. Mitigation: explicit configured station map, new source identity/time basis, no conversion of daily measurements into hourly values, date bounds and optional-field gaps.
Rejected shortcut: merely enable old /past or copy the reference scraper/cache; it cannot prove correct multi-day source timestamps or API delivery.
Rollback: disable ASOS_HISTORY_READ_ENABLED and ASOS_HISTORY_ENABLED; existing grid/station/forecast code remains available, new cache is additive and can be retained. Deployment/backfill requires separate authorization. No live DB migration occurs here.
User confirmed existing hourly display scope/cadence on 2026-09-24. Daily history is D-7..D-1.
