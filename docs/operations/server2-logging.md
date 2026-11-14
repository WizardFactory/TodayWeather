# server2 structured diagnostics and incident response

This contract describes the repository implementation for #2802; the [host log pipeline](#host-log-pipeline) section adds #2977. Installation on a production host, production retention and provider availability are not established by local verification. The [baseline audit](server2-logging-audit.md) records the pre-change gaps; the implementation audit below records coverage and exclusions. See the [flow](../architecture/diagrams/server2-logging.html), [editable diagram](../architecture/diagrams/server2-logging.json), [PDF](server2-logging.pdf) and [selected verification](../evidence/tasks/issue-2802/verification.md).

## First five minutes of an incident

1. Preserve the UTC incident window, deployed executable SHA-256/release identity, service status and internal metrics. Retain stderr before rotating or replacing the process. Use the installed service's approved log reader; no service name, collector or deployment configuration is assumed here.
2. Find the failed HTTP terminal record by time, `route`, `method` and numeric `status`. Its generated `trace_id` identifies the operation. No client header or user identifier becomes a trace ID. A 501 alone identifies neither a provider failure nor a safe retry.
3. Follow the trace with the local tool below. Read `parent_operation_id` and `operation.linked` records. A joining request has its own trace; `linked_trace_id`/`linked_operation_id` identify the existing owner that performed shared work. Keep both traces in the incident evidence.
4. Read the deepest classified failure, the chosen action and the parent terminal outcome together. HTTP/provider status completion does not confirm a durable commit, and an acknowledged FCM request does not confirm device delivery. Use the decision table before attempting recovery.
5. Check `server2_logging_*_total` and `logging.loss`. Missing start/end/link records, process termination, filtering or drops prevent a complete reconstruction. Preserve uncertainty and inspect authoritative state before a mutating recovery action.

On a copied operational stderr capture, an initial lookup can use:

```sh
jq -c 'select(.schema==1 and .component=="http" and
  .event=="operation.finished" and .status>=500)' incident.ndjson
python3 server2/tools/diagnose_logs.py --trace TRACE_32_HEX incident.ndjson
# Focus one anonymous submission, retaining ancestor/shared batch context:
python3 server2/tools/diagnose_logs.py --trace TRACE_32_HEX \
  --operation OPERATION_16_HEX incident.ndjson
```

Replace `TRACE_32_HEX` with an observed lowercase 32-digit ID and `OPERATION_16_HEX` with an observed anonymous 16-digit submission ID. The tool reads local files only, follows shared links in both directions and preserves input order and outcomes. It limits input to 128 MiB/100,000 records and rejects oversized or incomplete lines; select a smaller complete UTC window on failure. It reports loss summaries outside the selected trace too. A trace query can include other requests sharing an owner. An operation query follows only that item and its descendants/shared owner, then adds ancestor and shared batch claim/result context; it excludes unrelated sibling sends. A batch result can cover more items than the selected submission, as its `count` states. It never resends, replays, edits state or proves delivery. Search a copied capture rather than modifying the original.

## Cause, action and outcome

| Evidence | Interpretation | Next diagnostic action |
| --- | --- | --- |
| `provider_http`, status 401/403, `auth` | Peer refused authentication/authorization | Check credential presence, expiry and permissions through the approved secret management path. Never print the credential. Parent events distinguish terminal refusal from an existing key rotation. |
| status 429, `quota`; `reserve` refusal | Provider cap or funding admission refused | Check quota counters and the funding window. A `retry` or `rotate_key` event records an existing decision only; logs do not authorize extra attempts. |
| status 5xx, `dependency`; `transport`/`timeout` (or a safe connection-refused/reset/address-unavailable class) | Dependency response or transport failure | Follow attempt numbers and the parent's retry/fallback/terminal event. Check the dependency's health without invoking collection routes as probes. |
| `publish`, `conflict`, `reconcile` | Conditional write conflicted | Follow existing read-back/reconciliation. A transport status receipt is not the committed state. |
| `reconcile`, `reconciled` | Existing reconciliation identified this operation | Confirm the enclosing commit's terminal result. A child read or PUT alone is insufficient. |
| `void`, `voided` | Existing void compensation was acknowledged | Confirm enclosing commit/reconcile outcome and authoritative journal state. No compensation was added for logging. |
| `send`, `accepted` | FCM accepted the request | It does not establish device delivery or successful result recording. Follow `record_result` under the same worker trace. |
| `send`, `unknown`; `do_not_retry` | The send may have reached the external service | Retain the durable claim. Inspect claim/result state through existing authorized procedures; do not replay the notification. |
| `record_result`, `success` | Result ledger write was recorded | It confirms that ledger operation, not device delivery. `unknown` keeps the retained claim and uncertainty. |
| `cancelled`, `detach_waiter` | Request waiter left or was dropped | Its owned acquisition may still finish. Follow the linked owner; do not interpret waiter cancellation as owner cancellation. |
| `publish`, `unknown` on drop | Publication scope ended without acknowledged completion | It conservatively marks possible external work from scope entry, even before a PUT may have started. Reconcile before retrying. |
| `submission`, `cancelled` | Item processing stopped; an existing batch claim or child send can remain | Read child send outcomes and the batch claim/result. Parent cancellation never proves that no notification reached FCM. |
| `runtime_teardown`, `unknown` | Completion of detached provider owners was not verified | Shutdown does not attest every provider owner completed. This record alone does not assert that an owner was active or cancelled. |
| `operation.panic`, `panic` | Panic hook observed an unwind/abort boundary | Use vetted `source`/`line`, build identity and neighboring operation records. Payload/backtrace text is deliberately suppressed. |

