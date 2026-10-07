# S06 execution plan

Owner /root/s05_raw_records, 2026-10-07; base4864c9368e78061fbc65b57ac0abaaa3b9408eff. Consumed [intent](../intent/issue-2691.md), [spec](../specs/issue-2691.md), validated [publication sequence](../docs/architecture/diagrams/server2-catalog-publication.html) and root design handoff with all six hashes verified. Named execution plan `.planning/2026-10-07-issue-2691-s06`; canonical task state is ignored reports/sdlc/issue-2691-s06/artifacts.json. Exact files are declared in server2/config/tasks/S06.json and public issuecomment6031233006.

## User scenarios

| ID | User / goal | Prerequisites and ordered actions | Expected / failure | AC / tests / manual |
| --- | --- | --- | --- | --- |
| SC1 | Resolver: cold complete acquisition | Loopback peer/providersdisabled; prepare orderedgroup, publish, freshstorelookup | Complete pages and pinned siblings; partialnew excluded | AC1/3 model+wire; manual Cold read |
| SC2 | Operations: orphan recovery | Candidateperiods/oldhealthy catalog; interruptA, lookup, repairallpages, freshlookup | Everyrevision complete; corrupt/missing neverempty | AC1/2 wire; manual Repair |
| SC3 | Writers: CAS union | Barrier twoETagreads; concurrentpublish, forceconflict, coldlookup | Both revisions and deterministicfold; conflictbounded | AC1/3 wire; manual Concurrent writes |
| SC4 | Admission caller: scopedabsence | Explicitfiniteperiods; emptyclean repair then truncated/invalid/cap repair | CompleteEmpty onlyclean fullscope; incomplete nevermiss | AC2/3 wire; manual Coverage |
| SC5 | Operator: unknown/cancellation | ScriptedHTTP; commit/drop,reconcile,cancelA,direct403 | Exactunion orAmbiguous; no partial/extra retry | AC3 wire+release; manual Failures |
| SC6 | Maintainer: premergeverification | Declaredpaths; checks+distinctreleasesmoke, manualPDFcapture, actualClaude | Exactcandidate ready onlyifallpass, no merge | AC4 checks/manual/review |

## Ordered work

1. Root validated meaningful diagram consumed before runtime. Freeze canonical model and test plan. Root alone edits shared docs/diagrams/parent plan; builder owns all task runtime/tests/manual/state.
2. Test-first public model/page/canonical/digest/merge assertions. Record intended Red against absent implementation, then implement model to Green.
3. Extend transport with bounded JSON/opaqueETag conditional CAS and required IsTruncated XML parsing using direct instant-xml0.7.6 already in lock. Reuse current signed credentials/no retries; preserve S05 code/behavior.
4. Implement bounded group publisher, pinnedreader, allpage healthy/missing repair and memory-only deterministicfold. ActualHTTP regression peer under server2/tests/storage/catalog_peer.py is public/reusable with no production/live relay. Force conflict/partial/unknown boundaries, Green then refactor with tests green.
5. Distinct release catalogs_smoke against public peer, no providers; report cold/repair/failure outcomes. All startedtasks/peerlisteners cleanup and bounded waits. Full workspace(fmt/clippy/tests/release), placement, localpeer/goldens appropriate and staged/outgoing artifactpolicy. Existing S05 regressions remain automaticworkspace tests; no sharedCI edits needed.
6. Operator Markdown/PDF actual usage screenshot+hashmanifest. Root design final hashes remain; no manual generatedHTML edits. Clean maintained links/trackedpaths before finalchecks.
7. One task/branch/PR; preserve every run/counter. Push exactpubliccandidate+filemap then root actual independentClaude review; corrections use renewed stages without resetting max10. Final premerge readiness readback; no merge/queue/automerge/issueclosure.

Riskiest boundary is catalog A published while B looks healthyold. Proof requires descriptor expectedmembership, pinnedfullsiblings and exactraw ref agreement, plus actualwire interruption. Rejected approach: trusting onecatalog/storedcompletebit or healthycatalog absence; those can mix unseen groups/droporphans. Catalogs retain allrevisions; no normalizeddata/pruning/localdisk store. CASgenerationoverflow andcaps failclosed. Callerfinitecoverage and immutableone-groupaffiliation documented as limitations.

No production migration/cutover in S06. Rollback retains legacyrouting and oldcompletesets; new incompletegroups stay archived forrepair. Scope doesn't promise legacyretirement/coldcell parity. No new AK decisions needed. S07 cache and S08 budgets depend on this checkedcomplete-set/repair contract but are not implemented now.

Artifactpolicy: `python3 scripts/check-artifact-policy.py --staged`, then `--range BASE HEAD` on actualoutgoingcommits; placement uses onlychangedS06declaration and auditsalltrackedserver2. Sharedlogic already wired; no missingCI enforcement. Generatedlogs/state underignoredreports/PWF; maintainedtools/docs and selectedmanualassets durable inPR. Actual tests/CI/review evidence published with candidatehashmap, not recursiveevidencecommits. Stage gate: plan and testdesignPROCEED beforebuild; finaleligible reviewPASS beforecompletion.
