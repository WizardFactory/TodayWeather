# Intent: server2 memory and S3 design amendment

Status: design PR; runtime implementation and cutover are not authorized here.
Source: [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614)
and AK's task instructions on 2026-10-05/06.

## Problem / goal

Replace the proposed local SQLite serving store with memory and S3. Document a
Rust origin that preserves used APIs, reduces cold S3 lookup fan-out, and can
start on one Spot instance before scaling up and later out.

## Binding task directions

- No local persistent weather/state store: memory → S3 → provider.
- Preserve raw provider bytes and revisions; no persisted normalized weather view.
- Examine S3 storage and lookup structures as well as memory structures.
- Start with one Spot host. Compare threads/processes and host-local cache sharing.
- Multi-instance operation needs a future plan only; no shared-cache deployment.
- Used existing APIs must be fully compatible. Exclude APIs unused in a 30-day
  window; the existing traffic investigation is an accepted baseline and need
  not be refreshed for this PR.
- Review the design, maintain documents/diagrams and create a PR. No merge,
  runtime implementation, AWS configuration change or deployment.

## Acceptance criteria

- **AC1:** The specification defines raw storage, direct lookup, atomic publication,
  pack fallback, concurrency, failure behavior, privacy exceptions and future
  scale-out, with confirmed directions distinguished from proposed decisions.
- **AC2:** The compatibility inventory matches the accepted traffic evidence,
  including old versions and failed requests; exclusions and scope gaps are
  explicit. Historical acquisition gaps cannot be silently accepted.
- **AC3:** Maintained documents and diagrams have working links, reproducible
  latency arithmetic and actual artifact/browser/visual checks; the PR has an
  independent review and records limitations without claiming implementation.

## Risks and open decisions

History capture, S3-outage failure policy, mutable identity indexes, raw-pack
duplication/lifecycle and state migration still require issue decision records
before implementation. Exact active-API parity takes precedence over optional
performance improvements. See the [spec](../specs/issue-2614.md) and
[delivery plan](../plans/issue-2614.md).
