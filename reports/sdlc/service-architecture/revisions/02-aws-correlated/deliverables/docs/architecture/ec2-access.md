# EC2 SSH access

AK confirmed the following SSH access method on 2026-09-20. This records user-provided access information; no SSH connection or host inspection was performed for this documentation update.

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

SSH access does not establish the deployed revision, process manager, `SERVER_MODE`, `DB_DATA_VERSION`, database endpoint or collector configuration. Those runtime details remain unverified.
