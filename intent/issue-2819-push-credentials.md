# Validate push accounts before startup (C6)

Continue [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819) before seven-day shadow. A push-enabled process must reject missing, unreadable or malformed active TodayWeather credentials before registration restore/writer, listener binding or jobs. Validate any configured retired TodayAir account; an absent TodayAir account does not block active TodayWeather. TodayAir retirement is AK's existing product decision, not a new exclusion.

Parse/cache local service accounts without OAuth/FCM requests. Preserve lazy low-level FCM construction, per-send outcomes, final admission, one-shot claims and no retries. Disabled push reads no account settings/files. Local parse cannot prove remote project authorization, revoked-key status or subsequent filesystem accessibility.

Endpoint: pre-merge only. Parent is unmerged C5 PR2829 ba56cd84, independently reviewed with exact CI pending. No merge/cloud mutation/deployment, real provider/device calls, global issue closure or full eligible recovery claim. Root owns the existing primary-worktree execution notebook. Exact intended paths and documentation exceptions are declared in `server2/config/tasks/PushCredentials2819.json` before edits.