`completed` means the stage returned; inspect its children/result classifications. `success` applies only to the named stage. `failed` does not imply that every child side effect was undone. `unknown`, `cancelled`, `conflict` and `skipped` are distinct outcomes. No new retry, fallback, journal compensation or FCM resend behavior is introduced. Existing batch ownership and result payloads are preserved. Legacy textual Diagnostics callbacks remain available to existing consumers, but stderr uses the typed claim/result/poll operations instead of inferring outcomes from those strings. Pre-claim state unavailability is recorded inside its cycle without asserting that a claim exists.

For an uncertain operator notice mutation, the event includes the CLI-generated `durable_operation_id`. It uses the existing notice-cli nonce/process SHA-256 algorithm and maps the diagnostic trace to the existing transaction. Keep it for authorized durable-state inspection before repeating. Registration IDs, FCM tokens, object keys, arbitrary business identifiers and hashes of personal inputs are not log fields.

## Event fields and correlation

Every operational stderr line is schema-1 NDJSON, at most 1,024 bytes including newline. Fields are UTC RFC3339 `timestamp`, caller-declared build revision or `unknown`, severity, fixed `event`, `component`, `stage`, generated trace/operation/parent IDs, safe `route` and `method`, fixed `cause`, `action`, `outcome`, and applicable numeric status/attempt/duration/count. Notification work also carries allowlisted `delivery_kind` (`alarm`, `alert`, `warning`); a failed submission can carry an allowlisted `failure_class` such as weather, message, state guard, credentials or OAuth. No raw error text is copied into that class. Shared links add generated linked IDs. Vetted source identities/line numbers are compiler locations from an allowlist, not user-supplied paths. Generic async wrappers identify their logging boundary; they do not promise a full stack trace.

`build_revision` is populated only by a 40-hex `SERVER2_BUILD_REVISION` compile-time value. It is a caller declaration, not signed provenance; verify the executable hash/release receipt. Timestamps depend on the host clock; compare clock synchronization across hosts. Durations use monotonic time. Operation IDs are unique within a process sequence; use the full trace as the lookup identity across process logs.

HTTP creates a new root without changing response bodies, headers or status. Its terminal/duration records when the router returns a response; it does not confirm body delivery or client receipt. Async tasks, JoinSet futures and blocking work inherit context before handoff. Push writer commands carry enqueue context. Shared acquisitions keep the initiator's owner identity and link later joiners. Scheduled history/alarm/alert/warning cycles create fresh roots. Each notification item has an anonymous `submission` child spanning preparation/sending; its FCM operation is a child of that item. Alarm/alert claims and result writes remain batch-level, with a count rather than user IDs. Warning claim/result writes belong to the individual submission. Submission acceptance describes the send outcome; follow the applicable result ledger before assessing durability. Mutex-owner metadata is best effort: contention omits a link rather than attributing work to an old owner. Root/terminal records remain useful when an ancestor is filtered or lost.

No event API formats raw errors, URLs, headers, request/response bodies, key material, precise coordinates, registration IDs or notification text. Synthetic privacy checks include URL/header and panic payloads; existing delivery/state tests guard behavior. The stdout readiness line and notice JSON/help output remain machine protocols, not operational stderr. Notice CLI JSON is product output and can contain notice content; keep it separate from the operational log stream.

