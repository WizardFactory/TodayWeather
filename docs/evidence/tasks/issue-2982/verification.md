# Verification: server2 log pipeline LP-5 (#2982)

Selected evidence for [#2982](https://github.com/WizardFactory/TodayWeather/issues/2982), stacked on LP-1 ([#2978](https://github.com/WizardFactory/TodayWeather/issues/2978)). **Nothing was applied to AWS**: no policy, lifecycle configuration or log group was created or changed.

## Sources checked (2026-11-14)

- AWS service reference (`servicereference.us-east-1.amazonaws.com/v1/logs/logs.json`): `CreateLogStream` and `PutLogEvents` authorize on the `log-stream` resource (`…:log-group:${LogGroupName}:log-stream:${LogStreamName}`); `DescribeLogStreams` on `log-group` (`…:log-group:${LogGroupName}`). The template also lists `…:log-group:${LogGroupName}:*` for `DescribeLogStreams`, the form AWS returns as the group ARN.
- [S3 lifecycle examples](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-configuration-examples.html): `Days` and `ExpiredObjectDeleteMarker` cannot share a rule; a separate rule removes expired delete markers.
- LP-1 record: the CloudWatch sink calls `DescribeLogStreams` before writing ([LP-1 evidence](../issue-2978/verification.md)).

## Checks

| Check | Result |
| --- | --- |
| `python3 -I server2/deploy/logging/test_logging.py` | 31 tests OK, including LP-5's 9. The policy check rejects 10 broader variants (extra action, group creation, retention change, wildcard resource, read-back, bucket listing, delete, service wildcard, condition, missing describe). The lifecycle check rejects an empty, weather or weather-parent prefix, a tag filter, and each missing action. The first run caught a real gap: an empty prefix rendered the filter as `/` and passed, so the check now rejects empty or slash-only prefixes. |
| Renderer | Renders three files without placeholders; refuses a prefix inside a weather prefix, a malformed account or group (exit 2, nothing written). Actual capture: manual step 6. |
| `linux_check.py` in the LP-1 disposable VM, allowed actions read from the role template | PASS, 80 checks (report SHA-256 `a8897b5908faa66b8494ca74fe28a9e2e9895c679379b35135484e57e7d99279`). Every delivery scenario used only actions the template grants. |

## Limitations

- IAM evaluation, lifecycle execution and log group retention were not exercised against real AWS; the owner's read-back commands in the guide are the first real check.
- `put-bucket-lifecycle-configuration` replaces the whole configuration; `prerequisites.json` records none today, which the owner must confirm before applying.
