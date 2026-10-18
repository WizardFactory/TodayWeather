# E1 startup coverage execution plan

[Spec](../specs/issue-2819-startup-coverage.md), paths in `server2/config/tasks/StartupCoverage2819.json`. Root owns the existing primary execution notebook. Original implementation intake/proposed design uses4d44; actual parent is unmerged C6 PR2830 b080 (onlyC6 diagramprovenance changed, all E1 sourceinputs unchanged). Parent source/correction/records reviewsPASS; diagram correction independently confirmed; current CI pending.

1. Freeze scope/design/scenarios. Apply AK's confirmed E2 contract: complete environment-only configuration remains valid without `.env`; required configuration omissions fail. Preserve optional dotenv/process precedence and existing constructor validators.
2. Demonstrate bare productionmain acceptance on unchangedparent with one processregression. Use isolatedemptycwd/envclear/PORT0; kill/join onlytheownedbaselineprocess before intended assertion. Separatelyrun existing configuration-only worldselectiontest withsynthetickeys before parserextraction to establish its passing baseline.
3. Add pure `startup::validate_native_coverage`, call onlyfrommain afterConfig/beforeprocess, andextract/reuse the exact existingworldversionparser. Testeachmissingflag/version/default/duplicates/syntax/explicitcoexistence, no storage/provider/account reads. Keep sharedpartial/foundation APIs unchanged.
4. Run actual-main additionalCLI with ownedcwd/envallowlist/ephemeralports; incomplete configuration exitsnonzero beforebind, explicitclosedloopbackcoexistence bindshealth thenTERM0/retiredports. Existingcombinednativeinventory remainsa separateactualroutecheck with zero legacyforwarding; do not callliveproviders or claimfull-nativeproductionprocess readiness.
5. Run affected startup/foundation/world/runtime targets, fmt-check/alltargetClippy/release, declaration/dependency/link/artifactchecks andactualdiagramgates/visual. Preserve firstfailures, no artificialRed oncompile/setup failures.
6. Source provenance sequence before initialpush: verifiedcode/operator/proposed-contract commitA, then currentmaintaineddiagram anchorsnewstartupsourceatcommittedA (which nowexists), regenerateartifact/browser/visual, reuseunchangedruntimechecks with explicitbinding fordiagram-onlycommitB. Frozenupfrontproposalunderignoredreports remainsimmutable; finalmaintaineddiagramreceipts areseparate. Pushonlyafterbothlocalgates; one initialreview/CI candidateB. This avoids linkingnewuncommittedsourceattheoldparent.
7. Actualindependentreview/selectedcorrections andexactparent/currentCI beforepremerge; no merge/automerge/queue, issueclosure, production/fullbundle/shadow qualification.

Scenarios: operator inadvertently starts unservednativeAPIconfiguration (SC1/3); fullacceptedselection passespurecoveragewithoutsideeffects while constructorvalidatesproviderkeys separately (SC1/2); explicitdevelopmentcoexistence andsharedpartialfactories retainbehavior (SC2/3); reviewerreceivescurrentdeclaredsource/binary/diagram/review/CI evidence (SC4). Detailedscenarioactions arein the taskrecords providedtoreviewers. This availabilitybugfix addsno publicUI/newfeature; updateexistingoperatorguide, no unrelatedPDF.

Pre-push consumer correction (root E1-ROOT-001): exhaustive Python process-launch review
found existing tools/smoke.py, deploy/local/stack.py and integration/test_observability.py
start the operational executable with intentionally partial/bare settings. Their exact
paths are declared before edits. Use explicit closed-loopback development coexistence
for those health/logging checks, retain production strictness and no provider work;
update gateway-enabled connection lifetime expectation to its existing12seconds.
Run existing release smoke, local protocol/wire tests and operational logging tests
against the unchanged retained release. Preserve the first harness rejection separately
from the intended old-main regression. Rust remains byte-identical to94/2 checks;
final diagram source pin stays valid. No initialpush until this correction passes.
