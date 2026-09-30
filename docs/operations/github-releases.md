# Target-specific GitHub Releases

Issue: [#2653](https://github.com/WizardFactory/TodayWeather/issues/2653). A published Release records an approved source/build; it does **not** establish a production rollout. One Release has one full source commit and one explicit delivery scope. If the same commit ships multiple targets, create separate Releases and link them. Changed paths help CI selection only; they never authorize or select a deployment target.

| Delivery scope | Tag and Release title | Artifact identity | Execution and approval |
| --- | --- | --- | --- |
| Backend service | `backend/tw-svc/vMAJOR.MINOR.PATCH` | Full SHA, host/config inventory, package/dependency identity, PM2/env backup | Explicit operator-approved Hermes rollout; no production Actions yet |
| Backend gather | `backend/tw-gather/vMAJOR.MINOR.PATCH` | Full SHA, gather config/grid inventory and dependency identity | Separate host approval and collector/coverage verification |
| Cordova Android | `cordova/android/vMAJOR.MINOR.PATCH` | Full SHA, app ID, versionCode, toolchain/plugin lock, AAB checksum; signing identity reference only | CI build ≠ signed build ≠ submission ≠ store publication; separate signing/store approval |
| Cordova iOS | `cordova/ios/vMAJOR.MINOR.PATCH` | Full SHA, bundle ID, build number, toolchain/plugin lock, IPA checksum; signing reference only | Same separation, including App Store review and publication |
| Static webapp | `webapp/vMAJOR.MINOR.PATCH` | Full SHA, successful master-push build run ID, artifact ID and SHA256 archive digest | Manual guarded workflow and `webapp-production` environment approval |

Use immutable tags at exact commits, including peeled annotated tags. Never reuse a tag/version for different bytes. Do not infer the tag commit from the Release's `target_commitish` (which may name a moving branch). Superseded/failed Releases retain their evidence. Backend has one host per Release; a coordinated two-host rollout uses two linked Releases and a parent operator change record. TodayAir is retired; these conventions do not authorize reviving it.

## Release-note template

Use this template for all targets, with a scope-specific identity section. Update rollout status with a dated evidence reference; preserve previous attempts. Keep account/resource IDs, secrets and private backups in the operator inventory, not public notes.

```text
Source commit: <full 40-character SHA matching the peeled tag>
Delivery scope: <webapp | backend/tw-svc | backend/tw-gather | cordova/android | cordova/ios>
Changes: <user impact, fixes, compatibility/config migration>
Artifact: <build run URL, immutable artifact ID/checksum and target-specific identity>
Publication: published <UTC time>; this is not deployment completion
Rollout status: pending | deployed | failed | rolled-back
Operator/approval: <owner and environment/approval run reference>
Verification: <preflight, exact deployed SHA, smoke, warnings and evidence URL>
Rollback: <known-good source/artifact or opaque private snapshot reference, procedure>
Attempts: <UTC time, run URL, result, reconciliation and rollback result>
Cordova only: build status / signing status / submission status / store publication status
```

Webapp notes additionally contain exactly one machine-readable block (replace every example value with verified values). The guard requires the same upstream build run/artifact, unexpired artifact and matching digest. `rollbackReference` is an opaque change-record key; that private record maps it to each workflow snapshot ID and previous artifact/configuration.

```release-manifest
{
  "schemaVersion": 1,
  "target": "webapp",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "buildRunId": 123456,
  "artifactId": 234567,
  "artifactDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "rollbackReference": "webapp-change-20260930-01"
}
```

Read run/artifact metadata from GitHub Actions, never guess IDs/digest. A PR artifact is a temporary merge build, and main/manual runs are not accepted. An expired artifact cannot be rebuilt under the old identity; produce a new approved master-push candidate and Release. Preserve deployed artifacts beyond Actions' 90-day retention in approved durable private storage before expiry. Publishing a Release, editing these notes and enabling this workflow are separate operator actions; this implementation creates none of them.

## Trigger and permission boundaries

- **Web build:** existing [Web app](../../.github/workflows/web.yml) PR/push/manual verification, `contents: read`, no AWS credential or production write. The existing artifact name alone is not provenance.
- **Web production:** [Webapp guarded release](../../.github/workflows/web-release.yml) manual `workflow_dispatch` on upstream master, with the explicit Release tag. No `release`, tag push or `workflow_run` deploy. `contents: read` and `actions: read` validate Release/environment/run/artifact; only the protected deploy job gets `id-token: write`. No Release-body write permission. Workflow-level production concurrency never cancels an active upload, though GitHub can replace older pending runs; no queued run is a promise of execution.
- **Backend future:** separately named/manual host-specific workflows and environments, explicit source and host inputs, separate scoped roles and operator approval. No SSH/AWS credentials in build jobs. IAM permissions for AMI/Spot/EIP replacement must be separate from code rollout and bounded to approved resources. See [backend decision](backend-release-automation-decision.md).
- **Cordova future:** unsigned CI artifacts carry platform/version/toolchain/checksum; signing and store submission/publication have separate protected jobs, secrets and minimal store permissions. Publishing a GitHub Release does not submit or publish an app. No signing/store workflow is introduced here; coordinate with [#2605](https://github.com/WizardFactory/TodayWeather/issues/2605).

## Operator activation (separate approval required)

The workflow is dormant until the operator creates/configures the following. No repository settings, credentials or IAM are changed by this PR.

1. Configure `webapp-production` with at least one required reviewer, **prevent self-review**, **disable administrator bypass**, selected deployment branches containing only the branch `master` (no tags/globs). Both guard jobs query these settings and fail closed if absent/unreadable/unprotected. GitHub enforces approval before the deploy job starts. An environment name by itself does not enforce approval. Confirm the repository plan supports these protections and that the workflow token can read environment metadata; an API denial is a stop, not permission to weaken protection.
2. Complete the static runbook's existing-hosting preflight, including DNS pointing to the selected distribution and an operator-controlled write-free rollout window. Save a dated private inventory and its opaque `WEB_PREFLIGHT_REFERENCE`. Guard checks validate the origin/function/CSP, cache policy and certificate; DNS and control of other writers remain operator checks. Do not automate an infrastructure fix as part of an artifact upload.
3. Set environment variables `WEB_BUCKET`, `WEB_DISTRIBUTION`, `WEB_BACKUP_BUCKET` (a different **private, versioned** bucket), `WEB_AWS_ACCOUNT`, `WEB_AWS_REGION`, `WEB_DEPLOY_ROLE_ARN`, `WEB_PREFLIGHT_REFERENCE`. Set repository variable `WEB_RELEASE_ENABLED=true` only after the activation review. Keep actual identifiers in the private inventory.
4. Configure short-lived AWS OIDC: audience `sts.amazonaws.com`, exact subject `repo:WizardFactory/TodayWeather:environment:webapp-production`. Because the environment replaces the branch in the subject, its master-only policy is essential. Limit role assumption/session duration; no wildcard repository/subject and no long-lived AWS secrets. Review all repository workflows that could reference this environment. Restrict changes to release code/workflows with existing repository review controls.
5. Review least privilege against the exact resources below, test denied backend/store/infrastructure/deletion operations in an isolated policy evaluation, and verify an approved staging run before any production dispatch. Do not claim this local PR proves AWS IAM or GitHub approval runtime enforcement.

| Role operation | Scope |
| --- | --- |
| STS identity | `sts:GetCallerIdentity` (identity read) |
| Production S3 reads | `s3:GetBucketVersioning`, `s3:ListBucket`, `s3:ListBucketVersions` on selected bucket; `s3:GetObject` / `s3:GetObjectVersion` only its objects |
| Production S3 writes | `s3:PutObject` only app shell keys (`index.html`, `sw.js`, `release.json`, `theme.js`, `manifest.webmanifest`, `icon.svg`) and `assets/*`, `icons/*`; no deletion |
| Backup S3 | Bucket versioning/public-access-block and prefix-scoped list reads; `s3:PutObject` only `webapp-rollbacks/*`, with conditional creation/checksums; no delete or overwrite permission. Require TLS and approved encryption; configure lifecycle/retention separately |
| CloudFront reads | Distribution configuration, cache/response policies and associated LIVE function only |
| CloudFront write | `cloudfront:CreateInvalidation` on the exact distribution; `cloudfront:GetInvalidation` to wait |
| ACM read | `acm:DescribeCertificate` on the selected us-east-1 certificate |

Constrain actions/resource ARNs wherever the AWS action supports it; policy reads that require `Resource: "*"` grant only the named read action. SSE-KMS buckets additionally need approved scoped KMS decrypt/encrypt/data-key permissions; do not expand to account-wide KMS. No EC2, PM2/SSH, CloudFormation, Route 53 write, IAM mutation, certificate mutation, S3 bucket/policy mutation or store access. Enforce backup conditional writes at bucket policy level; `PutObject` alone permits overwrites by other clients.

## Execution, evidence and rollback

The workflow checks Release/tag/run/artifact/environment before approval, downloads the exact artifact and fails on archive checksum mismatch (not a download-action warning), compares its `release.json` SHA, and rechecks Release identity after approval. It uses scripts from the workflow's trusted master commit; no code from the Release commit/archive is executed. A changed manifest/Release ID invalidates approval selection; dispatch again and approve the new candidate. Operator protection of tags/notes and a write-free window still matter: API reads cannot make mutable GitHub state transactional.

After scoped OIDC, all preflight/backup steps must succeed before the first production object write. The private snapshot is `webapp-rollbacks/<run-id>-<attempt>/` in the private backup bucket; `snapshot.json` is written **last** and contains original key inventory, original per-key headers/metadata/version IDs, byte checksums, original distribution config/ETag and the operator preflight reference. Byte objects are numbered (`objects/0`, etc.), so arbitrary live keys never become filesystem paths. The backup bucket must be private and versioned; checksummed conditional puts prevent this run overwriting a snapshot. Inventory, metadata and distribution ETag are reread to catch concurrent drift. An incomplete prefix without `snapshot.json` is not a rollback snapshot. This tool rejects empty, >10,000-object or >500 MB inventories; use a separately reviewed operator procedure for larger sites.

The uploader preserves old hashed chunks and waits for its **exact** returned invalidation ID. Live smoke pins the full source SHA and checks live `release.json`, browser hosting, API/rendering, worker installation/update/offline behavior. Upstream failures still fail the rollout; warnings are retained and need operator assessment. A successful upload alone leaves rollout pending. Only completed smoke yields a `deployed` sanitized receipt; any job failure produces `failed`, cancellation produces `pending` when the finalizer can run. Cancellation, runner loss, missing receipt or replaced pending runs always need reconciliation—GitHub job status is not proof of the live site's state.

`webapp-rollout-<run-id>-<attempt>` retains sanitized rollout/upload receipts and smoke evidence for 90 days. Private snapshots are never uploaded as Actions artifacts. Copy the run/evidence reference and status into the Release notes/change record after reconciliation. The workflow deliberately has no `contents: write`; notes cannot silently claim deployment. Keep evidence and backup beyond artifact expiry according to the operator retention policy.

There is **no automatic rollback**. Stop concurrent writers and obtain rollback approval. Follow [static release rollback](../../infra/web/static/README.md#release-identity-and-rollback): prefer the complete known-good artifact; alternatively download the private snapshot, verify all checksums, map each `checksums[key].object` back to the original key, and restore bytes with original headers/user metadata from `metadata[key]`. Never infer headers or use bucket-wide `sync --delete`. Restore configuration only when it drifted, with a fresh ETag and separate configuration-change approval. Remove only reviewed release-added shell keys when necessary; preserve old hashed assets. For the first-release placeholder, follow the full recovery-worker procedure and confirm `release.json` absence when absent in the snapshot. Check invalidation, exact live identity and both returning/fresh browser behavior before marking `rolled-back`. Link the failed attempt and restoration evidence; never erase the failure.

[Workflow diagram](diagrams/webapp-release.html) · [Archify source](diagrams/webapp-release.workflow.json).

References: [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [artifact identity API](https://docs.github.com/en/rest/actions/artifacts), [AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).
