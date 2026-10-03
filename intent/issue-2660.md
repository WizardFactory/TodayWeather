# Issue 2660: reconcile policy evidence and operating decisions

Owner: AK. Builder: OpenAI / root. Source: [issue #2660](https://github.com/WizardFactory/TodayWeather/issues/2660).
2026-10-03 scope amendment: AK requested “pre-merge까지 진행” after the four local
review-document edits. Endpoint: verified PR readiness, no merge.

## Outcome and acceptance

The issue intake and old workspace notes do not reflect committed drafts, consent
work and later decisions. Give release reviewers one source-backed map and current
operating decisions, without implying that final policy or operational gates passed.

- AC1: all affected operating documents record 김동환 as final document approver and
  policy/store-disclosure maintenance owner, with approved Analytics 2-month,
  BigQuery 90-day, resolved support 1-year and completed deletion-audit 1-year limits.
  Server request/error logs were already approved at 90 days. Approval is distinct
  from configuration, cleanup and final-text approval.
- AC2: inventory current notification storage alternatives and source-supported
  deletion/logging gaps, separating repository behavior from deployed evidence.
- AC3: policy paragraphs and unresolved store questions map to source references and
  final-candidate scenarios; maintained local links work and the scoped PR has actual
  artifact checks, CI and eligible independent review before readiness.

## Boundaries and authority

Scope: four operating documents plus concise canonical intent/spec/plan records.
No app/server/HTML/SDK/UI changes, cleanup tooling, operating configuration, private
account payloads, signed builds, policy publication, store submissions or issue closure.
The whole release remains gated on enforcement, secure erasure, provider/transport
and final-device evidence, then final text/declaration approval.

AK's user answers on 2026-10-03 named 김동환 and accepted the proposed numeric periods.
The following pre-merge instruction authorizes scoped commit/push/PR/CI/review/fixes
and concise issue updates through existing GitHub account hwanjjang and configured
Paseo review launchers (OpenAI builder, Anthropic reviewer; configured xAI fallback
or independent OpenAI context only if alternate reviewers cannot proceed).
Only task documents, tests and evidence may be transferred; secrets, new accounts,
permission changes, production operations, merge/auto-merge/queue remain excluded.

## Risks

A confirmed period can be mistaken for implemented expiry. Setting removal can be
mistaken for S3 device erasure. Draft dates can be mistaken for policy commencement.
Preserve those distinctions and defer legal/operator and provider conclusions that
lack current evidence. This PR does not resolve those operational release gates.
