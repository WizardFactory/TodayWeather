# EC2 SSH and AWS API access

AK confirmed the following SSH access method on 2026-09-20. Read-only SSH inspection was subsequently authorized and completed; see [service EC2 internals](ec2-internals.md) and [sanitized evidence](ec2-readonly-evidence-2026-09-20.json).

- Host: `ec2-13-124-25-12.ap-northeast-2.compute.amazonaws.com`
- User: `ec2-user`
- Private key: `aleckim.pem`, stored locally at `.aws/aleckim.pem` in each checkout.

## Connect over SSH

From the repository root:

```sh
chmod 400 .aws/aleckim.pem
ssh -i ".aws/aleckim.pem" ec2-user@ec2-13-124-25-12.ap-northeast-2.compute.amazonaws.com
```

When the current directory contains the key, the original command is:

```sh
ssh -i "aleckim.pem" ec2-user@ec2-13-124-25-12.ap-northeast-2.compute.amazonaws.com
```

The supplied key was copied locally to both the working checkout and the base repository at `/root/workspace/TodayWeather`. These copies have mode `0400`, and `/.aws/aleckim.pem` is excluded by each repository's `.gitignore`. The key is not part of the guide or Git history; a fresh clone requires the key to be supplied separately.

The inspection confirmed nginx and ten PM2 cluster workers, observed database-target TCP connections, and recorded the deployed checkout. Selected configuration plus startup metadata resolves service mode and DB version 2.0. The separate gather host and Mongo server internals remain uninspected. The connection command alone is not evidence of those details; use the linked timestamped inspection record.

## AWS CLI access

Verified on **2026-09-22** by executing AWS CLI `sts get-caller-identity`; returned account: `141248341265`. This is the canonical access note shared through repository `AGENTS.md`; `CLAUDE.md` imports that file.

| Setting | Value |
| --- | --- |
| Credential file in a worktree | `<repository-root>/.aws/credentials` |
| Existing base-checkout fallback | `/root/workspace/TodayWeather/.aws/credentials` |
| Named profile | `141248341265` — there is no configured `default` profile in this file |
| Primary region | `ap-northeast-2` |
| CLI executable verified in this environment | `/tmp/tw-aws-correlation-cli/bin/aws` (`aws-cli/1.46.1`) |
| SDK fallback verified during the log investigation | Existing Python `boto3` with the same credential file/profile |

`aws` was absent from PATH and `~/.aws` did not exist in the inspected session. Neither condition meant AWS access was unavailable. The `/tmp` CLI path is an existing temporary installation, not a portable guarantee; check it before reuse. Keep credential contents out of output and version control. Access instructions do not expand the current task's authorization to AWS mutations or application invocations.

### Install a persistent CLI when needed

For supported Linux x86-64 or ARM systems, the [official AWS CLI v2 installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) provides an installer that downloads, verifies and installs the CLI. With default XDG settings it installs under `$HOME/.local/share/aws-cli` and links `$HOME/.local/bin/aws`, so the installed executable survives `/tmp` cleanup. Prerequisites include Bash, curl and the supported Linux runtime described in that guide; use its platform-specific instructions for macOS or Windows.

If no suitable CLI is installed, run:

```sh
(
  set -e
  TW_AWS_INSTALLER="$(mktemp)"
  curl -fsSL https://awscli.amazonaws.com/v2/install.sh -o "$TW_AWS_INSTALLER"
  bash "$TW_AWS_INSTALLER"
)
export PATH="$HOME/.local/bin:$PATH"
aws --version
```

Retain that PATH entry in your shell startup configuration if needed. Custom `XDG_DATA_HOME` / `XDG_BIN_HOME` settings change the install locations; use the installer output and official guide to locate the executable. This recipe was checked against AWS documentation on 2026-09-23 and syntax-checked locally; installation was not executed during this documentation update. The earlier authenticated CLI observations remain specific to v1.46.1.

### Select credentials and executable

Run from any directory inside the checkout:

