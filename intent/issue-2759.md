Task: issue-2759-s10f; owner: Claude builder (S10f worktree); base: origin/master 0997d702; date: 2026-10-15.
Authority: AK decisions of 2026-10-15 relayed by the root coordinator: server2 gets its own Seoul S3
bucket with Versioning and an EC2 IAM role instead of static keys; the root created the bucket
`tw-server2-141248341265-apne2` and the role/instance profile `tw-server2-runtime` (not attached to an
instance yet). Live verification is authorized inside that bucket only (read/write, no delete).
Endpoint pre-merge (no merge, auto-merge or queue).
Criteria: AC1 (instance-role credentials), AC2 (server2 region), AC3 (repository matches the
provisioned AWS resources), AC4 (live bucket check), AC5 (tests, smokes, placement, artifact policy,
documents).
Issue update assessment: path declaration posted before implementation; one concise status at readiness.

# Intent

server2 reads only the legacy `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` for S3. In the operator's
`server/.env` and its copy `server2/.env` both hold the legacy `config.js` placeholder
`You have to set key of AWS`, so server2 cannot reach S3. AK decided that server2 uses an EC2 instance
role. server2 also reads the legacy `TWA_S3_REGION`, which is `us-east-1` for the unrelated 2018
bucket `twa-weather-data`; the server2 bucket is in `ap-northeast-2`.

- AC1: with both keys absent, empty or the placeholder, every S3 caller signs with instance-role
  credentials from IMDSv2 (token PUT, role name, credentials JSON with session token), cached and
  refreshed before expiry; an unexpired cached credential survives a failed refresh. Real static keys
  still work. One real key without the other is a configuration error. Credentials are never logged.
  The IMDS endpoint is built in; tests reach a loopback double only through a test-only builder.
- AC2: the S3 region is the server2-only `SERVER2_S3_REGION` (default `ap-northeast-2`);
  `TWA_S3_REGION` is not read.
- AC3: `server2/deploy/staging/prerequisites.json` and `role-policy.template.json` match the
  provisioned bucket, role, instance profile and policy prefixes (including `geocode/address/v1/*`).
- AC4: live in the new bucket with operator credentials (values never printed), server2's real stores
  create raw/v2 conditionally, publish an index/v2 catalog with retained versions, write budgets/v2 and
  state/demand/grid objects, and see 404 for known-absent raw/v2 and index/v2 keys; an unconditional
  raw/v2 PUT is denied. Written keys are reported; nothing is deleted.
- AC5: workspace tests, clippy, release smokes, the placement gate and the artifact policy pass;
  `docs/architecture/server2.md` and the affected operations guides and PDFs describe the settings.

In scope: server2 S3 credential and region settings, the IMDSv2 client, the test-only builder, an
operator readiness check, staging records, documentation and PDFs, the live bucket check,
commit/push, PR, CI and Codex review.

Out of scope: attaching the role to an instance, IAM or bucket policy changes, deleting objects,
production deployment, cutover, merge, printing or committing credential values, edits to
`plans/issue-2614.md`.

Risks: the real IMDS path runs only on EC2 (checked at deployment); the live check uses the operator
IAM user, not the runtime role, so role-specific 404/403 semantics remain a deployment check;
S15b-3c edits server2 in parallel.
