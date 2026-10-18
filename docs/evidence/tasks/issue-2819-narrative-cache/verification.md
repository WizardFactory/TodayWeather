# Narrative cache recovery: selected evidence

Scope: error versus confirmed absence in [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819), stacked on D1 `d35ca94535078383bb03cb79eb818d44b1fd6362`; no main integration or global qualification.

The before-fix public Service test had two intended failures: typed read error and actual short deadline both cached absence, leaving indexcalls1 instead of3 on next demand. The confirmed-absence/office/30s control passed on the parent. After retaining Result until error handling, all three controls pass. Typed Timeout/Transport/Corrupt/Capacity are exercised in the same failure matrix; no independent Red is claimed for every branch. No stale-on-error policy, new acquisition owner, timer, mode or provider call.

Five clean Rust target processes: **168passed/1ignored** (lib101,narrative8,runtime31/1ignored,nation13,legacy_versions15); the three new tests are counted once in narrative8. Fmt and all-target clippy `-D warnings` exited0. The known whole-domestic167/1/2 failure belongs to the D1parent's preserved run and was not rerun here. Its test/backend/D1source are not changed; D2/rootcause/capacity and cutover/shadow gates remain open. No whole-domestic PASS is claimed.

Additional actual owned S3 CLI: real Store publishes synthetic current-KST-day prose, Service has one injected slow index access before any S3 delegate, and the first20ms request omits. Observed first duration23ms is not real S3/network latency. Immediate next request recovers exact published narrative from the S3 peer; third cached read adds zero index calls. Total index wrapper entries after recovery3, including the first injected one. The Python peer was stopped/reaped before PASS; provider Source.fetch is forbidden.

Report SHA-256 `bbc8b555e56241507ecbf213a682a9d4f19a0fcb242591f90e9dea52dbef9dc2`; retained dev executable `179d8a338686393fe1c49a58302bc1c39777fbce452f93796bac0c4f33302429`. The190-file runtime/source/data/example/peer/manifest map was recorded before execution and matches afterwards. No embedded revision, portable executable, host/IAM, actual provider/key/quota, always-present field, production or whole-bundle rollback proof is claimed.

[Proposed flow](../../../architecture/diagrams/server2-narrative-cache.html), [editable source](../../../architecture/diagrams/server2-narrative-cache.sequence.json): artifact/provenance/browser PASS; actual light1440/dark2048main viewports inspected. Offscreen cards source-only. Diagram cites committed D1parent as interface context, not implementation/execution proof. No UI/PDF relabel.

Ignored detail: `reports/sdlc/issue-2819-narrative-cache/`. Independent review, exact CI and later base reconciliation remain separate. Nation's discarded child reads and all other issue items remain open. No merge/deployment authority; #2819/#2704/#2705 remain open.
