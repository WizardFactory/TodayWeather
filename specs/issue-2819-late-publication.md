# #2819 B3 — latest short forecast acquisition bounds

## Goal and boundaries

The latest `vilage-fcst` publication currently retries every five minutes while missing. Bound this request-triggered acquisition without starting a timer or pre-collection. Preserve per-cell identity, original owned flight, caller cancellation, provider deadlines, B2 attempt funding and stored-response semantics. Keep current/ultra-short/RSS/mid and historical backfill behavior unchanged.

## Acceptance

- **AC1:** a continuously requested cell with an always-NotPublished provider attempts its latest short publication at provision+2, +5 and +10 minutes, then no more latest attempts until the next base. No pre-provision call. The provision time for the existing 02/05/…/23 base is HH10; windows are HH12/15/20.
- **AC2:** demand is required. Sparse or first cold demand uses at most the latest elapsed window, without replaying missed windows or creating a background schedule. A late first request still gets one bounded collection attempt. Usable stored data prevents new collection; overlapping requests share the existing flight and caller cancellation does not cancel its owner. Request wait and response contracts stay unchanged.
- **AC3:** historical backfill remains independently bounded/recoverable after a newer base, and non-short families keep their existing cadence. Distinguish a logical publication acquisition from page and HTTP retry attempts; do not change B2's max-two HTTP rule or authority units. The new cap has the existing process-local scope; it is not a cross-process durable quota guarantee.
- **AC4:** prove the old defect with a focused failing check, run affected regressions and a separate owned-dependency functional scenario, declare exact paths, update source/HTML contract and operator evidence, obtain independent review and current CI. No live providers, deployed state, push sends, shadow, production or merge approval.

## Design constraints still to verify

Use a separate bounded latest-short admission state in the existing source owner; do not cap generic `Attempts` globally. Select the elapsed slot once per publication under the owned-flight lock. Verify next-base/backfill interaction, memory bound, failure and clock behavior before code. Unchanged whole-domestic positive KMA timing failure remains #2819 D2/capacity; do not weaken it to make this slice pass.
