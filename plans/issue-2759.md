# S10f plan: S3 credentials from the EC2 instance role and a server2 S3 region

Source: [intent](../intent/issue-2759.md), [spec](../specs/issue-2759.md), issue #2759, parent #2614.
Declaration: [server2/config/tasks/S10f.json](../server2/config/tasks/S10f.json).

## User scenarios

1. Operator runs server2 on the EC2 host with the role attached. Prerequisites: `server2/.env` is the
   legacy copy (placeholder AWS keys) plus `SERVER2_S3_BUCKET` and `SERVER2_S3_REGION`; the instance
   profile `tw-server2-runtime` is attached. Actions: start `server2` from `server2/`. Expected: the
   first S3 operation fetches role credentials through IMDSv2 and signs with the session token;
   credentials refresh before expiry. Failure path: no role or IMDS unreachable: S3 operations fail
   without contacting S3 and are retried no more than every 10 s; no credential is printed.
   Coverage: AC1; IMDS double unit tests, `instance_role_credentials_write_and_read_a_raw_record`,
   `gateway_without_keys_uses_the_instance_role`.
2. Operator keeps real static keys (another host). Expected: static signing as before; IMDS is never
   contacted. Failure path: one real key without the other stops startup before binding.
   Coverage: AC1; settings rules test.
3. Operator sets the bucket region. Expected: `SERVER2_S3_REGION` selects the endpoint; the legacy
   `TWA_S3_REGION=us-east-1` in the copied file is ignored. Coverage: AC2;
   `s3_credentials_and_region_follow_s10f`.
4. Operator runs the readiness check before cutover (here with operator user credentials; on EC2 with
   the role). Actions: `cargo run --release --example s3_readiness -- LABEL` from `server2/`.
   Expected: conditional raw create, catalog CAS with retained versions, budget and demand writes,
   404 for absent raw/index keys; keys and statuses printed. Failure path: any other status exits
   non-zero with the step name. Coverage: AC4; live run and AWS CLI denial/version checks.
5. Developer runs tests and smokes. Expected: no test reaches 169.254.169.254; IMDS doubles are
   loopback and reached only through the test-only builder. Coverage: AC5.

## Steps

1. Issue, declaration comment, these records.
2. Red test on the base; implementation (`storage/credentials.rs`, settings, transport handle,
   `Builtins::instance_metadata`, importers' usage text).
3. Tests (IMDS double, S3 peer integration, gateway, settings) and the readiness example.
4. Live bucket check with operator credentials passed as `AWS_ACCESS_KEY` / `AWS_SECRET_KEY`;
   AWS CLI unconditional PUT (expect 403) and version listing; sanitized evidence JSON.
5. Staging records, `.env.example`, `gateway-local.json`, README, `server2.md` S10f section, gateway
   and infrastructure guides with regenerated PDFs.
6. Merge origin/master, full checks, PR, CI, Codex review until PASS; merge-ready report.

## Archify

Excluded: the change replaces how S3 credentials and the region are obtained; no route, collector,
response or storage-layout flow changes, and no Archify JSON lists S3 credential settings.
