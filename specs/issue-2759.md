# S10f specification: S3 credentials from the EC2 instance role and a server2 S3 region

Source: [intent](../intent/issue-2759.md), issue #2759. Base 0997d702.

## Requirements

R1. Credential source. `AWS_ACCESS_KEY` and `AWS_SECRET_KEY` are each unset when absent, empty or the
legacy `config.js` placeholder `You have to set key of AWS`. Both set: static credentials, as before.
Both unset: the EC2 instance role. Exactly one set: invalid configuration (startup stops before
binding; the importers exit with a usage error). The choice is made once when the settings are read;
reaching IMDS is not a configuration condition.

R2. IMDSv2. Built-in root `http://169.254.169.254`. One refresh is three requests: `PUT
/latest/api/token` with `X-aws-ec2-metadata-token-ttl-seconds: 21600`; `GET
/latest/meta-data/iam/security-credentials/` (the first line is the role name, 1–64 characters of
`[A-Za-z0-9+=,.@_-]`); `GET /latest/meta-data/iam/security-credentials/<role>` with the token. The
JSON must have `Code` `Success`, non-empty `AccessKeyId`, `SecretAccessKey` and `Token`, and an
`Expiration` later than now + 60 s. Requests use no proxy, no redirect and no retry, 1 s connect and
2 s total timeouts, at most 8 KiB of headers and 16 KiB of body; one refresh takes at most 3 s. The
token is not stored.

R3. Cache and refresh. Credentials expiring more than 5 minutes from now are used without contacting
IMDS. Otherwise one caller refreshes at a time. Callers holding usable credentials (expiring more
than 60 s from now) do not wait for a running refresh. After a failed or cancelled refresh, or a
refresh whose credentials are still inside the 5-minute window (not rotated yet), the next attempt is
at least 10 s later; usable cached credentials are used meanwhile. Without usable credentials the S3 operation fails
before any S3 request is sent (storage `Transport`, or a bounded wait `Timeout`). Every S3 caller
reads credentials through the transport's `RefreshableCredentials`, so raw/catalog stores, budgets,
warnings, world weather/air, the KMA input source, demand state and the importers share this path.
Credential values never appear in Debug output, errors, logs or tool output.

R4. Region. The server2-only `SERVER2_S3_REGION` (default `ap-northeast-2`) selects the regional
endpoint `https://s3.<region>.amazonaws.com/`. `TWA_S3_REGION` is not read.

R5. Test-only builders. `S3Settings::from_vars_with(var, endpoint, metadata)` and
`gateway::runtime::Builtins::instance_metadata` choose another IMDS root: plain HTTP to a loopback
address only, path `/`, no user information, query or fragment. `None` is the built-in root. No
environment variable selects an IMDS root.

R6. Readiness check. The operator example `s3_readiness LABEL` reads the server2 S3 settings (process
environment, then `server2/.env`) and, through server2's real stores and transports: publishes two raw
records and two catalog revisions for source `s10f-live` (conditional create and CAS), creates and
CAS-updates `budgets/v2/s10f-live/LABEL.json` and `state/demand/grid/s10f-live/LABEL.json`, and
requires 404 from HEAD/GET of absent raw/v2 and GET of an absent index/v2 key. It prints the
credential source, statuses and keys, never credential values, and deletes nothing.

R7. Staging records. `prerequisites.json` records the provisioned account, region, bucket, role and
instance-profile ARNs, the bucket settings and the `geocode/address/v1` prefix;
`role-policy.template.json` lists `geocode/address/v1/*` for List/Get/Put, as provisioned.

## Alternatives rejected

- Eager IMDS fetch at startup: an IMDS hiccup at boot would stop the process; AWS SDKs also fetch
  lazily. The first S3 operation fetches instead.
- Background refresh task: needs lifecycle wiring in every process and importer; refresh on use is
  bounded and shared through the existing credential handle.
- A setting that selects the credential source or the IMDS root: AK's rule forbids runtime modes and
  test overrides.
- Reading `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`: server2 keeps the legacy
  names; the role covers the deployed host.

## Verification strategy

Red: on the base, absent keys are a configuration error and the endpoint follows `TWA_S3_REGION`
(`s3_credentials_and_region_follow_s10f`). Green: unit tests of the IMDS client and cache against a
loopback IMDS double (token header, role path, session token, refresh window, failure fallback, retry
spacing, malformed documents), an integration test that writes and reads a raw record through the S3
test peer with instance-role credentials, a gateway built without keys, and the settings rules.
Functional: release smokes unchanged; the live readiness check in `tw-server2-141248341265-apne2`
plus an AWS CLI unconditional-PUT denial and version listing.
