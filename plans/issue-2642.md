# Implementation plan
Read [intent](../intent/issue-2642.md) and [spec](../specs/issue-2642.md). Owner: /root. Execution notebook: .planning/2026-10-03-2642-server-payment-retirement.
1. Add regression for dependency/config/validator absence and exact preserved router mounts; record intended Red.
2. Remove five mounts, validator, obsolete e2e test, SDK/lock and six platform settings.
3. Add isolated HTTP smoke using real app, Express and version routers, explicit offline dependencies, loopback-only network. Compare retired paths to unmatched controls; preserve v000803 auth and exercise adjacent routes.
4. Run Green/post-refactor, additional functional smoke, weather/geocode/push checks. Update architecture prose/Archify JSON/HTML and verify links/browser/visual evidence.
5. Check staged/outgoing artifacts, commit, push, PR, independent provider review/correction and current CI. Stop unmerged at merge-ready.
Scenarios: S1 operator starts service without payment settings (AC1/3); S2 legacy caller sends GET/POST to five retired paths and observes existing fallback/auth (AC2); S3 weather/geocode/push caller follows remaining mounts/middleware and gets the prior contract (AC3).
Highest risk: v000803 POST authorization. Rejected alternative: dedicated 410 route would change the established unmatched contract. Blast radius: receipt endpoints only. Rollback: revert scoped commit and restore dependencies; production is human-owned.
