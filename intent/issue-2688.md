# S03: isolated infrastructure and Spot prerequisites

Task issue-2688-s03; owner S03 builder; configuration/implementation route.
Endpoint: reviewed unmerged PR. AK authorized useful parallel implementation after
S01/S04 integration. Scope covers code/tests, commit/push/PR/CI and independent
review through configured OpenAI/Anthropic accounts; no merge, production,
resources, live provider/Mongo calls, sends, secrets or settings changes.

The storage and feasibility tasks need a reproducible safe local peer before
real infrastructure is provisioned. Build a bounded loopback-only test S3 subset,
recorded-provider peer and process launcher, then document an approval-ready
same-region S3/IAM/separate-key/Spot plan. It is not an AWS benchmark or production
S3 adapter; runtime weather routes and the SDK remain later task work.

- AC1: local peers and the release foundation binary start/stop; raw bytes,
  conditional PUT/MD5/metadata and provider fixtures work; unknown endpoints or
  credentials never become outbound requests; cleanup is bounded.
- AC2: prerequisites cover least privilege, versioning, provider quota ownership,
  measured host sizing/musl, drain/rollback and explicit remaining resource approval.
- AC3: every path matches the pre-edit declaration and no new runtime reads legacy.
  Reconcile AK D01–D04 without relaxing weather history, privacy or cutover gates.

Inputs: [parent design](../docs/architecture/server2.md),
[common contract](../plans/issue-2614.md#common-contract-for-every-implementation-task),
[AK directions](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6015980608).
Exact paths are in [S03 declaration](../server2/config/tasks/S03.json) and were
recorded before edits. No additional AK policy blocks local implementation;
account/region/bucket/host/key provisioning remains a future approval boundary.
