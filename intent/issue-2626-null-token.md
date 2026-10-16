# Ignore invalid push-token refresh callbacks — #2626

2026-10-16. Owner: AK; implementation: Codex /root. Status: approved within AK's explicit pre-merge request. Base: `915978bb39f0dfa829b7af2aef14df4499c28997`.

Calling Firebasex token deletion/reissue on the iOS simulator emits A→null→B. The Push callback currently sends A→null, replaces A with null, then sends null→B. Both PUTs receive403; the existing POST fallback later restores delivery. Retain A while callbacks have no usable token, then let the valid B use the existing replacement path.

- **AC1:** Null, undefined, empty/whitespace-only or non-string callback tokens cause no new HTTP request, remembered-token change or storage write.
- **AC2:** A→invalid→B produces exactly one PUT with A/B; repeated B is inert.
- **AC3:** The first valid token still submits saved settings; error callbacks remain inert.

Scope: shared `client/www/js/service.push.js`, focused tests/CI, architecture documentation/diagram maintenance and selected simulator evidence. Exclude backend changes, initial-token PUT semantics, retry/persistence redesign, bundled platform copies, production rollout and new UI. Existing HTTP failure behavior remains a limitation.

AK explicitly requested a #2626 comment and work through **pre-merge**. This authorizes scoped edits/tests/smoke/commits/push/PR/CI, independent configured reviewers and necessary code/test/evidence transfers. Current paths are Codex builder, authenticated GitHub `hwanjjang`, and configured Paseo Claude/Grok/Google contexts. Secrets, new accounts, permission changes, merge/auto-merge/queue and deployment/restart are excluded. AK also chose simulator verification instead of physical-device acceptance; report its actual limits. Keep #2626 open.

Risks: rejecting a malformed callback must not suppress a later valid token or the first-token settings POST. A narrow callback guard avoids changing direct helper callers, backend validation and registration-generation rules. The [specification](../specs/issue-2626-null-token.md) and [plan](../plans/issue-2626-null-token.md) govern the implementation. Published finding: [issue comment](https://github.com/WizardFactory/TodayWeather/issues/2626#issuecomment-6206475707).
