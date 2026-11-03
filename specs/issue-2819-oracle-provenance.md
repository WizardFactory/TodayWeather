# G1 behavior specification

## Reader boundary

Prefer the exact `legacy-export` exception `server/test/offline/source-fingerprints.js`. It hashes an explicit reviewed 187-path legacy allowlist using Node built-ins only. It never loads handlers or package initialization, invokes children, writes files, or reads private configuration/environment credentials. The three tracked public `server/config/*.js` sources are hashed as bytes, never evaluated. Reject missing/non-regular/symlinked files or ancestors and output only paths/digests plus bounded identity metadata. Record byte/count limits from the actual nominated inputs before implementation.

The server2 checker invokes this designated reader, validates the repository/reader identity and tracked paths, and reads fixture bytes under server2. It does not directly read legacy source. No runtime consumer gains a legacy dependency. A new source or excluded path requires an explicit reviewed registry/allowlist update.

## Formats and verdicts

An explicit 22-fixture registry names compression, schema-specific map pointers, fixture identity and recorder provenance; validate all 23 maps rather than recursive guessing. Known pointers: `/source/files`, `/sourceHashes`, `/forecast/source/files`, `/harness/source`, `/oracle/files`, `/source_sha256`, `/hash`. Report each map, old/current digest, source identity and mismatch. Reject duplicate JSON keys, malformed digest/path/map, missing expected map, unknown registry member or uncovered fixture. Distinguish legacy-source maps from helper/package/static provenance; 1,089 references do not qualify those other namespaces.

Exit 0 means all declared legacy source references match, never wire parity or production eligibility. Exit 1 means source drift; exit 2 means invalid/unsupported/incomplete input. At the original phase1 checkpoint the real checkout reports14drifted fixtures, notPASS. Actual authorized wholefixture refresh may reduce that count only after complete semantic/source disposition; remaining drift still exits1. No accepted-history suppression or hash swapping is implicit. Report payload/status/header semantics as NOT_EVALUATED until actual legacy recording/comparison is approved and run.

## Preserve the oracle

Keep `server/test/offline/golden-record.js` and complete S02 `records.json` byte-identical. Changing the canonical recorder would change `source.oracle_sha256` and require an explicitly authorized fresh legacy recording and old body/header/inventory/trace comparison. The sibling avoids that unrelated oracle mutation; it copies no assembly logic. It does not remove the need for fixture-specific legacy rerecording when behavior-relevant.

Output uses an explicitly selected new ignored evidence directory; do not overwrite fixture files. No fixture-changing/reconstruction path, fixture disposition, CI enforcement or additional placement exemption is authorized by this draft.


Root phase1 selection: approve the single named hash-only sibling recorder and schema-explicit registry/checker. Existing canonical S02 recorder/records and fixture bodies remain immutable in phase1. This is preparatory implementation within the full G1 task, not completion or merge readiness. Before full G1 completion, predeclare and review required isolated recorder reconstructions, actually rerecord affected contracts with current legacy, inspect semantic output/status/header/trace differences, fix actual parity regressions, and add CI drift enforcement. No digest-only swap, accepted-history suppression, silent excluded fixture or Rust-derived baseline may substitute. Additional paths must be declared before those dependent edits.


## Phase2 towns replay contract

The prior phase1 no-reconstruction boundary remains historical. The exact current declaration now permits `server/test/offline/record-towns.js` copied from the original full54-line towns recorder and one named `towns-oracle-guard.js`; server2 owns the launcher, tests and pinned dependency manifests. Do not copy production assembly logic or change legacy handlers. The complete old remaps/towns/cast-save-lean contract must be compared, never a reduced subset or Rust-derived oracle.

Pin Node16.20.2 and mongoose5.1.2/locked transitive hashes. Restrict the child to the five documented legacy inputs, named driver/guard and verified dependency tree. Deny transport, DNS, UDP, child processes, mongoose connection, private configuration and all writes except one new owned output. Run bounded synthetic denial/output/source canaries before any handler execution. Guard is an explicit execution boundary, not a security-VM claim. No provider, real database, live app or legacy startup.

