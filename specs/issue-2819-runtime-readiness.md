# Private runtime readiness specification

[Intent](../intent/issue-2819-runtime-readiness.md). Parent source at intake:
`1baea4fb39661d6655b417d7e4a9a98353648510` (unmerged PR2835).
Exact intended paths: `server2/config/tasks/RuntimeReadiness2819.json`.
This specifies a new operator API; implementation and verification are pending.

## Observable contract

RR1 — Add private `GET /internal/ready` on the existing private metrics listener. Public
`/health` remains liveness and must not inherit readiness failures. Existing private
`/internal/metrics` remains compatible. Public requests to `/internal/ready` do not expose
the private status. GET and HEAD share the readiness check; other methods are rejected
without probing dependencies. No new port, mode, environment setting or public product
route. Partial code-injected development factories remain supported and must be labelled
with absent components, rather than claiming production coverage.

Return HTTP200 only when the process is serving and all configured checked components
are available; otherwise HTTP503. Use `Cache-Control: no-store` and bounded JSON with
these fixed fields: `ready` (boolean), `process`, `push`, `credentials`, `s3`.
`process` is `ready` or `stopping`; `push` is `ready`, `not_ready` or `not_required`;
`credentials` and `s3` are `ready`, `unavailable`, `not_required` or `not_checked`.
Never include raw dependency errors, credentials, tokens, account/bucket names, object
keys, file paths or URLs. HEAD returns the same status/headers without a response body.

For configured push, use canonical `PushService::ready()` (restored state and existing
writer receiver open). Do not add another restore/writer flag, writer task or polling
monitor. Observe the existing process shutdown watch; stop or loss of its sender is
not-ready. Recheck these local states after any awaited storage work before success.
This is a readiness snapshot, not atomic admission, a guarantee against a later failure,
or proof that pending commands finished draining. Existing stop/drain and send ownership
must not change.

RR2 — When ProcessS3 is configured, check its actual credential source and perform one
bounded signed read-only LIST through the same transport and existing S3 admission.
Use `raw/v2/`, `max_keys=1`, at most64KiB response XML, and the existing strict LIST parser.
An empty valid list is success. All credential wait, admission wait and network work
share one3-second deadline; no retry, detached request, background schedule, result cache
or new semaphore pool. A credential-source failure prevents the LIST. Invalid XML, denial,
transport error, timeout or exhausted admission cannot produce readiness success. Failure
followed by restored dependencies is observable on a later ordinary request.

An early local not-ready result may leave storage fields `not_checked`; absent configured
storage uses `not_required`. Static keys cannot be remotely validated by a local snapshot;
only the signed read provides the limited remote check. Existing C6 Firebase account
prevalidation/caching remains the startup contract. Do not reread cached account files or
call OAuth/FCM/providers from readiness.

A successful LIST proves only credential availability and configured S3 reachability/list
permission for this prefix at that instant. It does not prove object Get/Put permissions,
all namespaces, S3 missing-object403/404 policy, provider/FCM authorization, API parity,
quota headroom, EC2 capacity, full recovery, shadow or cutover eligibility. E4 and deferred
#2724 remain separate. Do not embed the write-producing `s3_readiness` tool.

## Verification and delivery

RR3 — Before code, record the current private404 feature Red with an owned runtime. Cover
healthy/empty LIST, credential failure, denial/server failure, malformed/oversized response,
bounded admission/HTTP waits, cancellation and recovery. Assert no writes/provider/FCM
work and no retry. Cover canonical push restore/writer failure and process stop during a
pending probe; preserve liveness/metrics and public/private isolation. Test dependencies
are injected owned loopback peers and synthetic credentials, never mode flags.

After focused and affected regression checks, execute a separate retained optimized real
shared-process CLI with bound public/private listeners and owned HTTP S3. Observe success,
failure and recovery, actual HTTP body/headers and stop/port retirement. Retain original
failed invocations, source/executable/input hashes and cleanup evidence. This is not a
portable full release bundle or execution on a production host. Main/factory differences
and compile-time checkout requirements must be stated.

RR4 — Maintain API/operations/architecture contracts and parent execution status. Deliver
an actual owned-workflow screenshot manual with editable Markdown source, rendered PDF
and visual inspection. Refresh final committed-source Archify JSON/HTML with artifact,
browser and scoped visual checks. Preserve exact server2 placement and dependencies;
no runtime import, include, symlink or data read from legacy/shared assets. Stage checks,
independent current review, selected finding resolution and exact parent/current CI gate
pre-merge completion. No merge, auto-merge, queue, cloud mutation/deploy, live provider or
device sends, seven-day shadow or production qualification is authorized by this slice.


## 2026-10-19 continuation

Current implementation baseline is integrated `c1ae9082`; the original intake identity above is historical. Decode the bounded LIST through existing `SharedState::run_cpu` within the same three-second deadline; CPU admission/task failure returns unavailable. No independent pool or duplicate readiness state. The public health and private metrics behavior remain unchanged.
