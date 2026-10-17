# Execution plan: weather response narratives (#2798)

Owner: Codex /root. Consumes amended intent/spec. Same task/PR, pre-merge endpoint; prior special-screen evidence is historical. No merge/deployment/client changes.

1. Confirm official national/regional station list and existing shared nation/KMA response boundaries. Update issues2798/2803 and preserve the old review/findings history.
2. Design isolated station/publication storage, coalesced background collection, province aliases and bounded optional weather-response reads. Keep warning state and types1–4 unchanged. The conceptual Archify design is validated; regenerate the maintained source-backed diagram after the implementation commit.
3. Add expected-behavior tests and run intended Red. Implement collector/reader/response additions, remove special response integration, and adjust legacy Node10 compatibility checks. Run focused Green plus warning/key/affected weather regressions; post-refactor rerun.
4. Run separate real loopback provider → Mongo → existing mounted weather/nation/special HTTP integration. Cover national and all regional offices, address/coordinate selection, expiry, absent data/read failures, unchanged weather/warnings and no new route. No production keys/network.
5. Update architecture/mobile API/runbook/manual and PDF/captures with actual synthetic HTTP results and honest runtime limits. Reconcile paths/dependencies, staged/outgoing artifact checks, commit and push existing PR. Renew independent required review with stable R3-001/R3-002 history and optional review availability records, then final current-head CI and pre-merge handoff.

SC1: nationwide user requests KR nation weather after a scheduled batch. National root gets station108 and complete publication/text metadata; representative-city weather/air remain intact without duplicate regional narrative fields. Expired/missing national data removes only the extension. AC1/AC2/AC3: station collection tests and real nation HTTP smoke.
SC2: domestic user requests weather by address or resolved coordinates. Seoul/Incheon/Gyeonggi get109; all other provinces and renamed-province aliases select their official office. Unknown/foreign regions never receive guessed prose. Existing fields/units remain intact. AC1/AC2/AC3: complete mapping tests and address/coordinate HTTP smoke.
SC3: provider/DB failure, repeated/new/concurrent publications or exact24h boundary. Bounded key rotation terminates, one office failure does not block others, immutable station/publication rows remain, optional2s reads suppress late mutation, and warnings/push are unchanged. AC1/AC2/AC3: regressions and separate persistence/HTTP smoke.

Risks: no regional provider access has been live-proven, provider text is untrusted, old ODM and production overlays differ. Collection/readback rollout stays separately approved; keep2798open. Preserve prior stage counters and test/review records under ignored reports; no Rust builds or build-cache cleanup.
