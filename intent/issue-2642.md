# Retire server payment validation (#2642)
Owner: AK. Builder: Codex/OpenAI. Endpoint: pre-merge; merge_authorized: false.
Source: AK's 2026-10-03 request and GitHub issue #2642.
No paid users remain; client removal (#2641) is already in the base.
Remove all five receipt mounts, implementation, SDK/lock entries, obsolete tests and six exclusive platform settings. Preserve route and authorization order.
AC1: startup cannot load/initialize receipt validation or contact receipt providers.
AC2: five former endpoints follow existing unmatched-route behavior in isolated HTTP checks.
AC3: payment dependency/secrets absent; adjacent weather/geocode/push preserved.
Authorized: local implementation, tests/smoke, commit/push, issue/PR evidence, configured independent reviewer, CI through pre-merge. Excluded: merge/auto-merge/queue, deployment, store-console changes, new accounts, secrets transfer or permission changes.
Risk: v000803 POST authorization precedes route matching; do not bypass it to force 404.
