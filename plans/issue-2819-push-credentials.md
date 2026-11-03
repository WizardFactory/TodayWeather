# C6 execution plan

[Spec](../specs/issue-2819-push-credentials.md), exact task paths in `server2/config/tasks/PushCredentials2819.json`. Existing root-owned primary execution notebook remains canonical. Endpoint pre-merge; C5 ba56 is an unmerged dependency and its current CI remains mandatory.

1. Freeze intent/spec and checked-constructor design before edits.
2. Add a factory regression with missing active credentials to unchanged runtime. Clean up any accepted baseline writer before the intended assertion; retain source/binary/log/exit.
3. Implement checked account preload before shared S3/writer, retain lazy low-level FCM API. Extract only the shared synthetic public account fixture and supply owned account paths to runtime tests.
4. Exercise required config cases, disabled-push settings not queried, cached local account, actual child startup rejection and valid bind/TERM. Additional standalone Python CLI uses a retained exact runtime test executable with own peer, accounts and process logs; no dotenv or live endpoint.
5. Run affected full runtime_services and delivery targets, fmt-check, all-target clippy and optimized build. Renew source/binary maps, placement/dependency/artifact/link checks. Preserve first failures; do not broaden or repeat without evidence.
6. Update architecture/operator/evidence and diagram source lines; regenerate only if relevant source/meaning changed. Current independent required review, selected corrections and exact CI precede readiness. No merge.

Scenarios: operator rejects invalid active credentials before state work (PC1/3); active TW without retired TA starts and drains cleanly, configured invalid TA fails (PC1/2/3); HTTP-only startup reads no Firebase variables (PC2); one parsed account survives local file removal without claiming remote authorization (PC2); reviewer receives exact declared candidate/current tests and inherited CI gaps before premerge (PC4). Detailed scenario IDs/actions are in the ignored task record supplied to reviewers. This bug fix changes no public UI/new feature; maintain existing operator manual, no unrelated screenshot PDF scope.
