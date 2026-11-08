# Acceptance for the restart CPU work

- **DNS:** a test resolver double shows lookups do not use spawn_blocking (or the blocking pool stays free while lookups are pending); real hosts resolve in the release build (CI smoke). Checked by `dns::tests::a_lookup_does_not_wait_for_the_blocking_pool` (a request to `localhost` is answered while the only blocking thread is held), `dns::tests::every_http_client_starts_from_the_async_resolver` (no other reqwest client construction in `src/`) and `dns::tests::the_resolver_answers_ipv4_first` (`src/dns.rs`).
- **DISK-CACHE:** with the cache thread held, request paths that read or write the disk cache do not wait on the blocking pool; a held cache write never delays an answer; writes dropped while busy are counted; the cross-process lock test still passes.
- **MEASURE:** EC2 restart comparison with the CI binary of this PR: first answers judged against the same process's answer 5 s later and against production; latency per request recorded; report states whether a restore CPU admission is still needed.
- **DOCUMENTS:** threads and cache path documented.
- **PLACEMENT:** the placement gate passes against `server2/config/tasks/KMA-RESTART-CPU.json` (base `origin/feat/2614-kma-restart-race`), and the artifact policy passes on outgoing commits.
