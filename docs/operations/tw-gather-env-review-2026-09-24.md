# Gather environment file review — 2026-09-24

Context: issue #2563 / PR #2566 added dotenv loading for `server/.env`. During
that work AK supplied the operator's private `tw-gather.env` for review. The file
is not a repository artifact; no values are recorded here. Configuration syntax,
precedence and the sanitized example remain in
[server configuration](../../server/CONFIGURATION.md).

## Observations

- The reviewed file selects `SERVER_MODE=gather`, DB data version `2.0` and port
  `3000`. See the [runtime modes](../architecture/service-overview.md#runtime-modes)
  for what gather mode starts.
- It does not provide `DATA_GO_KR_NORMAL_KEY` or `DATA_GO_KR_CERT_KEY`. AK
  confirmed on 2026-09-24 that the current production server does not use these
  two settings; they can remain unset for current operation. This is an
  operator-confirmed deployment fact, not a new live-server inspection. The
  configuration fields are retained for legacy source callers, and the
  [.env.example](../../server/.env.example) assignments stay commented out.
- It sets `TWA_S3_REGION` and `TWA_S3_WEATHER_DATA_BUCKET_NAME`. The server
  source at the time of review had no consumers for them, so loading them does
  not enable an S3 integration.

## Limitations

Only the supplied file was reviewed. The running gather host's process
environment, other operator files and the deployed revision were not inspected
for this record.
