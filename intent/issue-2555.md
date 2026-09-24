# Reconcile gather source (#2555)
Owner: /root. Revision 1. Authority: AK requested issue review and PR creation.
Source: https://github.com/WizardFactory/TodayWeather/issues/2555 and its exact public-baseline-to-gather appendix.
Outcome: preserve necessary KMA API compatibility in reviewed source, account for all other observed differences and prove local behavior using synthetic fixtures.
- AC1: all seven migrated HTTP host/path combinations and `00` dispatch; controlled invalid-response failures.
- AC2: safe PCP/SNO/TMP compatibility and zero-preserving RN1 parsing; stable sentinel/schema, grouping and publication fields.
- AC3: preserve newer upstream validation/Kakao/logger/current merge, operational defaults and unrelated runtime choices.
- AC4: isolated synthetic regression plus additional functional smoke, no network/config/Mongo/startup; safe logs.
- AC5: every appendix difference disposition, consumer period limitation, collection Markdown and validated Archify artifacts.
- AC6: commit/push/PR with test results and operator deployment/rollback handoff.
Excluded: EC2, production configuration/backups/credentials, live providers or Mongo, production recovery claims, policy activation, #2554 repair, merge/deploy. Unknown period conversion is separate work; do not guess a formula.
PROCEED within user authority; production parity cannot be established offline.
