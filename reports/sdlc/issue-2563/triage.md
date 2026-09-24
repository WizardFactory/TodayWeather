# Triage
Issue: https://github.com/WizardFactory/TodayWeather/issues/2563
Base: c9220de35fe31838e10e692494731b90106b0f65. Clean initial worktree.
User authorized dotenv implementation and local uploaded .env placement. Endpoint local; no commit, push, PR, restart or deployment.
Behavior change: bootstrap environment before New Relic/config, keep existing environment priority.
Required: regression, separate config smoke, docs/Archify update, independent local QA.
Excluded: live provider/DB verification, credential substitution, cross-provider PR review.
