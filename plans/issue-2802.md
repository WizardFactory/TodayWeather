# Structured logging implementation plan

Root owns branch/worktree/PR issue2802, base2ded7c9a; exact scope server2/config/tasks/Logging.json. [Intent](../intent/issue-2802.md), [spec](../specs/issue-2802.md), [baseline audit](../docs/operations/server2-logging-audit.md). #2724 measurement excluded. This increment precedes the separately tracked remaining S19 recovery proof.

1. Observe an intended old-binary failure for a real HTTP structured terminal record (HTTP setup must succeed).
2. Add typed bounded NDJSON emitter and nonsensitive context; test real async/blocking propagation, cancellation, filtering, queue/rate/sink failure, bounded fields.
3. Instrument HTTP/lifecycle and existing tasks/shared owners/queue handoffs. Preserve stdout readiness and HTTP bytes; add drop counters to internal metrics.
4. Instrument safe provider/funding/cache/S3/history/summary/warnings/notice/state/delivery outcomes and existing retry/reconciliation/void decisions. Never format raw errors or identifiers. Verify attempt counts and no resend unchanged.
5. Real local HTTP/provider/S3 executions plus existing process/worker/state/oracle regressions. Produce operator diagnosis source/PDF and capture with actual logs, update README/architecture and final coverage mapping.
6. Final placement/dependency/retention/staged/outgoing checks, candidate mapping, independent required and optional Grok/Gemini review, current-head CI, guarded authorized main integration and main CI; cleanup only after consumers finish.

Risks: silent privacy leakage from error/identifier formatting; missed async/queue/shared boundary; rate/queue loss mistaken for a complete trace; log sink stall affecting request/drain; accepted delivery mislabeled confirmed; instrumentation altering ownership/retry/deadline. Typed fields and explicit safe classification, operation terminal semantics, independent loss metrics, try-send producer and existing business regressions address them. Rejected: unbounded synchronous println, logging every raw request/provider error, global request ID for unrelated shared owners, changing retry/compensation merely for observability, a network collector/runtime verification mode. No new dependency is required; existing serde_json/time/ring/Tokio suffice.

User scenarios: operator finds HTTP failure by time/safe route/status then follows trace/parent and shared-owner link; follows a retry/fallback to terminal outcome; distinguishes accepted FCM from unknown send/durable result failure without resending; reconstructs journal reconciliation/void; observes queue/sink loss without service stall; sees sensitive synthetic values absent. Each maps to AUDIT/TRACE/DIAGNOSE/PRIVACY/BOUNDS/PLACEMENT in the retained scenarios JSON.