```sh
TW_REPO_ROOT="$(git rev-parse --show-toplevel)"
export AWS_SHARED_CREDENTIALS_FILE="$TW_REPO_ROOT/.aws/credentials"
if [ ! -f "$AWS_SHARED_CREDENTIALS_FILE" ]; then
  export AWS_SHARED_CREDENTIALS_FILE=/root/workspace/TodayWeather/.aws/credentials
fi
export AWS_PROFILE=141248341265
export AWS_DEFAULT_REGION=ap-northeast-2
export AWS_PAGER=''

TW_AWS_CLI="$(command -v aws || true)"
if [ -z "$TW_AWS_CLI" ] && [ -x "$HOME/.local/bin/aws" ]; then
  TW_AWS_CLI="$HOME/.local/bin/aws"
fi
if [ -z "$TW_AWS_CLI" ] && [ -x /tmp/tw-aws-correlation-cli/bin/aws ]; then
  TW_AWS_CLI=/tmp/tw-aws-correlation-cli/bin/aws
fi
if [ -n "$TW_AWS_CLI" ]; then
  "$TW_AWS_CLI" sts get-caller-identity --query Account --output text
else
  printf '%s\n' 'No CLI found; use the boto3 fallback below.'
fi
```

Confirm account `141248341265` before continuing with account-specific queries. Do not run `aws configure` to overwrite existing credentials. The inspected **v1.46.1** CLI does not support `aws configure list-profiles`; this observation does not describe CLI v2. With boto3 available, inspect profile names through `boto3.Session().available_profiles` instead of printing credential contents.

With the environment above, the SDK fallback is:

```sh
python3 - <<'PY'
import boto3

session = boto3.Session(profile_name='141248341265', region_name='ap-northeast-2')
print(session.client('sts').get_caller_identity()['Account'])
PY
```

## Known log targets

These resource identifiers were used successfully on 2026-09-22; recheck settings and retention when investigating a new time window.

| Target | Identifier / coverage |
| --- | --- |
| CloudFront distribution | `E3QLRH0LJD07QR` |
| CloudFront standard logs | Bucket `tw-cloudfront`; key prefix `tw-cloudfront/E3QLRH0LJD07QR.YYYY-MM-DD` |
| REST API / stage | `5hktkqusyb` / `production` |
| API Gateway execution log group | `API-Gateway-Execution-Logs_5hktkqusyb/production`, region `ap-northeast-2`; observed retention 7 days |

For example, after the CLI setup above:

```sh
"$TW_AWS_CLI" cloudfront get-distribution-config \
  --id E3QLRH0LJD07QR --query 'DistributionConfig.Logging'

"$TW_AWS_CLI" logs describe-log-groups \
  --log-group-name-prefix 'API-Gateway-Execution-Logs_5hktkqusyb/production' \
  --query 'logGroups[].{name:logGroupName,retentionDays:retentionInDays}'
```

CloudFront viewer logs include cache responses and direct EC2 routes. API Gateway logs cover requests that reached that API; do not add the two counts. For a month of viewer requests, use the S3 logs rather than treating seven days of Gateway retention as a month. Fix the exact UTC window, paginate object listings, filter each record by timestamp, and group coordinate/address segments before reporting. The [30-day report](../../reports/aws/api-traffic-2026-09-22.md) records the aggregation and delivery-delay limitations.

## New Paseo workspaces

The repository-root [paseo.json](../../paseo.json) copies `.aws/aleckim.pem` and `.aws/credentials` from `$PASEO_SOURCE_CHECKOUT_PATH` during worktree setup. Keep the source files in the base repository's `.aws/` directory. New copies use modes `0400` and `0600`, respectively, under a `0700` directory. Existing destination files are preserved; absent source files produce a warning and are skipped.

Setup also writes a local `.aws/.gitignore` wildcard, so copied secrets stay ignored even when the chosen base branch lacks the root ignore rules. The configuration contains paths and commands only, never credential values. It does not configure an AWS profile or invoke AWS services.

The installed Paseo 0.7.2 seeds a missing worktree `paseo.json` from the source checkout before setup; this was verified against the installed implementation. A config already present in the target branch takes precedence. For portable behavior across installations, include `paseo.json` in the chosen base branch as described in the [Paseo worktree documentation](https://paseo.sh/docs/worktrees.md).