After root guard assessment, run actual legacy twice into distinct new ignored outputs with fixed clock/environment. Compare decompressed complete behavior and source/helper/dependency metadata separately. Preserve original fixture. Only actual semantic agreement or an explicit root difference/native-fix disposition permits replacement of the whole newly recorded fixture; no digest-only patch, accepted-history exception or historical revision relabel. Existing widget hardcoded execution metadata must remain disclosed until separately corrected.

## Phase3 towns source-authoritative disposition

The two actual original full54line towns runs are byte-identical and complete. After removing only /oracle/files and /oracle/runtime metadata,16field differences are traced to the merged legacy Number(lat/lon) normalization. Root accepts these current source semantics: in-Korea coordinates become numbers and same-process makeResult no longer fails500 from stringcoordinates. Outside/failure/coldLean/remaps/counters are unchanged. Preserve originalfixture and both outputs/53evidence inputs under ignoredreports before replacement. Replace the entire newly recorded compressedfixture, not sourcehashes alone. Update producer/provenance truthfully.

Only two added native/test paths are approved: source/towns.rs added_town helper must normalize in-Korea result coordinates consistently, tests/domestic/towns.rs expectedcurrent scalar/makeResult behavior. Actual request canonical_location/town_document already normalize and need no speculative runtimechange. First run the three existing selected checks against the newfixture and unmodifiedhelper/tests; preserve meaningful native assertions. Change only proven helper/obsolete assertions, then exactscoped checks and17towns plus realfirst/same/cold native request/provider-count proof. No reducedcorpus/loosecoercion/newexpectedgeneratedbyRust. Other13driftedfixtures remain incomplete; no totalG1PASS orCIenforcement yet. No Cargo whileanotherleaseactive.


## Phase4 remaining whole-corpus reconciliation

Phase3 towns evidence is complete only for that contract. The remaining13 DRIFT fixtures use four bounded execution checkpoints: B1 nation16 fullscenarios/4averages andair5helpers/48arpltn/156sorts; B2 alarm47+defaults/schedule andalerts133+6URLs/malformed11/airfilter12; B3 KMA98/older123/town86/CORE55requests+51raw/Rich23requests+148raw+334richraw; B4 world37 andwidget14HTTPcases. Do not sum unlike corpus denominators. Preserve every array, map, order, optional field, status/header/body/providertrace and noncase section. Actualcompleteinputs andexactsource/dependency hashes precede any parity claim.

Newguards/launchers/policies anddependencies belongunder server2. Namedlegacyexports contain exactexistingfullrecorder/helper bytes only, withhashes from next-batch-preparation/exact-path-proposal.json; no handler edit/assemblycopy orserverstartup. CORE/Rich duplicatehelperexports are approved bytepreserving verification-onlyexceptions; originalserver2helpers/hardcodedlabels immutable, loggedlogical+physicalexecutionbinding required. Exactstaticreads/synthetictestaccounts may be aliased only todeclaredserver2 inputs, notprivateconfig/credentials or arbitrarydirectories. ExistingcanonicalS02golden-record.js andrecords.json remainunchanged.

Restore task-local exactNode16.20.2/dependencylockclosure only from officialNode/npmregistry withscripts/audit/funddisabled, emptyconfigs/noauth, no global/projectinstall. Existinglockedtrees canbe reused only aftercompleteinstalledfilehash verification. Firstselected B1 may restore nationmongoose5.1.2/async2.6.2/jade1.11.0/i18n0.8.3 andair exactdocumentedS15directset. Anyunexplaineddirect/transitiveversion/source discrepancy blocksreplay. B2–4 implementation/recovery requires root's explicitcheckpointdispatch within thisoverallcontract.

Beforeactualhandlers, fixedtrusteddrivercontrols verify exactsources/deps, no unexpectednetwork/database/startup/privateinputs/writes, finiteoutput/deadline andreaping. This is revieweddrivercontainment, nothostileJSsandbox ornewgenericframework. Reuseexistingtownsmechanics proportionately. B1childdeadlinesnation15s/air90s; stdout+stderrcombined2MiB; eachrecordcompleteboundedmax(8MiB,4xoriginalinflatedbytes), compressed/inflatedlimits both explicit. Parentretainsfailure andterminatesownedprocessgroup, no overlapunknownattempt. No arbitraryJS/URL/rootexpression flag.

