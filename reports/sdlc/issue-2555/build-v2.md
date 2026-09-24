# Build record
Builder: /root (OpenAI), implementation branch working tree based on 87b8855f308611a07897cd3a39c45fefb3088d77. Exact runtime/test file set and digest: candidate.json; actual diff including new tests: changes-v2.txt.

Only runtime file changed: server/lib/collectTownForecast.js. Seven HTTP endpoints, `00`, guarded envelope/status/count/items, strict PCP/SNO/TMP/RN1, safe diagnostics. Added shared nonempty/finite output validation and all-group short/shortest required-field checks. Organizer return status drives getData callback errors. Mid records are cloned independently without JSON erasing NaN before validation; all-missing temperature data fails. All 15 other inventory paths (including config) remain byte-identical to the public baseline, checked by git diff --quiet.

Regression-first evidence: initial suite 10 passing/54 failing before implementation; first green 64 passing. Early independent OpenAI challenge found empty mid output reported as success, unvalidated later groups, success callback after organizer failure, raw-item logging. Nine added tests reproduced these failures (67 passing/9 failing); fixes made 76 passing. Added actual mid success, finite-sea and per-region isolation checks; final suite 82 passing. Final suite replayed against selected baseline modules in /tmp: 17 passing/65 failing, actual exit 65. Final green/post-refactor and separate functional smoke all exit 0.

Documentation: all appendix hunks and full inactive operational profile in docs/architecture/gather-source-reconciliation.md; collector flow text and existing Archify JSON/HTML updated. Consumer algorithms unchanged. Correction to investigation shorthand: the actual legacy quantity-splitting method is controllerTown24h.adjustShort, not a separately named adjustShortR06S06. Its behavior is tested and documented precisely in the final disposition.

Archify deterministic 9/9 and browser checks passed; /root visually inspected light 2048x1320 and dark 1440x900/2048x1320 captures: readable labels, no node/edge obstruction, cards fit, balanced desktop composition. Local capture files remain ignored.

No production config read/import, network tests, DB, app startup, EC2, deployment, merge or #2554 repair. HTTP and provisional periods are intentional limitations. Full legacy dependency installation/suite/mobile builds were not attempted. Additional local integration uses actual XML/requester/storage-controller code and injected external boundaries, not live services.

## Corrective build, iteration 2
Independent final assessment found blank MID_LAND weather text could still pass. Added three regressions (82 pass/3 fail; exit 3), then required all wf* output values to be nonblank strings, including MID_SEA and MID_FORECAST. Final 85-test green/post-refactor and distinct smoke pass (exit 0). See candidate.json for corrected exact file hashes. No operating policy or downstream consumer changes.
