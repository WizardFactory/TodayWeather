# EC2 SSH access

AK confirmed the following SSH access method on 2026-09-20. Read-only SSH inspection was subsequently authorized and completed; see [service EC2 internals](ec2-internals.md) and [sanitized evidence](ec2-readonly-evidence-2026-09-20.json).

- Host: `ec2-13-124-25-12.ap-northeast-2.compute.amazonaws.com`
- User: `ec2-user`
- Private key: `aleckim.pem`, stored locally at `.aws/aleckim.pem` in each checkout.

## Connect

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

## New Paseo workspaces

The repository-root [paseo.json](../../paseo.json) copies `.aws/aleckim.pem` and `.aws/credentials` from `$PASEO_SOURCE_CHECKOUT_PATH` during worktree setup. Keep the source files in the base repository's `.aws/` directory. New copies use modes `0400` and `0600`, respectively, under a `0700` directory. Existing destination files are preserved; absent source files produce a warning and are skipped.

Setup also writes a local `.aws/.gitignore` wildcard, so copied secrets stay ignored even when the chosen base branch lacks the root ignore rules. The configuration contains paths and commands only, never credential values. It does not configure an AWS profile or invoke AWS services.

The installed Paseo 0.7.2 seeds a missing worktree `paseo.json` from the source checkout before setup; this was verified against the installed implementation. A config already present in the target branch takes precedence. For portable behavior across installations, include `paseo.json` in the chosen base branch as described in the [Paseo worktree documentation](https://paseo.sh/docs/worktrees.md).
