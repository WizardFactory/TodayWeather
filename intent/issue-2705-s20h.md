# S20h native warning binding and combined API verification

AK requested continued S19/S20 verification and deferred the #2724 quota/account lookup. [Issue #2817](https://github.com/WizardFactory/TodayWeather/issues/2817) restores the accepted S12 warning API contract in the shared production router. With native `kma` selected, GET/HEAD `/v000903/kma/special` must reach the existing WarningService. The baseline returns 404 because that delegation is missing.

Reuse the existing service, shared bounded WarningStore and family selector. Add combined native API inventory and durable-state coverage with owned peers. No new runtime setting, provider, storage format or background activation is required. Internal warning construction for push or older KMA versions must not expose an unselected public API.

Acceptance is defined in the [specification](../specs/issue-2705-s20h.md); the exact 12 task paths and outside documentation exceptions are declared in [S20h.json](../server2/config/tasks/S20h.json). Preserve unrelated user changes and actual failed verification attempts.

This increment does not establish fixed-input production parity, whole-process recovery or an eligible previous full release. Quota remains unmeasured. No account S3 probe, live provider request, push send, traffic mirroring, deployment or cutover is authorized. Narrative omission on rollback remains forbidden; rebuilding or relabeling unchanged bytes does not create a distinct recovery release.