Afterrootcontrolsassessment, actualfullrecorders run twiceinnewnamespaces; successfulcapture remains RECORDED_NOT_COMPARED untilcompletecomparison. Removeonlydocumentedsource/runtime metadata forsemanticcomparison. Rootdisposes everychangedsemanticleaf beforewholeactualfixturereplacement; nohash-onlyswap/historyallowlist/Rustderivedexpected. Unexpectedcurrentbehavior needsmeaningfulnativeRed/Green withnewexactpathsdeclaredbeforeedits, thenseparateownednormalrequest/worker verification. No liveprovider/Mongo/device/shadow/cloud/mergeactions. FullG1 requiresall22registryfixtures SOURCE_CURRENT, consistentoriginal/helper/static/dependencybindings, strictCIenforcement, placement/sharedG2reconciliation andindependentreview. Fourcheckpoints arenotnewtasks orcounterresets; materialcorrectionsrenewonlyaffectedstageswithin10limit.


## Phase5 current legacy-recorder compatibility
Actual nation-actual1 and air-actual1 are retained blocked setup/closure attempts, not product Red or parity. Preserve every original recorder/helper byte and the canonical S02 recorder/records. A separately named record-nation-current.cjs is permitted as a minimally derived adapter retaining all original sixteen scenarios and complete non-case inputs. It executes the real kmaForecastRegions, kmaForecastNarrative and kmaForecastNarrativeResponse source using a fixed in-memory model and controlled clock; no provider, real DB, route implementation copy or fabricated native oracle. Add complete fresh, expired and DB-error narrative scenarios, child narrative stripping canary, response cache headers and source identities. Old sixteen answers remain separately comparable. Declared default empty narrative model is an explicit input, not suppression of a required field.

Current pure dependencies may be added to the fixed hash-verified source policy only after source/dependency inspection. airkoreaImageLayout is such a current pure helper: preserve original air recorder and complete corpus, add its exact source dependency binding; no arbitrary-directory allowlist. Other missing source dependencies stop the run until individually source-assessed within this same contract. No automatic recursive require execution. Record source dependencies in guard and actual capture metadata; do not add sources to a recorded-source map unless the actual recorder or guard actually read them. Original exports retain their hashes and derived adapters carry separate provenance/diff. Exact source list and all installed bytes are checked before and after.

Renew bounded synthetic positive/negative controls for current profiles, then root re-assesses changed source/driver/guard boundaries before new complete twice capture directories. Preserve old failure outputs, no retries into existing directories. Full semantic comparison separates metadata, unchanged original corpus and added current behavior; root disposition precedes whole fixture replacement and any native changes. No source-hash-only refresh, corpus reduction, CI waiver, live IO or merge. Remaining B2–4 checkpoints retain original full corpus and the same preserve-original/named-current-adapter rule; each exact derived path must be declared before editing and actual execution remains separately gated.


## Phase6 B1 native consumer and independent narrative time
Root directly accepted complete twice-capture semantics: the original16 nation cases and all non-source fields are equal, the complete air corpus has zero typed/key-order changes, and three added current narrative cases execute actual legacy helpers. Whole replacement of the actual nation19 and air record is permitted with matching current source/provenance, not a digest-only rewrite. Keep the original immutable drivers, original failed captures and canonical S02 recorder/records. Exact2 relocated air helper reads may be added to the bounded hash reader/source registry; they are verification assets, not runtime dependencies.

Native nation has distinct weather-fixture and narrative wall-clock domains. Existing actual S20e proof deliberately uses historical weather with currently fresh narrative. Do not repurpose the weather clock as narrative time. Add a narrative clock dependency on NationBackend with production default equal to existing system now, plus a pub(crate) clock-aware attach helper. Existing public attach signature remains a default system-clock wrapper. Read this clock after reader.await so a response expiring during read is omitted. No runtime mode/flag, environment configuration, global clock, new provider/storage path or alteration to express/send cache clocks. This is a default-preserving dependency-injection refactor for complete deterministic oracle consumption, not a discovered production weather defect. Missing-symbol compile failure or real-now rejection of the historical fixture is not a product Red; use the practical refactor exception with existing default-current proof and post-await expiry regression.

