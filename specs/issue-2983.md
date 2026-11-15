# Spec: server2 log pipeline LP-6 (#2983)

- **LP6-AC1 Three sources.** On an isolated Linux host running the candidate, guard and reader against local peers, records of all three arrive at the S3 stand-in under the sources `server`, `guard` and `reader` (plus the collector's own records).
- **LP6-AC2 Provider stop.** A guard stop caused by a provider 401/403/429 on the candidate leaves, at the destination, the candidate's failing record and the guard's stop record, after the units are stopped (the retention step drains the collector) and the host's disk is discarded.
- **LP6-AC3 Supervision unchanged.** The guard's stop decisions, the 168 h/170 h deadlines, the 10 s unit stop timeout and the 30 s watchdog are unchanged; the existing stop checks (configuration change, frozen guard, deadlines) pass with the collector installed, with it stopped, and with the destination unreachable.
- **LP6-AC4 Privacy.** Output at the destination contains no response body, URL, key or any of the synthetic sensitive values of the #2802 checks.
- **LP6-AC5 Cost and identity.** The priced cost model contains the log shipping items (S3 requests, storage, export transfer; CloudWatch not selected) and its projection stays inside the existing ceiling; installation refuses a bundle whose collector files differ from the reviewed ones.
- **LP6-AC6 Documentation.** The shadow operations guide and `docs/operations/server2-logging.md` say where each process's records are after the host is deleted; links and placement pass.
