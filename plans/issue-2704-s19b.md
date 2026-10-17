# S19b implementation plan

Root owns this increment and `.planning/2026-10-13-server2-next-sequence-after-s10`. Canonical intent/spec define RUN/REPORT/SAFE/PLACEMENT. Exact authored paths are S19b.json; outside documentation only. Existing checks, product Rust, shared peers and golden oracles remain unchanged.

1. Add meaningful control tests before the suite: preflight must launch nothing on bad hash/missing artifact; zero/no-op child result fails; a subset states partial coverage; failures remain visible; timeouts stop owned processes; output cannot overwrite a run.
2. Implement fixed11-check catalog, explicit artifact validation, sequential owned execution and per-layer report. CI adds only the tool controls; existing product gates stay intact.
3. Prepare explicit release artifacts under coordinator Cargo lease, with free space+3GiB reserve, reuse target and offline dependencies. Copy required executables to ignored task proof directory and hash before cleanup. No builds inside the suite.
4. Run controls Green/Post and existing shadow regression. Run a separate real integrated suite on actual release examples/test executables, keeping all original assertions. No fixture/runtime timeout loosening if a check fails; preserve outcome, diagnose before bounded repair.
5. Deliver actual command/result capture, editable operator manual/PDF and selected verification evidence; check README/architecture/declaration/links and artifactpolicy. Commit/push only after required local checks.
6. Required independent PR review plus Grok/Gemini optional attempts under current read-only contract, actual CI, reviewed authorized integration and completion. No source/counter resets; S19a history untouched.

Scenarios: ALL (all11checks, everylayer explicit); SELECT (subset succeeds but full_coverage=false/not-run others); PREFLIGHT (missing/mutated/nonrelease prerequisites block before any child); CHILD-FAIL (nonzero, no-op, zero tests, timeout or invalid structured report fails visibly); RETAIN (new-output-only, source/fixture bytes preserved). Mapped machine scenario artifact inreports/sdlc/issue-2704-s19b/user-scenarios.json.

Risk/alternative: reuse existing checks rather than invent parallel product tests. Existing world smoke has frozen legacy coexistence stages, explicitly labeled. Model/state libraries use doubles, notwhole-process recovery. Summarywire differs frommodel. Worker matrix covers currentfactory only, notpreviousrelease. Fullsuite result is bounded integration evidence, not fullS19orS20 completion.

## Bounded fixture repair after first real suite

Exacttwoadditionalserver2paths declaredbeforeedits: tools/world_smoke.py and examples/conditional_alert_smoke.rs. Diagnoseconditionalclass withoriginalaccepted assertion intact; correctsyntheticinput onlyonactualclass evidence. Giveworldsmoke currentnativegeocoder synthetickeys/ownedroots andrecordedresponse, preserveeveryoriginalnative/rollback assertion. Rebuild onlychangedexample underlease, retainoldartifact/hash/failure, updateexplicitmanifest. Renew13controls, native-recovery10controls,31shadow, affectedrealchecks thenfullsuite. Existing9passingcases remainhistoricalfirst-run evidence, notrelabeled fullPASS.