Tests construct narrative reads from fixture raw inputs, not expected response bodies; all19 cases are covered by existing route composition and explicit header/version-edge coverage union. Keep original16 assertions. Test actual fixed-clock fresh literal body and expired/error omission, child prose stripping, existing cache_age helper at declared clock, and post-await expiry. Raw public/s-maxage headers observed in the legacy injected response helper are not automatically claimed as full native HTTP header parity. Separately preserve/renew actual current-time native HTTP/S3 narrative smoke; distinguish pure fixed-clock composition from real wall-clock execution. Native air regression and an additional owned normal S3/read flow must cover the unchanged complete semantics. No speculative runtime fixes beyond the two declared clock files.

B2–4 remain next execution checkpoints under the consolidated whole-corpus contract, not counter resets. Full G1 still requires all22 current source bindings, complete recorder outputs, affected native checks, strict CI and independent review. No current full G1 PASS, live IO, merge or production claim.


## B3 CommonJS bootstrap and independent audit

The pinned official Node16 CommonJS loader may compile only an already allowed
exact `.js`/`.cjs` file while its synchronous native load owns a one-use pending
slot. Require full UTF8 content SHA, canonical filename, the exact five CommonJS
parameters, exact filename/importModuleDynamically options and three arguments.
Consume before native compilation and restore the previous slot in finally.
JSON and cached loads open no slot. Explicit dynamic compileFunction, Script and
runInThisContext remain denied. Do not normalize unknown BOM/shebang forms or
broaden the fixed source/dependency closure; stop with evidence.

The separate CJS ledger is nonempty, at most4096 exact filename/SHA rows and1MiB
serialized UTF8. Parent validation independently binds every canonical allowed
`.js`/`.cjs` filename and lowercase64hex to current sources/exports/full installed
regular maps, rejects conflicting expected identity, and requires the exact
selected entry row. Same-identity repeated compilation may repeat a row. Existing
transport, VM, output, identity, child and finally checks remain authoritative.
This refines the trusted immutable driver boundary; it is not a hostile-code
sandbox or a new product runtime mode.


## B3 numeric owned-listener resolution

The exact inspected Node16 native listen(0, '127.0.0.1', callback) path may call its captured original dns.lookup only inside a private synchronous one-use owned-listen slot. Require exactly two arguments, primitive127.0.0.1 and a function; consume before forwarding and restore the previous slot in finally. The inspected native literal path returns before resolver access. Before/after listen and listening/close callbacks cannot reuse it. Wrong shape, hostname, otherIP, options, extra args, reused slot and all other DNS/promises/Resolver methods remain denied. No public restore interval, stack-based permission, new network target or receipt schema.

The independent test-only transport failsafe may forward only that exact native literal lookup so it does not mask legitimate guard behavior. The full-five actual parent-launcher positive must use no failsafe, perform real owned ephemeral GET/HEAD/close and pass complete existing audits. Preserve all CJS/VM/parent16reject/entry/bounds/finally/mock-noPID requirements. A listener deadline must reach actual LISTENER_READY first; bootstrap denial never qualifies.


## B3 audited dependency recovery continuation

All289 unique locked archives have now passed data-only SRI, package identity, member and bounded expansion checks. The13 newly acquired bodies total230,404 bytes; the two original lock graphs remain276 S02 nodes and307 Rich nodes, with44,463,987 declared node-weighted expanded bytes. These observations do not establish installation, SDK startup or handler compatibility. Preserve the original recovery1 partial roots and all failed control/data receipts. Use two new independent versioned installation roots and a new cache seeded only by copies of the admitted archive bodies. Never overlay an old node_modules tree or change either original manifest/lock.

