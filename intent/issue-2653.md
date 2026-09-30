# Intent: target-specific releases (#2653)
Source: https://github.com/WizardFactory/TodayWeather/issues/2653.
Authority: AK requested “pre-merge까지 진행” on 2026-09-30. Implement, test/smoke, commit, push task branch, create/update PR, observe CI and perform independent review/corrections through existing GitHub account ak-ongyeol and configured Claude/Paseo execution. Transfer only scoped code/tests/evidence. Merge, auto-merge, queue enrollment, production execution, repository/environment/IAM/credential changes and Cordova/backend rollout are excluded.

Problem: publication does not establish deployment; shared tags can ambiguously target this monorepo.
Outcome: one source commit and explicit delivery scope per release, auditable rollout evidence, a guarded manual static workflow, and an explicit backend automation decision.

- AC1: convention/template bind a full commit to one target, backend host or Cordova platform included; publication and pending/deployed/failed/rolled-back are separate.
- AC2: static deployment selects a successful master-push web artifact, checks tag/manifest/run/artifact/release.json identity, blocks credentials/writes without protected environment approval, backs up before upload, waits for invalidation, checks live commit/smoke, preserves rollback/evidence.
- AC3: retain Hermes-assisted backend execution until deterministic host/freshness/grid/AMI/Spot/EIP checks and rollback are executable and verified; list follow-up prerequisites. Cordova signing/store publishing belongs to #2605.

Risks: mutable release notes/tag, expired artifacts, drift, partial upload/cancellation, lost rollback, missing external guide. Fail closed on identity/configuration gaps; never claim a live deployment from local simulation. Operator enables/configures the workflow separately.
