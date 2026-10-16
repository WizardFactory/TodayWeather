# Restore province averages after AirKorea validation failures (#2758)

Status: approved scope through AK's 2026-10-16 instruction; implementation endpoint pre-merge.
Source: https://github.com/WizardFactory/TodayWeather/issues/2758

The Korea nation air map lacks eight province-average rows. Repair the legacy collector using actual rejected response evidence while preserving strict identity/time and page-completeness guarantees. Do not substitute nation fallback or city-statistics success for average persistence.

AK authorized actual calls/log analysis, publishing findings on the issue, and implementation/tests/commit/push/PR/CI/independent review/correction through pre-merge. Use existing configured accounts and independent review contexts for scoped code/test/evidence only. No secrets, new accounts, permission changes, merge/auto-merge/queue, deployment/restart or production collection activation.

- AC1: Sanitized real six-province observation and Gwangju/Jeonnam paging fixtures pass after repair; valid controls, defined unavailable stations and strict malformed/incomplete failure cases are covered.
- AC2: Isolated collector-to-store-to-nation verification creates expected average rows and returns PM2.5/PM10 values, requested grades and actual observation times. City-only rows and global fallback cannot satisfy this gate.
- AC3: Publish actual diagnosis and a precise operator handoff. Scheduled/public 17-province production recovery remains a separately authorized post-rollout gate; never claim recovery from isolated verification.

Risks: silently discarding malformed rows, accepting a truncated unknown-total response, accepting invalid time as zero, failing average writes, and confusing the repository nation fallback with the deployed direct reader. Preserve existing quotas, retries/deadlines, duplicate protections, latest urban-monitoring selection, grade mapping and Mongo schemas.
