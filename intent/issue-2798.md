# Nationwide forecast narrative (#2798)

Owner: AK; builder: Codex /root (OpenAI). Authority: AK requested existing plan through pre-merge on 2026-10-17; multilingual support and client presentation move to a follow-up issue. No merge, auto-merge, queue, deployment/restart, production writes, new accounts or permission changes.

Problem: current warning types 1–4 do not cover the nationwide short-term forecast narrative. Official getWthrSituation access was recorded in the issue on October 17; this task does not repeat production probing.

AC1: bounded scheduled acquisition of valid nationwide publications, idempotent storage, auth/quota rotation, credential-safe failures; existing warning/zone/push behavior retained.
AC2: existing special endpoint adds a distinct Korean 종합예보 entry with correct UTC announcement, complete escaped multiline body and publication-based expiry; absent/failed optional data preserves warnings.
AC3: credential-free regressions and separate real HTTP/persistence smoke, operations/rollback documentation and reviewed PR. Live rollout/readback remains operator-owned and the issue stays open.

Scope: server/ legacy implementation, tests, API operations docs and architecture. No client code or translations; client rendering/product decisions and multilingual support are a requested follow-up. Keep the existing name/announcement/comment fields usable without an app update.

Risk: legacy announcement storage uses KST wall clock encoded as UTC. Provider content is untrusted HTML input. Only the sampled existing key has proven provider access; future quota is unknown.