## Output bounds, filtering and retention

- `SERVER2_LOG_LEVEL`: `error`, `warn`, `info` (default), or `debug`. `SERVER2_LOG_RATE`: 1–1,000 events per second per severity; default 100. These are startup settings, not a live configuration endpoint. Invalid values fall back safely and emit a classified configuration notice without the invalid value.
- A fixed 256-record queue feeds one dedicated stderr thread. Producers serialize only bounded typed fields and use try-send/atomics; they never wait for sink IO. Rate admission uses bounded CAS attempts. Context scopes add a small boxed future per boundary to avoid large nested async layouts. No arbitrary output file or network collector is supported.
- Error/warn/info/debug have independent rate buckets. Frequent lookup/restore/reserve/HTTP transport success, expected S3 absence and health/metrics operations are debug. Failures remain warn; panic/startup fatal records are error. Normal client 4xx HTTP terminals are info except 429. A shared queue can still fill and drop errors; separate rate buckets are not a delivery guarantee.
- Internal metrics expose cumulative filtered, rate-limited, queue-full, oversized and sink-error counts. Expected debug filtering is not a failure. Nonzero loss counters mean the capture may be incomplete. The writer tries a `logging.loss` summary at ten-second intervals or a shutdown flush; a blocked/closed sink cannot reliably report its own failure, so metrics are independent.
- Shutdown flushing uses at most 50 ms of unused existing drain allowance. It cannot extend the existing 6-second HTTP-only or 35-second worker process stop bound. Acknowledging a flush is not durable log storage. Runtime teardown can cancel detached provider work after that flush; absence of its terminal event proves nothing.
- Before deployment, assign an approved host collector, bounded storage budget and rotation/retention window, restricted service/operator access, clock synchronization and export procedure. Keep stdout/stderr separate if the host reader supports it. Preserve the selected incident window and executable identity before rotation. No host logging configuration, production retention period or permission change was installed by this task. The host collector is now defined by the [host log pipeline](#host-log-pipeline) below (#2977).

## Host log pipeline

Issue [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977) adds the host side in slices. This section describes LP-1 ([#2978](https://github.com/WizardFactory/TodayWeather/issues/2978)): collector, destination selection, validation, naming and the local journal; LP-5 ([#2982](https://github.com/WizardFactory/TodayWeather/issues/2982)) adds the AWS templates and LP-2 ([#2979](https://github.com/WizardFactory/TodayWeather/issues/2979)) loss visibility below. Boot configuration and instance identity (LP-3, #2980), Spot interruption handling (LP-4, #2981) and the qualification host (LP-6, #2983) follow. Nothing here creates an AWS resource or deploys a host.

The server process is unchanged: it writes NDJSON to stderr and its readiness line to stdout. A host collector outside the process ships that output. Assets live in [`server2/deploy/logging/`](../../server2/deploy/logging/). An operator walkthrough with actual captures is in the [pipeline manual PDF](server2-logging-pipeline.pdf) ([editable source](assets/server2-logging-pipeline/manual.json)).

### Install

On the Linux host, as root, from a checkout or bundle of `server2/deploy/logging/`:

```sh
bash server2/deploy/logging/install.sh                       # downloads the pinned collector
bash server2/deploy/logging/install.sh --collector-tarball PATH  # or uses a local copy
```

The installer checks the collector archive's SHA-256 against [`collector.json`](../../server2/deploy/logging/collector.json) before extracting it, creates the `server2` system user, and installs:

| Path | Purpose |
| --- | --- |
| `/etc/systemd/system/server2.service` | The server: `/opt/server2/bin/server2` in `/opt/server2/config` (where its `.env` is read). Output goes to the `server2` journal namespace with journal rate limiting off. It is ordered after the collector without requiring it, so a shutdown stops the server first and the server starts when the collector is missing or rejected. |
| `/etc/systemd/system/server2-logs.service` | The collector. Its start condition runs `render.py` and `status.py start` (overrun check); the collector itself (Vector) runs as a dynamic user in the `systemd-journal` group; its stop runs `status.py drain`. |
| `/etc/systemd/system/server2-logs-status.{service,timer}` | Status record every 60 s while the collector runs (LP-2). |
| `/etc/systemd/journald@server2.conf` | The local copy: persistent, compressed, capped at 1 GiB, no rate limit. |
| `/etc/systemd/journald.conf.d/server2-system.conf` | Caps the system journal at 512 MiB, so host logs stay within the 2 GiB log budget of [`prerequisites.json`](../../server2/deploy/staging/prerequisites.json). |
| `/opt/server2/logging/` | `vector`, `render.py`, `status.py`, `collector.json`. |

It enables the server, the collector and the status timer, and starts only the timer, which does nothing while the collector is stopped. The server binary and its `.env` come from the release procedure.

### Select destinations

The collector reads these names, from its unit environment first and then from the server's `/opt/server2/config/.env` with the same dotenv rules as server2. It reads no other name from that file, so provider keys never reach the collector's process or configuration.

| Variable | Values | Default |
| --- | --- | --- |
| `SERVER2_LOG_SINKS` | Comma-separated `local`, `s3`, `cloudwatch` | `local` |
| `SERVER2_LOG_S3_LEVEL` | `error`, `warn`, `info`, `debug`: minimum level shipped to S3 | `info` |
| `SERVER2_LOG_CLOUDWATCH_LEVEL` | Same, for CloudWatch Logs | `warn` |
| `SERVER2_LOG_S3_PREFIX` | Key prefix in the bucket, e.g. `logs/server2`; must not start with a weather data prefix (`raw`, `index`, `packs`, `summary`, `state`, `budgets`, `geocode`) | required with `s3` |
| `SERVER2_LOG_CLOUDWATCH_GROUP` | An existing log group; the collector creates streams, never groups. Names starting with `aws/` are reserved by AWS and rejected | required with `cloudwatch` |
| `SERVER2_S3_BUCKET`, `SERVER2_S3_REGION` | The server's existing settings; the region (default `ap-northeast-2`) is also used for CloudWatch Logs | — |

`SERVER2_LOG_LEVEL` still bounds what the process emits: a destination level below it receives nothing extra. The local journal is always kept. With `local` alone the collector unit is skipped ("condition failed") and nothing leaves the host. An unknown destination or level, a malformed name or a missing required name fails the collector unit with a message that names the variable and the rule but not the value; the server keeps running. A settings change takes effect at the next `systemctl restart server2-logs.service`.

Example configurations; moving between them is the owner's decision and a configuration change, with no automatic switching:

| Phase | Settings |
| --- | --- |
| Local only (default) | `SERVER2_LOG_SINKS=local` |
| Early operation: everything searchable in CloudWatch | `SERVER2_LOG_SINKS=local,cloudwatch`, `SERVER2_LOG_CLOUDWATCH_LEVEL=info`, `SERVER2_LOG_CLOUDWATCH_GROUP=/server2/production` |
| Stable operation: warnings in CloudWatch, full stream in S3 | `SERVER2_LOG_SINKS=local,s3,cloudwatch`, `SERVER2_LOG_CLOUDWATCH_LEVEL=warn`, `SERVER2_LOG_S3_LEVEL=info`, `SERVER2_LOG_S3_PREFIX=logs/server2` |
| Low cost | `SERVER2_LOG_SINKS=local,s3`, `SERVER2_LOG_S3_LEVEL=info` |

At the measured volume (9–15 MB per hour at `info`), CloudWatch at `info` costs about $5–9 per month in Seoul, CloudWatch at `warn` under $0.05, and S3 about $0.2 per month per log source, mostly PUT requests (see #2977).

### Prepare AWS for the destinations

LP-5 ([#2982](https://github.com/WizardFactory/TodayWeather/issues/2982)) defines what AWS needs; nothing has been provisioned. Retention values (owner decision, 2026-11-14): **CloudWatch Logs 30 days**; **S3 log objects 90 days** (current versions expire after 90 days and their noncurrent versions one day later, so the bytes are gone after about 91 days).

| Template in [`server2/deploy/logging/aws/`](../../server2/deploy/logging/aws/) | What it does |
| --- | --- |
| `role-policy.template.json` | A second inline policy for the instance role. It allows `s3:PutObject` on `<bucket>/<prefix>/*`, and `logs:CreateLogStream`, `logs:PutLogEvents` on the group's streams and `logs:DescribeLogStreams` on the group. `DescribeLogStreams` is required because the collector's CloudWatch sink calls it before writing ([LP-1 evidence](../evidence/tasks/issue-2978/verification.md)). Nothing else: no read, list or delete of log objects, no group creation and no retention change. |
| `bucket-lifecycle.template.json` | The bucket's lifecycle configuration, limited to `<prefix>/`: current versions expire after 90 days, noncurrent versions 1 day after, expired delete markers are removed (separate rule, because `Days` and `ExpiredObjectDeleteMarker` cannot share a rule) and incomplete multipart uploads are aborted after 1 day. It is the bucket's first deleting rule and must never match a weather prefix. |
| `log-group.template.json` | The log group (`STANDARD` class) with `retentionInDays` 30. |

Render them for the actual names. The renderer applies the collector's own validation and refuses a prefix inside a weather data prefix:

```sh
python3 -I server2/deploy/logging/aws_templates.py --bucket "$BUCKET" --prefix logs/server2 \
  --group /server2/production --region ap-northeast-2 --account "$ACCOUNT" --out "$OUT"
```

The owner then applies them with administrator credentials (the instance role can do none of this). `put-bucket-lifecycle-configuration` **replaces** the whole configuration, so read it first. `prerequisites.json` records no lifecycle configuration; if one exists, merge the rules instead.

```sh
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"   # expect NoSuchLifecycleConfiguration
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "file://$OUT/bucket-lifecycle.json"
GROUP=$(jq -r .logGroupName "$OUT/log-group.json")   # CloudWatch splits creation and retention into two calls
aws logs create-log-group --log-group-name "$GROUP" --log-group-class "$(jq -r .logGroupClass "$OUT/log-group.json")" --region ap-northeast-2
aws logs put-retention-policy --log-group-name "$GROUP" --retention-in-days "$(jq -r .retentionInDays "$OUT/log-group.json")" --region ap-northeast-2
aws iam put-role-policy --role-name tw-server2-runtime --policy-name tw-server2-runtime-logs \
  --policy-document "file://$OUT/role-policy.json"
# Read back
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
aws logs describe-log-groups --log-group-name-prefix "$GROUP" --region ap-northeast-2 \
  --query 'logGroups[].[logGroupName,retentionInDays,logGroupClass]'
aws iam get-role-policy --role-name tw-server2-runtime --policy-name tw-server2-runtime-logs
```

The templates and their checks are local: `test_logging.py` fails on any grant beyond the list above, and on a lifecycle that is not exactly the two rules above (any other rule, field such as `NewerNoncurrentVersions` or `Transitions`, or period), or whose filter is empty or overlaps one of the eight weather prefixes of the [staging role policy](../../server2/deploy/staging/role-policy.template.json). The integration check accepts only collector calls granted by the role template. IAM evaluation against real AWS has not been exercised.

### What leaves the host

Each remote destination has its own journal reader, filter and checkpoint, so its level and progress are independent of the other destination. A destination receives:

- server records (`server2.service`) that are schema-1 NDJSON with `level` at or above the destination's level, as the original line, unchanged;
- collector records (`server2-logs.service`, `server2-logs-status.service`) in the collector record format, at every level.

Everything else stays in the local journal only: the stdout readiness line, any line that is not schema-1 NDJSON (for example a runtime abort message) and the collector's own diagnostics.

The **collector record format** is one JSON object per line with `"collector_schema": 1`, `timestamp`, `level`, `event` and fixed fields per event. It never uses the server's `schema` field. LP-1 writes one record per collector start:

```json
{"collector_schema": 1, "event": "collector.started", "level": "info", "timestamp": "…Z",
 "collector_version": "vector 0.61.0", "sinks": ["local", "s3", "cloudwatch"],
 "instance_id": "<32 hex>", "boot_id": "<32 hex>"}
```

**Naming.** `source` is `server` or `collector`; `instance-id` is the host's machine ID until LP-3 adds the EC2 instance ID; `boot-id` is the journal boot ID of the record; times are UTC.

- CloudWatch stream: `<source>/<instance-id>/<boot-id>`
- S3 key: `<prefix>/<source>/dt=<YYYY-MM-DD>/hour=<HH>/<instance-id>/<boot-id>-<YYYYMMDDTHHMMSSZ>-<uuid>.ndjson.gz`, gzip, one record per line. Records are partitioned by their own time; an S3 object is closed at least every 60 seconds.

### Stop behaviour and remaining limits

- **Stop drain (LP-2).** On SIGTERM the collector stops reading the journal at once, and its checkpoint covers only deliveries confirmed before the stop. LP-1 therefore lost the final records at a shutdown (in the LP-1 smoke, every record from the last 41 ms) and resent records after a restart (15 of 20 in a measurement). The collector's stop now first waits, for at most 75 s, until every destination has confirmed everything up to the journal's end (`status.py drain`), and writes a `collector.drained` record. With that, a stop after the server has stopped (every shutdown: the server stops first) ships the server's final records and resends nothing at the next start (LP-2 check). **Open:** a restart of the collector alone while the server keeps writing can still resend records read during the drain: they are flushed at SIGTERM without a checkpoint update (review finding CX-LP2-007; the owner's decision is pending). Records are unique per line, so duplicates can be removed when reading. A stop therefore takes up to about one S3 object window, 60 s, or 75 s plus 20 s when a destination is failing. If a destination is still failing after 75 s, the stop proceeds; its unconfirmed records stay in the journal and are sent once after the next start, and the `collector.drained` record is `warn`. The Spot time budget is LP-4's (#2981).
- **Identity and credentials.** The instance ID is the machine ID and credentials come from the default AWS chain (the instance role on EC2) until LP-3 (#2980).

### Loss, redelivery and counters

LP-2 ([#2979](https://github.com/WizardFactory/TodayWeather/issues/2979)).

- **The server is independent of the pipeline.** With the collector stopped, or with both destinations failing, the server's responses and its stop time are unchanged (checked against a baseline).
- **Destinations are independent.** Each has its own journal reader and checkpoint. While S3 failed for more than a minute, CloudWatch kept receiving every record within 1 s. When S3 recovered, including after a collector restart during the outage, every record arrived exactly once and in journal order. The local journal is the buffer: a failing destination's reader stops advancing, and nothing is dropped while its unshipped records are still in the journal.
- **Journal capacity.** The `server2` namespace keeps 1 GiB. At the measured 9–15 MB per hour at `info`, that is roughly 68–110 hours (about 3–4.5 days) of output before an outage starts losing records; compression extends it. Beyond that, records rotate out unshipped.
- **Overrun record.** When records left the journal before a destination's reader got to them, the collector writes a warn record at its next start and at the next status run:

  ```json
  {"collector_schema": 1, "event": "collector.journal_overrun", "level": "warn", "destination": "s3",
   "lost_from": "…Z", "lost_until": "…Z", "overrun_count": 1, "timestamp": "…Z"}
  ```

  Every gap is reported once, and the count per destination is kept in the collector's state directory. The range covers entries the reader never saw; they can include the collector's own diagnostics, which are never shipped. A reader with no acknowledged delivery yet is compared against the position it started from.
- **Counters.** The collector serves Prometheus counters on `127.0.0.1:9598` only (`curl -s http://127.0.0.1:9598/metrics` on the host). Per destination (`component_id="s3"` or `"cloudwatch"`), loss shows in `vector_component_errors_total` (requests that failed after the collector gave up retrying), `vector_component_discarded_events_total{intentional="false"}` and `vector_buffer_discarded_events_total` (records dropped). `intentional="true"` on `select_*` counts records below the destination's level, which is filtering, not loss. The counters restart at zero with the collector.
- **Status record.** Every 60 s while the collector runs (a tick during a collector stop or restart is skipped), `server2-logs-status.timer` writes one collector record, which is shipped to every destination:

  ```json
  {"collector_schema": 1, "event": "collector.status", "level": "warn", "metrics_available": true,
   "destinations": {"s3": {"unshipped_seconds": 128, "behind": true, "sent_events": 0, "failed_requests": 0,
                           "dropped_events": 0, "journal_overruns": 0},
                    "cloudwatch": {"unshipped_seconds": 0, "behind": false, "sent_events": 55, ...}}}
  ```

  `unshipped_seconds` is the age of the oldest journal record that the destination has not yet confirmed. `behind` is true above twice the destination's delivery window (S3 120 s, CloudWatch 20 s). This is how an outage shows **while it lasts**: the collector retries a failing destination indefinitely and counts `failed_requests` only when it gives up, so the counters alone stay at zero during an outage (observed). The level is `warn` when a destination is behind, anything was dropped or overrun, or the counters were unavailable. Counters refresh every 10 s.

**Reading the two sides together.** A gap in a destination has these possible causes:
- the server dropped records before they reached stderr: nonzero `server2_logging_*_total` on the server's metrics port and its `logging.loss` records;
- the collector has not delivered them yet, or failed or dropped them: `behind` or a large `unshipped_seconds`, nonzero `failed_requests` or `dropped_events` in `collector.status`, or the Prometheus counters above;
- they rotated out of the journal before shipping: a `collector.journal_overrun` record;
- a record is still in flight: an S3 object closes within 60 s, CloudWatch within seconds.

`collector.started` and `collector.status` records bracket the periods that are covered. A destination with no status record for longer than a few minutes means the collector or the host was down; the local journal on a surviving host still holds the records.

### Read each destination

```sh
# Local journal on the host (both units, full stream including non-NDJSON lines)
journalctl --namespace=server2 -u server2.service -o cat --since '2026-11-14 05:00' --until '2026-11-14 06:00'
journalctl --namespace=server2 -u server2-logs.service            # collector start/validation messages
systemctl status server2-logs.service                              # skipped, active or failed

# S3: list one hour, then read the objects
aws s3 ls s3://$SERVER2_S3_BUCKET/logs/server2/server/dt=2026-11-14/hour=05/ --recursive
aws s3 cp s3://$SERVER2_S3_BUCKET/KEY - | gzip -dc | jq -c 'select(.level=="warn")'

# CloudWatch Logs
aws logs tail /server2/production --since 1h --log-stream-name-prefix server/
aws logs filter-log-events --log-group-name /server2/production \
  --filter-pattern '{ $.level = "error" }' --start-time $(date -d '-1 hour' +%s000)
```

Save a selected window with `-o cat` (journal) or the decompressed S3 objects, then use the [trace lookup](#first-five-minutes-of-an-incident) above on that copy.

### Collector choice

The collector is [Vector](https://github.com/vectordotdev/vector) 0.61.0 (MPL-2.0), pinned in `collector.json`: aarch64 musl archive SHA-256 `12d7e91d…464675c`, x86_64 `e1609b8a…5237621`, both equal to the release's published `SHA256SUMS`. Both binaries ran on Ubuntu 24.04 (x86_64 through Rosetta). Feasibility answers, observed on Ubuntu 24.04 aarch64 with systemd 255 (2026-11-14, [evidence](../evidence/tasks/issue-2978/verification.md)):

| Question | Answer |
| --- | --- |
| Reads the journal of selected units | Yes: the `journald` source with `journal_namespace` and `include_units`, as a dynamic user in `systemd-journal`. On systemd 250–257 (Ubuntu 24.04: 255, Amazon Linux 2023: 252) Vector rejects reading previous boots (`current_boot_only: false`), so each reader covers the current boot only. LP-3 must handle the backlog left by a previous boot on a surviving disk. |
| Destinations from variables | Not natively: Vector cannot switch sinks by environment and ignores the AWS SDK's `AWS_ENDPOINT_URL_*` variables. `render.py` validates the variables and writes the configuration; endpoints follow from the region only. |
| Minimal permissions | With health checks off: S3 `PutObject`; CloudWatch Logs `DescribeLogStreams`, `CreateLogStream`, `PutLogEvents`. The CloudWatch sink calls `DescribeLogStreams` before writing, so the role template allows it. No bucket listing, no `DescribeLogGroups`, no group creation. |
| Flush at stop | Without a drain, 0.02–0.24 s but unconfirmed (LP-1). With LP-2's stop drain, a stop waits for confirmation: 57–60 s with an open S3 object, about 0.1 s with CloudWatch only. The bound under a two-minute notice belongs to LP-4. |
| Memory | Peak resident set 70–77 MiB with one or two destinations. |

### Verify the pipeline

`python3 server2/deploy/logging/test_logging.py` checks settings, rendering and unit files offline; CI runs it. The integrated check runs the real server binary, collector and units in a **disposable** Linux VM. It changes `/etc/hosts`, the CA store, users and units there, so never run it on a server2 host:

```sh
sudo python3 -I server2/deploy/logging/linux_check.py --disposable-host \
  --server-binary /path/to/linux/server2 --collector-tarball /path/to/vector-0.61.0-<arch>-unknown-linux-musl.tar.gz \
  --report reports/logging-pipeline/check.json
```

It points the real regional AWS host names at the loopback stand-in [`standin.py`](../../server2/deploy/logging/standin.py) through `/etc/hosts` and a test CA, so the product configuration has no endpoint or test setting; only the collector gets dummy credentials through a test drop-in. Scenarios: local only, S3 only, CloudWatch only, all destinations with a request burst, isolation of the server (collector stopped, destinations failing), a one-destination outage with a collector restart and recovery, a journal overrun, and three invalid settings. The stand-in answers 503 for S3 or CloudWatch while `<state>/fail-s3` or `fail-logs` exists. Each checks delivery while both units run (within 70 s for S3 and 10 s for CloudWatch), exact delivery against the journal per level after the stop, the naming contract, the AWS actions used, the start record, the absence of the synthetic sensitive values at every destination including the journal, and of `.env` values in the collector's environment, and that the server keeps answering. The [PDF](server2-logging.pdf) is the #2802 snapshot and does not cover this section.

## Implementation audit

The baseline gap inventory is preserved at its original revision. This table is its implemented counterpart; pure transformations and per-item CPU loops remain intentionally quiet.

| Subsystem | Implemented coverage | Boundary/exclusion |
| --- | --- | --- |
| HTTP/gateway/listener | Root and terminal status; admission failures; inherited process tasks | No peer IP or raw URL; safe route categories are intentionally broader than endpoint parameters. |
| Native geocode/world/domestic | Lookup/acquisition/restore; owned async/blocking work and shared links; existing cache/fallback decisions | Pure parsing and per-cell values omitted; completed non-Result stages require child outcomes. |
| Provider/quota | Actual HTTP status/error class; funded reserve/refusal, attempts, existing retry/rotation | Payload-level rejection may classify as dependency in the parent even when HTTP was 200; no provider body is logged. |
| S3/catalog/cache | Read/PUT/publication stages; conditional conflict; journal reconciliation/void; cache failure fallback | Transport completion is separate from durable commit; cache skips/misses retain aggregate metrics rather than logging keys. |
| History/summary/warnings | Cycle/lookup/record stages; inherited owned work, warning refresh shared owners; classified failure counts | No one event per parsed row, warning text or summary value. |
| Push state writer | Enqueue context; writer, restore, commit, snapshot, reconciliation and existing void | No registration/transaction payload; inability to restore is a failed admission, not a committed update. |
| Delivery/notice | Fresh worker roots; claim, OAuth, send, result; supervision; translation fallback; safe CLI uncertainty ID | Accepted is not delivered; no resend/replay; CLI stdout JSON/help remains unchanged. |
| Process/output | Startup/bind/quiesce/drain/teardown; per-component joined booleans; privacy panic hook; drop metrics | Provider completion at runtime teardown remains unverified; stdout readiness retained; host collector/retention excluded. |

## Local verification

Use a new output directory and explicit retained release executables:

```sh
python3 server2/tools/logging_smoke.py --binary /path/to/server2 \
  --probe /path/to/logging_smoke --out reports/logging-run \
  --runtime-services /path/to/runtime_services
```

This exercises actual release HTTP and owned loopback 503/403/429 responses, async/blocking propagation, a shared owner, helper cancellation/unknown outcomes and private panic suppression. The drop probes do not prove an external send occurred. With an explicit `--runtime-services` executable, the tool also starts the existing production-lifecycle test entrypoint against owned S3/OAuth/FCM peers, loses one journal write before commit, checks the existing durable void and the next acknowledged update, verifies HTTP-to-writer parent identity, and requires zero notification submissions in that void scenario. Two additional actual result-write fault scenarios require one owned accepted send and a retained claim, then a refused (`failed`) or unacknowledged (`unknown`) result write, without a contradictory skipped summary or process-root claim-retained label. A separate two-alarm/one-minute scenario requires exactly two posts to the owned FCM double, distinct anonymous item parents, one existing batch claim/result and no device sends. Omitting that executable records this process proof as not run. The large local domestic Rust target uses the existing owned catalog peer connection-reuse profile to avoid macOS ephemeral-address exhaustion; the other targets use the unchanged default profile, including its explicit HTTP/1.0 compatibility guard. Initial failed runs remain retained separately. Its early-write fault framing is independently regression-checked, without changing product retries or response assertions. Full Rust regressions, actual worker/state/provider failure captures and the all-family suite supply separate business behavior evidence; inspect the [selected verification](../evidence/tasks/issue-2802/verification.md) for actual commands, layers, hashes and limitations. This task does not qualify earlier-release whole-service recovery, live shadow, quotas or production. S19 remaining recovery work is separate; #2724 measurements are excluded.
