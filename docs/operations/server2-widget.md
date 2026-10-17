# server2 retained world widget

AK retained existing widget support on 2026-10-17. `GET /ww/010000/current/2?gcode=lat,lon` is a required native supplement outside the historical 19 method/path groups. Its historical request volume is unknown. This guide covers the current legacy endpoint contract and local verification; it does not authorize activation or qualify a released iOS binary.

## Request and selection

Keep `dsf` in the process's existing `SERVER2_NATIVE_FAMILIES` list. This enables the widget endpoint on the same funded world weather and air engine. Preserve the other selected families and operator-injected configuration. The widget needs no geocoder and no legacy origin. Disabling `dsf` removes this native route; it does not implement a widget fallback to legacy.

The exact retained request is:

```text
GET /ww/010000/current/2?gcode=35.68,139.76
Accept-Language: ko
```

HEAD has the GET status and length with no body. A matching ETag returns 304. The successful response has no added Cache-Control policy. Missing or malformed `gcode` returns 400 locally. Unused world categories and routes are outside this supplement.

## Preserve the raw contract

The current legacy route returns `timezone`, `location`, `pubDate`, `daily`, `thisTime`, `hourly`, `shortest`, `source` and `units`. It retains raw `temp_c/temp_f`, `tempMin_c/tempMax_c`, local date strings and original icon case. Hourly data begins at yesterday's local midnight and ends at most 48 hours ahead. Daily data begins yesterday. Units are metadata on this route: requesting Fahrenheit does not run the coordinate route's conversion middleware. Air fields belong on the current row only.

The two inspected iOS source trees construct this URL, but some display code reads `current.t1h` and converted daily fields. Those references differ from the current server contract. This port preserves actual endpoint behavior and does not claim that an installed widget was exercised or that this pre-existing client mismatch was repaired. A client behavior change needs its own contract and device validation.

## Failure and recovery

An initial provider authentication failure remains HTTP 401. Requests during the provider-down window return HTTP 503 with `EWEATHERUNAVAILABLE`, `retryAt`, Retry-After and no-store. Generic provider failure remains HTTP 500. Native weather acquisition, quota ownership, S3 publication, stale/failure handling and air deadlines are shared with the existing world implementation. The new path does not reset budgets or add retries.

Warm requests reuse the cell. After a process restart, S3 remains authoritative for weather and air. Local verification disables the owned provider peers after the first successful publication, then checks that a new process serves identical bytes with no additional weather, air, geocoder or legacy calls. Missing production state must terminate natively, not depend on legacy.

## Repeat the owned verification

Build the release `server2` binary and `loopback_server` example under `server2/`, then run:

```text
python3 server2/tools/widget_smoke.py --binary <release/server2> --output <new-evidence-directory>
```

The smoke starts only owned loopback S3 and synthetic recorded-format weather/air peers, uses dummy credentials in an empty working directory, writes a report and diagnostic logs, and retires its processes. It makes no public provider, AWS, push or device call. The report includes executable hashes, cold/warm results, conditional and error checks, restore results and call counts. Device-sends zero describes this isolated no-send setup; it is not a production device counter.

The [selected verification record](../evidence/tasks/issue-2705-s20d/verification.md) binds the actual release run. [Cutover preparation](server2-cutover.md) still requires production revision parity, seven-day paired shadow, host/listener/capacity and quota measurements, S3/IAM/IMDSv2 readiness, final state/rainfall handover, an eligible complete previous server2 bundle, and separately scoped approval. Local PASS does not close #2704/#2705 or make production eligible.
