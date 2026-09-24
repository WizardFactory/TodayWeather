# Retained verifier evidence
The independent report is copied verbatim from the verifier. Its original relative paths map here as follows:
- final-output/evidence.json → independent-smoke.json
- unit-result.tap → independent-regression.txt
- timezone-evidence.json → collector-timezone-limitation.json
- timezone-probe.js → collector-timezone-probe.js
- smoke.js → ../../../server/test/offline/rss-response-smoke.js (byte-identical frozen harness)
The builder reran that retained harness separately; smoke.txt and smoke-evidence.json identify /root as execution context. Repeated raw synthetic response/optional-warning stacks remain temporary; all assertions, warning summaries, exact consumed hashes and 36 case outcomes are retained.
Native collaboration tool dispatched /root/response_smoke from /root; fresh verification context, same OpenAI provider. Local route only; not cross-provider PR review. Independent report's initial smoke middleware count was corrected to actual 38 in final evidence.