The executable mode on node-bitmap0.0.1 package.json and pngjs3.4.0 prepublish metadata are exact data-only dispositions recorded in the retained audit. They authorize no script, build step, chmod or native download. Both installs use the pinned official Node16.20.2/npm8.19.4, offline ci, ignore-scripts, disabled audit/fund/notifier and empty owned configurations. Existing installed-file origin, graph, metadata, internal bin-link and native-file audits remain mandatory before a dependency root becomes eligible for recording. No new archive fetch is needed.

Rich eagerly imports get-pixels, ndarray-pack and cwise-compiler, which uses the global Function constructor for pure generated JavaScript. The trusted-driver guard restricts vm.compileFunction, Script and explicit recorded VM APIs; it does not disable global Function. Do not describe it as a hostile-code sandbox or disable all generated JavaScript. This source audit selects no guard expansion, dependency stub or change to the fixed external-I/O boundary. Actual SDK import and complete recorder execution are still required.

Only one canonical build iteration remains. Do not reset task identities or counters. Installation qualification is a prerequisite checkpoint within the final build, followed by the original full twice-capture/comparison, affected native checks, strict22-fixture provenance, placement, documentation and independent review. A metadata/import/setup failure is not product Red or parity success. Preserve the first failure and assess it without repeatedly running a partial installation or reduced corpus.


## Selected bounded diagnostic continuation (2026-10-20)

# Proposed spec10 addendum: bounded diagnostics, no acceptance change

Root selects this bounded continuation under the recorded task-only15 authority. Source-only worker proposals have been reviewed; execution remains separately scheduled. Preserve the same stable G1 task and all prior iteration counts/failed receipts. AK's explicit total15 allowance supersedes future application of the old10 ceiling only for G1/F2/Resource; it does not rewrite historical build10BLOCKED, merge/production boundaries or shared policy. Root alone verifies counters and begins/finishes stages.

Only two already-declared maintained paths may change: `server2/tools/golden/guards/domestic_http.cjs` and `server2/tools/golden/test_replay_domestic_http.py`. All preparation files are ignored reports. No declaration expansion, driver/helper export, launcher/policy, dependencies, fixtures, reader/registry, Rust/native, CI or product source change is selected.

Preserve all existing specification criteria and full-corpus/native/strictCI requirements; append this selected delta rather than replacing the historical contracts or narrowing their completion gates. Artifact-observed previous spec9; proposed next10.

The guard may emit only passive `ORACLE_REFUSAL_V1` stderr rows at existing `builtin async_hooks` and `VM filename` denial sites. At most16rows/65,536B cumulative within the unchanged2MiB inner stream limit. Bind direct Module parent filename/hash or rejected VMfilename/codeUTF8length/SHA plus fixed context; do not invoke stack-formatting callbacks. Overflow/IO failure remains visibly denied. No builtin, VM, source, dependency, network/DNS/private path or output permission is added.

For the exact canonical `phase4-b3/build11-kma-first-diagnostic1` output only, variant must be kma, at most1 HTTP request is permitted and the next rss-response-smoke.js VM wrapper is denied after first transport. Original driver bytes/all98 cases/full validator remain unchanged. A possible later invocation is diagnostic-only and must remain BLOCKED; no accepted one-case fixture or parity evidence results. Other profiles/output namespaces retain existing behavior plus passive refusal context.

Phase1 selects exactly18 inert controls (old15+new3), not original handlers. The test helper's optional output name is default-neutral. retain() adds only the exact named diagnostic directory alongside the unchanged run* glob, preserving genuine policy/stdout/stderr/child receipt after cleanup. Root must assess actual controls before separately selecting any max1 diagnostic command/controller. No actual-handler controller is supplied here.

Before/finally require exact new39 from Root application receipt, original37+selected2,22fixtures/reader190/registry, officialNode/npm1801, both full installed trees/maps/manifests,289cache bodies, old qualified roots/caches and history snapshots. Preserve c1 source identity; Resource a6 evidence does not relabel G1. Fixtures/native/registry/strictCI changes remain closed.

Required Root outputs: updated maintained spec and spec receipt preserving every prior criterion; identify this narrow diagnostic exception and AK15 authority explicitly.

