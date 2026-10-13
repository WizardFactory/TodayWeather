# S10 execution plan

Owner /root; base 07fdaf991d617f16944d75c201d64f35a4f2c83a; 2026-10-13.
Inputs: [intent](../intent/issue-2695.md), [spec](../specs/issue-2695.md), [sequence](../docs/architecture/diagrams/server2-gateway.html). Exact paths and reasons: [S10 declaration](../server2/config/tasks/S10.json), posted [before implementation](https://github.com/WizardFactory/TodayWeather/issues/2695#issuecomment-6135299135).

Parallel owners: gateway agent owns gateway mod/input/backend/response and wire/peer tests; geocode agent owns geocode mod/format/provider/cache and geocode/privacy tests/providerfixture/provenance; design agent owns sequence JSON/HTML and operations Markdown. Root owns runtime integration, shared lib/main/Cargo, funding models/bridge, S3 address adapter, root tests, smoke/CI/manual generation and remaining maintained docs. No overlapping writes, commits or state by children. Root alone owns stable SDLC counters. Child localtarget dirs disjoint; root combined suite waits for their runs/processes to finish. No child external publication.

Order: specification/design → test scenarios → expected Red for absentfeature → gateway/geocoder/funding/addressadapter implementation → rootruntimeintegration and Green → fmt/clippy/postrefactor → actual releaseHTTP smoke → guide actualcapture/PDF+Archify verification → placement/artifactcleanup → commit/push/PR/CI → actual independent Anthropic review and corrections → premerge handoff. No merge/deployment.

Existing checks reused: S02 retained76 wiregoldens and backendbodies, S04placement, foundationhealth/cors/admission/deadlines, S07boundedcache and S08publication/quota tests. New tests must show providerfallback/rotation, ownedcoldsamekey and distinctdemand, waiterabort/permit retention, preciseRAM-onlyprivacy, timestamp/corruptaddressmiss/S3writeunknown, budgetperkey consumption and expired/unknownquota, explicitnativeregistration/switchrollback. Additional smoke starts actual releaseprocess and bounded literal-loopback provider/backend peers; no realprovider or AWS required. Linux-isolated operational tests run existingCI, not unsafe hostexecution.

Risk: bytecompatibility between JS and Rust JSON/numbers/querydecoding and ownership during cancellation. Could break defaulthealth/admission/canonicalstorage hashes; orderedJSON scopedgateway and defaultgatewaydisabled avoid implicit broadchanges. Reject globalserde preserve_order and coarsepersistentlookup cache without labelproof. Reject runningprovider calls as a test oracle. Prove with fixturebytecomparisons and separatelyexecuted localHTTP smoke plus actual eligible PRreview.

Migration: inject existing.env through processenvironment; keep explicitlegacyHTTP geocoder and allweatherfamilies default. Native provider mode stays closed until actual key/quotaevidence and activationreview. Switching back retains originallegacytarget. No credentialcopy or legacyfiledependency. PreciseRAM results maybe lost on restart; no promisedproviderfreecoldrestore. AddressS3 projection only optional, bounded and30dayexpiry; writefailure doesnotyieldnewdurablesuccess.

Artifactretention: maintained guideMarkdown/PDF, selectedactualusagePNG/manifest, source/generateddiagram. Ignored reports contain logs/receipts/temporaryrenders and activeinputs. Reusable tools remainserver2. Check actualstaged content and outgoingcommits with python3 scripts/check-artifact-policy.py --staged and --help-selected range. GitHubCI artifactexpiry is not onlyevidence: retain summary andselected screenshots inmaintaineddocs plus durablePR/task records.

Productionactivation stillrequires actualdaily/peakquota/distinctdemand evidence, exactlabel/boundary/locales, seven-day shadow and accepted performance/cutover gates. Localmock timings are scopedmeasurements, not productionPASS.

## User scenarios

### WIRE-1
User: API client. Goal: Obtain byte-compatible weather/geocode through aliases. Prerequisites: Retained S02 fixtures and isolated legacybackend/geocoder peers.
1. Start opt-in gateway against loopbacklegacy peers.
2. Request default and explicitversions, locale/queryaliases.
3. Request HEAD, matchingETag andOPTIONS.
4. Compare bytes/status/functionalheaders to retainedoracle.
Expected: Exact wire/parity and304/preflight contract. Failure: Invalidcoords/encoding/version produce legacy400/404; provider/backend/deadline failure501; unavailable/admission503. Criteria: WIRE, GEOCODE. Coverage: gateway wire/geocode/privacy/budget tests, additional gateway_smoke.py and operations guide.

### OWN-1
User: Concurrent API callers. Goal: Share bounded coldlookup/retries despite one waiter leaving. Prerequisites: Deterministic delayedprovider peer and known finitequota.
1. Issue concurrent identicalcoords.
2. Cancel one waiter whileowneractive.
3. Observe survivingresponse and providercounts.
4. Issue distinctkeys at owner/admissioncaps.
Expected: One fundedchain peractivekey; permits retained until actualworkends; lookup<=5s, gateway<=9s. Failure: Capacity/deadline errors remain bounded without overlappingreplacementwork. Criteria: OWNERSHIP, ACTIVATION. Coverage: gateway wire/geocode/privacy/budget tests, additional gateway_smoke.py and operations guide.

### PRIV-1
User: Operator. Goal: Preserve coordinateprivacy and safeaddresscache validity. Prerequisites: RecordingoptionalAddressStore and controllableclock/S3peer.
1. Perform cold/warmreverse lookups acrosslocale/boundaries.
2. Inspect allstorekeys/bodies/calls.
3. Perform addresslookup/restartrestore.
4. Inject expired/corruptprojection and unknownwrite.
Expected: No reversepersistence/logs, boundedRAM; permittedaddressprojectionexpires30days. Failure: Invalidprojectionmiss; failedpublicationcannotclaimnewdurablesuccess. Criteria: PRIVACY, GEOCODE. Coverage: gateway wire/geocode/privacy/budget tests, additional gateway_smoke.py and operations guide.

### SWITCH-1
User: Operator. Goal: Select nativefamily and rollback with existing.env reuse. Prerequisites: Explicitlegacytarget and registeredtestnativehandler; injectedmockkeys only.
1. Start defaultlegacygateway.
2. Select registerednative family/version.
3. Compare output and switchback.
4. Try absentnativehandler or missing/expiredquotas.
Expected: Modes explicit; rollback retained; no implicitliveprovider or keyprovision. Failure: Unregisterednative/config/quota failclosed; productionactivationrequires externalproof. Criteria: ACTIVATION, WIRE. Coverage: gateway wire/geocode/privacy/budget tests, additional gateway_smoke.py and operations guide.

### PLACE-1
User: Repository reviewer. Goal: Verify isolated implementation and reviewable delivery. Prerequisites: Taskdeclaration and integrateddiff.
1. Run placement againsttaskbase.
2. Review imports/dependencies and exactchangedpaths.
3. Run requiredlocal/CIchecks and inspectguide/diagram.
4. Readeligibleindependentreview and currentPRhead.
Expected: Allnewimplementationunder server2; nolegacyreads; reviewedPRawaitsmergeauthority. Failure: Undeclaredpaths or failingrequiredchecks preventreadiness. Criteria: PLACEMENT. Coverage: gateway wire/geocode/privacy/budget tests, additional gateway_smoke.py and operations guide.
