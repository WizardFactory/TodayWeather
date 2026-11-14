# Spec: server2 log pipeline LP-5 (#2982)

Source: [intent](../intent/issue-2982.md), #2982 body, LP-1 feasibility record (the CloudWatch sink calls `DescribeLogStreams`).

- **AC1 Role policy.** The template grants exactly `s3:PutObject` on `<bucket>/<prefix>/*`, `logs:CreateLogStream` and `logs:PutLogEvents` on the group's streams, and `logs:DescribeLogStreams` on the group; a test fails on any other action, resource, effect or condition.
- **AC2 Lifecycle.** Rules are limited to `<prefix>/`; a test fails when the filter is empty, slash-only, a tag filter, or overlaps any of the eight weather prefixes of the staging role policy, and when current-version (90 days), noncurrent-version, expired-delete-marker or multipart handling is missing.
- **AC3 Collector actions.** Against the stand-ins, the LP-1 collector uses no action outside the role template (the integration check reads the template).
- **AC4 Recorded values.** The guide records CloudWatch 30 days and S3 90 days; `prerequisites.json` marks the log resources as not provisioned; the log group template sets 30 days.
- **AC5 Documentation and placement.** Operator apply/read-back steps; links resolve; placement passes.