- G1-1: Explicit schema registry covers all22fixtures/23legacy maps without runtime legacy dependency
- G1-2: Bounded hash-only designated legacy reader rejects unsafe and incomplete inputs
- G1-3: Current drift is diagnosed without baseline digest suppression or fabricated parity
- G1-4: Actual current legacy recordings and semantic reconciliation precede fixture refresh and CI enforcement
- G1-5: Original Red, distinct functional CLI, placement and independent review/current CI retain exact candidate evidence


## Node16 exact VM compatibility continuation

Permit only the observed officialNode16 structured-stack243-byte/SHA identity on KMA runInNewContext with exactly3arguments, own filename option and own overrideStackTrace data context. Keep1000ms/10000 bounds, existing physicalcode checks and all other permissions unchanged. Exact literal/code/shape is not caller authentication; parent independentVM auditing is not claimed. Two optional async_hooks reads remain DENIED. Actual nativeBuffer intended-success Red/Green and all original18 controls plus boundaries precede any separately reviewed max1; full98 clean comparisons still precede fixture renewal.


## Build23: current legacy air parity (2026-10-20)

AK authorized the native/store continuation after build22 completed terminal retirement and full ten captures. Qualified full22 captures at pinned a6 replace the five domestic HTTP oracle candidates; original bytes are retained in ignored build23 evidence. The old/current semantic difference is real (880 classified rows), not accepted equivalence. Preserve request cases, clocks, route groups and original deadlines.

External-provider current observations retain independent nearby AirKorea forecast station identity and stored display history. Forecast insertion uses start=max(now,last observation); end is last observation+24h for AirKorea, or floor(now/hour)+24h for external providers. Hourly AQI carries the selected forecast publication. History restoration must not alter provider current/freshness or mutate stored rows. Native narrative uses its existing subsystem; do not add database reads merely to imitate legacy internal traces.

Verify renewed-fixture native Red before runtime edits, focused store/response checks, full affected native parity, fmt/strict Clippy, isolated functional HTTP, placement, docs/Archify and current CI/review. Original B1/B2/rest/native/strict22 gates remain. No merge, deployment, live mirroring or provider collection is authorized.


## Current whole-corpus qualification contract (2026-10-20)

This amendment preserves G1-1 through G1-5 and the current a6 legacy oracle. Historical phase-specific restrictions above remain evidence of those phases. Current registry domains are187 tracked product sources and33 declared, referenced verification exports; the unchanged190-key Node reader owns the187 product hashes and3 reader-export hashes, and Python hashes the other30 exports. No legacy runtime dependency is added to server2.

For each remaining fixture, run its complete current legacy contract twice in distinct new owned directories, after exact source/export/Node/dependency identity and containment checks. Preserve original inner deadlines, case inventory, order, clock, non-case inputs and output limits. A successful capture is RECORDED_NOT_COMPARED until full comparison and disposition. Any invalid identity, denied guard, unexpected outcome, survivor or unavailable required evidence stops that invocation; do not retry an actual namespace or relabel a failed result.

Pairs must match exact complete document bytes and deterministic gzip bytes where applicable. Compare every original/current typed value, array length/order, object key order and retained response status/header/body/trace. Report source/runtime metadata separately with its actual current input identity; it is not a blanket exception to freshness. Do not assume source-only differences. Classify every changed semantic leaf before adoption. Fixture renewal copies a qualified whole actual record, preserves its predecessor, and updates truthful registry/provenance; native-derived expected values and metadata-only refresh remain forbidden.

The six already-qualified launcher profiles are towns, nation, alarm, alerts, malformed and air-filter. Fresh prepare() checks pass but are not execution or semantic evidence. S02/world/widget require their exact current driver/export/guard/policy packet to be declared and qualified before execution; original canonical S02 recorder bytes remain unchanged. Qualification may reuse existing bounded mechanics but cannot allow arbitrary legacy directories or new live IO.

Reuse existing native tests when source/fixture identity still matches. A real new native mismatch requires a focused behavioral Red or an explicitly justified existing TDD alternative, a scoped fix and affected regression plus owned functional verification. This contract does not presume another runtime edit. All22 freshness, original native/strict CI and eligible PR review remain required before G1 readiness.
