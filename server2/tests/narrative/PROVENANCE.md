# Forecast narrative contract oracle

`contract.json` was produced by `server2/tools/golden/record_narrative.js` from
the accepted PR2805 modules at9333d196846b1c04989b36128d3a7e06f74aa927. The fixture
contains exact SHA-256 values for the two legacy modules,21 cases, ten offices
and their province aliases. The test-only recorder evaluates only those named
modules in an isolated VM with an injected model/requester and frozen clock.
It does not load Mongo, private configuration or a provider client and makes no
network request. Native runtime source never imports or reads those modules.

Command from repository root:

```sh
node server2/tools/golden/record_narrative.js server2/tests/narrative/contract.json
```

The data.go.kr office map comes from dataset15058629 guide241128 station workbook,
category 개황. Default development quota10000/day/key was read on2026-10-17 at
https://www.data.go.kr/data/15058629/openapi.do; operating quota is unmeasured.
The fixture is an object/validation oracle, not an installed-widget or live
provider observation. Client rendering remains issue2803.
