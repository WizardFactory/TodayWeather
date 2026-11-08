# Seven-day history gaps: best handling options, 2026-10-30

**Recommendation: interpret the ASOS hourly and daily data that server2 already
acquires more completely, and guard the summaries so that measured precipitation
never becomes "no precipitation".** The rule set below needs no new provider,
credential or request. On 15 station-periods it removes every unknown and
false-dry April–October AM/PM half. Current server2 has 61 unknown and 42 false-dry
halves out of 458. Only winter hours at stations without phenomenon recording
remain unknown.

This began as research. The sections up to "Decisions for AK" describe the state
on 2026-10-30, before any rule existed, and their output figures come from an
offline simulation that mirrors the cited server2 source. Later sections record
what was validated and implemented; the contract holds the current status of each
rule. No latency was measured. The seven-day requirements, fields, cadence and allowed historical
sources (observations, ODAM and VSRT) are unchanged.

This continues the [ASOS source qualification](kma-asos-closure-qualification-2026-10-25.md).

## What the three reported cases are

| Case | Finding |
| --- | --- |
| Seoul 108, 2026-10-20 21:00, blank rain with `rnQcflg` 9 | No sign of a sensor outage. In April–October, 99.8% of blank QC9 hours carry no precipitation code, and most follow the day's first precipitation. The official daily total already accounts for all the rain. |
| Gangneung 105, wet days with empty journals | Gangneung records no phenomenon codes, journal or rain duration. Its cloud, visibility and rain amounts remain. In July 2026 it recorded no code on any of its 97 wet hours. |
| Jeju 184, journal intensity checkpoint at 03:00 | Not a data gap. Hourly rain and codes already give 01:00–02:00. Only the journal parser was uncertain, and the recommended rules do not use the journal. |

## New bounded evidence

The fixed profile `asos-qc9-structure-20261030` was declared before execution. It
made exactly 16 data.go.kr calls with no retries or redirects. All returned HTTP
200 with `resultCode` 00 and the complete row count. It used the first
`DONGNAE_SECRET_KEYS` entry; the key was never printed or stored. The originals
are kept locally in the ignored run directory with the hashes below. They were
not promoted as fixtures.

| Station | Product | Period | HTTP / result | Rows | SHA-256 |
| --- | --- | --- | --- | ---: | --- |
| 101 | hourly | 20260701–20260731 | 200 / 00 | 744 | `6fcc6a3715a4d6f40f9558ccde2f10fc01278da32ce1e4ac719a8f3f5a54b042` |
| 101 | daily | 20260701–20260731 | 200 / 00 | 31 | `245ce2f82c08d42b913fd968c7c7d2bf5315f4062c19a3d1176bf93dd377adde` |
| 105 | hourly | 20260701–20260731 | 200 / 00 | 744 | `4049f5d06e34d9e230dd627a847a61510abebf53e179ad69d11e498ff51ab51e` |
| 105 | daily | 20260701–20260731 | 200 / 00 | 31 | `eeaf933d184e69eeedf3c79ec202067662a0e536c1250a2f3af7441aaf1ea443` |
| 133 | hourly | 20260701–20260731 | 200 / 00 | 744 | `c6a48190f00eb07b19c1107b7138aa1e265cfe2e21a3dec99363489deb8b67bd` |
| 133 | daily | 20260701–20260731 | 200 / 00 | 31 | `f559cd328c91e78b021165ab61493743b9e90b8abe41d639e25b781d1dca9a37` |
| 143 | hourly | 20260701–20260731 | 200 / 00 | 744 | `9a49054fc3fc87ad0b44942bbe6039590d1f7be03fbaef2d02cf59fb9dae80c7` |
| 143 | daily | 20260701–20260731 | 200 / 00 | 31 | `c3445122358d926a2d113d74909d1e39effbb9272e6902f5c9651d6c8000b625` |
| 156 | hourly | 20260701–20260731 | 200 / 00 | 744 | `0a1c5349d59c8f659c43d9557a966cec021b767075a02e3a27769a819d812666` |
| 156 | daily | 20260701–20260731 | 200 / 00 | 31 | `e8294471b243b55fb941ae47d67ac37a82c22cad60eddadedffa699eae5d1336` |
| 119 | hourly | 20260401–20260430 | 200 / 00 | 720 | `792f49c8030ee7ac558b82ce338dfe677910c4259e193728e557bb496e1168a8` |
| 119 | daily | 20260401–20260430 | 200 / 00 | 30 | `a57e260582cdea1107e10ad06cb7d8f92623f8c8467106793ed67f8e04344e81` |
| 146 | hourly | 20260401–20260430 | 200 / 00 | 720 | `5df28f55559e2920f41f5f5b01b717d96f2a58d9f8f0e55074d593f5222759f2` |
| 146 | daily | 20260401–20260430 | 200 / 00 | 30 | `f199ad0a6e8d6a203d71ad0dce1634f354be835ad7e7c146c95a50a0ec011425` |
| 131 | hourly | 20260201–20260228 | 200 / 00 | 672 | `30f8a9c05ed5dd4a3c6e37d42c349291c12e0bc7fed406c1ce032e72d192e75b` |
| 131 | daily | 20260201–20260228 | 200 / 00 | 28 | `597cd310e551c6dffebc0d31796ea05bc1840fce359d2be5aa4e483a9f1a4966` |

The analysis also reuses the seven retained hourly/daily pairs from the
[ASOS fixture provenance](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md).
The combined sample has 15 station-periods: 11 from April–October and 4 from
November–March. It is not a nationwide sample.

### Phenomenon coverage depends on the station

The hourly domestic phenomenon code `dmstMtphNo` is derived from the observation
journal for the preceding hour [5]. Its presence on wet hours shows three station classes:

| Class | Stations in the sample | Wet hours without a code |
| --- | --- | --- |
| All hours | Seoul 108, Incheon 112, Suwon 119, Cheongju 131, Daejeon 133, Jeonju 146, Busan 159, Mokpo 165, Jeju 184 | 0–4 per period |
| Daytime only (codes at 09:00–19:00) | Daegu 143, Gwangju 156 | 42 of 67; 51 of 90 |
| None | Chuncheon 101, Gangneung 105 | all (180, 97, 18) |

A wet hour is identified by its rain amount, including a trace `0.0`. A blank rain
amount means no precipitation, regardless of staffing [2]. A missing code
therefore leaves only the precipitation type unknown. All 370 April–October wet
hours without a code had a measured temperature of at least 18.7 °C. In winter,
23 of 26 such hours were below 5 °C.

### QC9 contexts and daily closure

| April–October blank-rain QC9 hours | Count |
| --- | ---: |
| After the day's first numeric-rain hour, no code | 1,196 |
| After the first rain, non-precipitation code (for example `19`) | 68 |
| Before the first rain, no code | 9 |
| On a day without numeric rain, no code | 21 |
| With a precipitation code | 3 |
| **Total** | **1,297** |

The 30 cases before the first rain or on a dry day refute a pure first-rain rule.
They also carry no precipitation code. The three hours with precipitation codes
(Gwangju) are wet hours with a missing amount; each shares a three-hour slot with
other wet hours. Ten numeric values flagged QC9 are all trace `0.0`, and eight
carry rain codes.

For every complete observation day, the numeric hourly amounts were compared
with the official daily `sumRn`. All 139 wet days matched exactly, to 0.1 mm.
None of the 125 days with a blank daily total had a numeric hourly amount. Because
amounts cannot be negative, a QC9 hour therefore adds 0 mm to the official daily
total. The daily total and the hourly amounts may come from the same gauge record.
Closure therefore proves consistency with the official total, not independent
sensor confirmation.

In winter, numeric amounts occur only at three-hour marks. QC9 fills the hours
between marks after precipitation begins, and 86 winter blank-rain QC9 hours
carry precipitation codes. This agrees with the documented winter cadence [3]
and the APIHub description of the same `RN` field [4].

## Why current server2 reports false dry weather

Current normalization sets PTY only from a supported code or a qualified normal
blank. A wet hour without a code therefore has an unknown PTY
([normalize](../../../server2/src/domestic/kma/source/asos.rs#L215)). The ASOS-primary
merge does not add PTY ([merge_hourly](../../../server2/src/domestic/kma/policy.rs#L711)).
The three-hour summary of recovered rows returns −1 only when no hour is known
([summary_to_3h](../../../server2/src/domestic/kma/short.rs#L194)). The day summary
skips −1 slots ([day_summary_list_by_short](../../../server2/src/domestic/kma/mid.rs#L195)).
A slot with one uncoded wet hour and two known dry hours therefore reports PTY 0,
while its rain amount can be positive. The status report still lists the hour in
`missingHourlySlots` ([status](../../../server2/src/domestic/kma/policy.rs#L867)).

server2 mirrors the legacy partial rule
([legacy 3h rule](../../../server/controllers/controllerTown.js#L4720)). In legacy,
PTY in these rows came only from gathered ODAM data. The legacy ASOS fill never
set PTY, skipped every QC-flagged value, used no winter hourly rain and omitted
unknown recovered rain on the wire
([legacy normalize](../../../server/lib/history/policy.js#L92),
[legacy hourlyResponse](../../../server/lib/history/policy.js#L163)).

## Output impact of candidate rules

The simulation reproduces each hourly PTY rule and the cited slot and day
aggregation. "False dry" means that a slot or half reports PTY 0 although one of
its hours has a numeric rain amount or a precipitation code.

| Rule set | Apr–Oct unknown slots | Apr–Oct false-dry slots | Apr–Oct unknown halves | Apr–Oct false-dry halves | Nov–Mar unknown halves | Nov–Mar false-dry halves |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S0 current | 450 | 35 | 61 | 42 | 8 | 1 |
| S1 guard only | 485 | 0 | 103 | 0 | 9 | 0 |
| R1b QC9 rule without type rule or guard | 67 | 107 | 0 | 77 | — | — |
| S2 guard + temperature type | 311 | 0 | 26 | 0 | 8 | 0 |
| S3 S2 + QC9 closure | 0 | 0 | 0 | 0 | 8 | 0 |
| **S4 S3 + winter window** | **0** | **0** | **0** | **0** | **3** | **0** |
| S4 without guard | 0 | 0 | 0 | 0 | 1 | **2** |

The sample has 1,832 April–October slots and 458 halves (186 wet), plus 280
winter slots and 70 halves (23 wet). Under S0, the April–October false-dry halves
are at Chuncheon (14), Gangneung (15), Daegu (6) and Gwangju (7). The single
winter case is Gangneung in March 2025. Under S4, the
only unknowns are 11 slots and 3 halves at Gangneung in March 2025, plus 1 slot
at Incheon in January 2025.

Daily rain has a separate gap. Of 125 dry days with a blank `sumRn`, 27 remain
unknown under the current daily guard. Their journals contain only
non-precipitation entries such as mist, haze, fog, halos or yellow dust. Each has
no numeric hourly rain and no precipitation code.

## Alternatives considered

| Option | What it can close | Limitation | Verdict |
| --- | --- | --- | --- |
| ODAM point API (data.go.kr or APIHub) | Typed hourly PTY, as legacy gathered | Official guidance: `base_date는 최근 1일까지만 가능` [1]. ODAM is matched representative-AWS data with an unpublished type method [1]. | Keep for the latest day only |
| VSRT point API | SKY, PTY and LGT as ultra-short forecasts | APIHub guidance: `base_date는 최근 3일까지만 가능` [1]; the data.go.kr reach is unverified. Each past hour needs its own issue, about 72 calls per grid for three days. Values remain forecasts. | Candidate for the latest three days after a live check |
| KMA data portal ODAM/VSRT files | ODAM archive; VSRT through D−1 | Portal file sets: ODAM through the previous month, VSRT through the previous day [1]. Not an API; automation and terms are unverified. | ODAM files cannot cover recent days; VSRT files are not a runtime path |
| APIHub ASOS `IX`, `WC`, `WW`, `RN_DAY` | Per-hour staffing and possible automatic weather at unstaffed hours | Key needed and unverified. `RN` has the same winter cadence; `IR` definitions conflict within the manual [4]. | Optional winter qualification |
| Public AWS hourly page | Amount at many stations | Returned 0 and `○` for both a QC9 hour and a trace hour; no type | Not a discriminator |
| Daily journal parser | Event presence | Failed frozen held-out controls; empty at unstaffed stations | Not needed |
| Nearest other station | Type or presence | Different location and precipitation timing; not the legacy single-station policy | Not recommended |
| Temperature-qualified type | Type of measured precipitation | An inference; needs AK approval | Recommended for warm conditions |

## Proposed rule set S4

The guard (G) is required for every other rule. Without it, the QC9 and winter
rules increase false-dry output because they add known dry hours beside wet hours
without a type.

1. **G. Aggregation guard.** For recovered history rows, a three-hour slot or AM/PM
   half with measured precipitation evidence must never summarize to PTY 0.
   Evidence means a numeric rain amount (including trace) or a precipitation code.
   If no known type exists, the result is unknown (−1). Legacy behavior is
   otherwise unchanged.
2. **R2. Type for uncoded precipitation.** A normal-QC numeric hourly amount without
   a code is rain (PTY 1) when the same station-hour's measured temperature is
   at least 5 °C. Otherwise its type stays unknown. Any threshold up to 18.7 °C
   gives the same April–October result in this sample.
3. **R1b. QC9 hourly closure (April–October).** A blank-rain QC9 hour without a
   precipitation code means no precipitation (PTY 0, amount 0). This requires a
   daily `sumRn` equal to the day's numeric hourly sum. A blank daily total is
   also accepted when the day has no numeric hour. Requiring the hour to follow
   the first rain would leave the 30 counterexample hours unknown, although they
   meet the same closure and code evidence.
4. **W1. Winter windows (November–March).** A blank QC9 three-hour mark means a dry
   window under the same daily closure, when no hour of that window has a
   precipitation code. Hourly PTY between marks still comes only from codes.
5. **D1. Dry daily total.** A blank daily `sumRn` is 0 mm when that observation day
   has no numeric hourly rain and no hourly precipitation code. Non-precipitation
   journal entries then no longer block the value.

S4 uses only fields server2 already acquires. It adds no provider request, quota
use or latency. ODAM and VSRT keep their existing precedence for the latest day.
Canonical raw bytes and the legacy replay path are unchanged.

## Known risks

- R1b can classify a wet hour with a missing amount as dry when no code covers
  that hour. Coded hours showed 3 such hours in 1,297 (0.23%). None changed its
  slot, because adjacent hours were wet. Unstaffed hours may differ.
- R2 does not reproduce KMA's unpublished ODAM typing. Its validity outside
  this sample, especially at mountain stations in spring and autumn, is unverified.
- Staffing classes are inferred from code presence, not from a documented
  station attribute.
- The mechanism behind QC9 is undocumented. The rules rely on code evidence and
  official daily totals, not on a KMA statement that QC9 means dry.

## Remaining unknowns and their representation

Code-less stations in winter near freezing remain undeterminable from data.go.kr
alone. Server2 should keep the legacy missing-value behavior: keep the date and
field, use the internal sentinel, omit unknown recovered rain on the wire and
list the field in `historyStatus.hourlyFieldGaps`. With G, these cases are shown
as unknown rather than dry. An APIHub key would allow a bounded qualification of
`IX` and automatic present-weather codes for these stations. It is optional and
not required for the April–October fix.

## Decisions for AK

1. Approve R2, the temperature-qualified rain type, and its threshold. This changes
   the current rule that PTY requires a phenomenon code.
2. Approve R1b, W1 and D1, which treat QC9 hours and dry daily totals as no
   precipitation when the official daily total and the codes agree. This changes
   the current rule that QC9 always stays unknown.
3. Optionally, issue an APIHub key for a bounded winter qualification.

G corrects existing behavior and does not change any source interpretation.
It should be implemented with or before the other rules.

## Verification and limits

- Actual provider requests: 16 data.go.kr calls, all successful. One public KMA
  guidance page was retrieved (SHA-256
  `5e631e7410382cd2ed21c93152e14674413b4212301493966ace61928de0b8e8`). There were
  no APIHub, Amazon AWS or S3 operations.
- The analysis scripts ran offline with `python3 -I` on the retained originals.
  SHA-256 values: analysis `123e56d8bccb437bf39024612459c43383147ff8f4118888b8419b30ff80b7b4`,
  impact `1f95cf361a2a154a4648f07b6b17caa08c715a4c6c378497267495f9a17e895c`,
  combined rules `ff87d89bb30878acc7c1949c4318a6319916436c4dd34ec99fed5b47e34dfbac`,
  fetch `6b5a894ea1a72b188e3ac4a82d0c3f9b854e3ffada0e19fc6ecfbcf04a23aadc`.
- The predeclared QC9 criteria failed. The first-rain rule (C1) had 30
  counterexample hours, and the code rule (C2) had 3. Ten numeric QC9 values were
  also reported. Daily closure (C3) passed everywhere. S4 was designed after
  these results and has not been tested on fresh held-out data.
- The output simulation mirrors the cited Rust and legacy source. It is not a
  native test, an end-to-end response or a client latency sample. Seven-day
  closure and p95/p99 remain unqualified.

## Slice 1 implemented locally, 2026-10-30

AK asked the lead and a GPT-6.1-sol max advisor to agree on the approach; both
agreed to a small data contract instead of a formal ontology, limited first to
precipitation. The rules R2, R1b, W1 and D1 stay proposed and are excluded
from coverage. Only the guard G changed behavior.

- **Contract:** [`kma-history.v1.json`](../../../server2/config/contracts/kma-history.v1.json)
  declares sources, nodes, edges, rules, invariants I1–I6 and the open
  request-wait conformance failure. The required wait is 3 s; the
  observed-history handler budget is 8 s.
- **Checker:** [`kma_full_response_contract.py`](../../../server2/tools/verification/kma_full_response_contract.py)
  now reads its allowed history sources from the contract and validates the
  contract structure. Its full-field comparison list is unchanged.
- **Guard:** `guard_precipitation` in
  [`policy.rs`](../../../server2/src/domestic/kma/policy.rs) runs under
  ASOS-primary before `missingDailyDates` is computed. A slot with untyped
  precipitation evidence gets PTY −1. The affected AM/PM half loses its PTY,
  SKY and text, keeps its date, and is listed in `missingDailyDates`. ASOS
  evidence comes from the existing `fieldObservations` provenance, so the wire
  gains no field. The stored-summary identity now ends with
  `precipitation-guard-v1`.
- **Regression originals:** Chuncheon 101, Gwangju 156 and Daegu 143 for July
  2026 are promoted with [provenance](../../../server2/tests/domestic/fixtures/ASOS-20261025-PROVENANCE.md).

Before the guard, three of the six observed-history tests failed. The
re-dated Chuncheon July 22 PM had 5.2 mm of rain but read `흐림` with
`ptyPm: 0`. After the guard, all six pass. Eighteen contract checker tests
pass, and the contract validates with no errors.

Known limitation: a guarded three-hour slot still shows a sky-only icon,
because PTY −1 has no precipitation icon. Only a type source, such as the
proposed R2, can change that.

## Client delivery eval, 2026-10-31

AK asked for an automated eval of the data delivered to clients, covering every
weather API version in production traffic. Unversioned `/weather/coord` is the
v000901 gateway default and carried 70.72% of requests. The other versions were
`/weather/v000903/coord`, `/v000901/kma/addr` (also used by both iOS widgets),
`/v000903/kma/addr`, `/v000803/town`, `/weather/v000901|v000902/coord` and
`/v000705/town`.

- **Contract:** [`kma-client-wire.v1.json`](../../../server2/config/contracts/kma-client-wire.v1.json)
  declares the versions, surfaces, required fields and slot time values. It
  also lists the fields each consumer reads: the iOS widget on v000901 and the
  app on v000903. Their source lines are in the
  [client field table](../../architecture/mobile-api.md#fields-read-by-clients),
  which a test checks against the contract and the cited lines.
- **Eval:** [`kma_client_eval.py`](../../../server2/tools/verification/kma_client_eval.py)
  is stdlib-only and Python 3.9 compatible. It learns a type profile per version
  and surface from the 317 pinned legacy bodies. It reports a violation for:
  - null where legacy never sends it; legacy sends null only in `current.arpltn.*Index`;
  - type changes;
  - missing required or consumer-read fields;
  - unordered slots or invalid slot times;
  - non-ascending daily dates;
  - a non-empty v000705 town weather body.
  New fields are information only. With `--observed-history`, measured rain shown
  as two dry halves or as slot PTY 0, and an omitted half missing from
  `missingDailyDates`, are violations.
- **Legacy calibration:** all 317 legacy bodies pass. Two legacy behaviors are
  reported as information rather than violations. In model-error responses,
  legacy sends numeric `skyAm`/`skyPm` and omits `fromToday` (94 findings).
  Legacy also shows measured rain beside dry presentation in 87 findings.
- **Native check:** [`client_eval.rs`](../../../server2/tests/legacy_versions/client_eval.rs)
  assembles every recorded scenario natively and evaluates 520 bodies. They are
  282 legacy-mode and 238 ASOS-primary, across v000705, v000803, v000901, v000902
  and v000903; 225 carry observed history. All pass.
- **Can-fail check:** with the precipitation guard call removed, the same test
  failed with 374 violations; the 30 it printed were all H1. `mid.rs` was then restored
  byte-identically.

Limits: gateway bodies are not assembled by this test. Their data part is the
evaluated backend body, and gateway parity with the legacy goldens is tested
separately. Client builds outside this repository, including the unidentified
Android-like callers of the unversioned path, are covered only through the
legacy wire profile. The eval does not check values, units, headers or latency.

## Held-out validation of proposed rules, 2026-10-31

Criteria were fixed before any request (plan `2026-10-23-kma-cold-requirements`). One data.go.kr profile fetched hourly and daily ASOS for nine stations and months not used before: 100 (2026-04), 211 (2025-10), 90 (2026-05), 138 (2026-08), 152 (2026-09), 192 (2026-06), 136 (2025-12), 140 (2026-01) and 127 (2026-03). All 18 calls returned HTTP 200, result 00 and full rows. Hours with a phenomenon code are the truth. R1b, W1 and D1 were scored without their code condition, so their error rate estimates code-less stations.

| Rule | Criterion | Scored | Errors | Verdict |
| --- | --- | ---: | ---: | --- |
| R2 | every coded precipitation hour with ta >= 5 C is rain; >= 50 hours | 178 hours | 0 | PASS |
| R1b | coded share <= 0.5% and no slot flip; >= 200 hours | 265 hours | 0 | PASS |
| W1 | no precipitation code in a predicted-dry window; >= 20 windows | 18 windows | 0 | INSUFFICIENT |
| D1 | no precipitation code or `iscs` term on a predicted 0 mm day; >= 50 days | 52 days | 0 | PASS |

Limits:

- Only 136, 138 and 152 recorded codes, all 24 hours a day. The other six recorded none, and no station recorded daytime-only codes.
- R2 has one scored hour between 5 and 10 C, where 69 of the 434 code-less wet hours it would type fall. Below 5 C, station 136 coded 9 rain hours and 1 snow hour; R2 makes no claim there.
- R1b truth comes from August and September only.
- D1 counts only days with truth. 101 further candidate days at code-less stations had no `iscs` text and are not counted.
- W1 stays proposed.

The originals, receipt and scoring scripts are ignored local evidence under `reports/kma-rule-holdout-20261031/`.

### Second held-out sample, 2026-10-31

AK approved R1b and D1. AK asked for more data on R2, including whether wind matters, and for more data on W1. The criteria were again fixed before any request. The sample used nine stations that earlier samples showed recording codes 24 hours a day, in months not fetched before: 108 (2026-03), 112 (2025-11), 119 (2026-02), 131 (2025-12), 133 (2026-03), 146 (2025-11), 159 (2026-02), 184 (2026-01) and 138 (2025-11). Stations are therefore not new; only the months are. All 18 calls returned HTTP 200, result 00 and full rows.

| Rule | Criterion | Scored | Errors | Verdict |
| --- | --- | ---: | ---: | --- |
| R2, 5–10 °C | every coded precipitation hour is rain; >= 50 hours | 61 hours | 1 | FAIL |
| W1 | no precipitation code in a predicted-dry window; >= 20 windows | 221 windows | 2 | FAIL |

- The R2 error is sleet (code 09) at Jeju, 2026-01-08 06:00 KST. The air was 5.1 °C, with humidity 49 %, dew point −4.7 °C and wind 5.7 m/s. The daily journal records sleet showers (`소낙성진눈깨비`).
- The W1 errors are snow codes (05) in the first hour of a window whose amount was QC9. Station 131 had one on 2025-12-14 (13:00–15:00) and station 184 on 2026-01-01 (16:00–18:00). Both days met the daily closure.
- Both rules stay proposed.

Two further checks were not part of the criteria and do not decide anything:

- **D1 in winter:** D1 applied to 183 staffed winter days in this sample with no error.
- **Wind and humidity:** the coded hours from −2 to 15 °C in all fetched samples were compared.
  - Strong wind (at least 5 m/s) came with 29 of 59 snow or sleet hours, but only 4 of 38 rain hours below 5 °C. This reflects cold, dry outbreak air rather than an effect of wind itself.
  - The wet-bulb temperature combines temperature and humidity (Stull 2011). At or above 2.5 °C it separated 200 rain hours from 0 snow or sleet hours. Air temperature at or above 5 °C separated 198 rain hours from 1 sleet hour.
  - A wet-bulb rule is a new hypothesis drawn from these data. It needs a fresh held-out sample before approval.

Originals, receipt and scripts are ignored local evidence under `reports/kma-rule-holdout2-20261031/`.

### Third held-out sample: wet-bulb variant, 2026-11-02

AK asked to validate the wet-bulb hypothesis. The rule and criteria were fixed before any request. An uncoded normal-QC amount is PTY 1 when the wet-bulb temperature is at least 2.5 °C (Stull 2011, from the same hour's temperature and humidity). The sample was hourly only: 18 station-months at stations with 24-hour codes, in December to March months not fetched before. Stations are not new. One call (131, 2025-03) failed with a network error and was not retried, as fixed in advance; the other 17 returned full rows.

| Criterion | Required | Result |
| --- | ---: | ---: |
| Scored hours | >= 150 | 198 |
| Scored hours at 2.5–6 °C wet-bulb | >= 50 | 117 |
| Snow or mixed hours with amount at or above 0 °C (exposure) | >= 20 | 73 |
| Scored hours with a snow or mixed code | 0 | 3 |
| Three-hour windows with a snow or mixed code | 0 | 3 |

**The variant fails and stays proposed.** The three errors, using server2's code mapping (the journal was not fetched for this sample):

| Station and time (KST) | Code | Air °C | Humidity % | Wind m/s | Wet-bulb °C |
| --- | --- | ---: | ---: | ---: | ---: |
| 138, 2026-02-25 00:00 | 0601 (mixed) | 4.9 | 95 | 2.6 | 4.34 |
| 184, 2025-12-03 18:00 | 10 (snow) | 5.4 | 73 | 7.9 | 2.92 |
| 184, 2025-12-25 15:00 | 09 (mixed) | 6.5 | 62 | 8.4 | 3.04 |

On the same sample, air temperature at or above 5 °C gives 166 rain hours and 7 snow or mixed hours. The wet-bulb rule gives 195 and 3, so it is better but not error-free.

These further counts are post-hoc, do not decide anything and are not held-out evidence:

- Every error in all three samples falls in December to February.
- April to October has 714 coded hours across all samples, all rain. None has a wet-bulb temperature below 6 °C, so no cutoff was challenged in that season.
- Code-less stations have 765 uncoded wet hours: 692 in April to October and 73 in November to March. Wet-bulb at or above 5 °C would type 680 of the April to October hours.
- Staffed stations in these samples include no mountain station, so spring snow at a station such as Daegwallyeong cannot be scored.

A rule limited to April to October is a new hypothesis and needs its own fresh sample with cold April and October precipitation.

Originals, receipt and scripts are ignored local evidence under `reports/kma-rule-holdout3-20261102/`.

### Fourth held-out sample: April–October wet-bulb rule R2s, 2026-11-02

AK asked to validate the season-limited rule. The rule and criteria were fixed before any request. In an April–October hour, an uncoded normal-QC amount is PTY 1 when the wet-bulb temperature is at least 5.0 °C; November–March stays unknown. The sample was hourly only: 18 station-months in April and October at stations with 24-hour codes, in months not fetched before. Stations are not new. All 18 calls returned HTTP 200, result 00 and full rows.

| Criterion | Required | Result |
| --- | ---: | ---: |
| Scored hours | >= 150 | 1,253 |
| Scored hours at 5–8 °C wet-bulb | >= 30 | 164 |
| Scored hours with a snow or mixed code | 0 | 0 |

**R2s passes.** With zero errors in 1,253 hours, the 95 % upper bound on the error rate is about 0.24 % (rule of three), for staffed stations like these.

The cutoff was challenged. The sample holds 25 snow or mixed hours, all from 12–14 April 2025. The warmest was 4.42 °C wet-bulb (station 131, 2025-04-13 12:00: air 8.8 °C, humidity 54 %), which leaves a margin of 0.58 °C. Air temperature at or above 5 °C would have typed 6 of those 25 hours as rain.

Limits:

- Only months are new, not stations.
- All 25 snow or mixed hours come from one weather event.
- No staffed station here is a mountain station, so spring snow at a station such as Daegwallyeong cannot be scored.
- 161 coded rain hours lie below the cutoff; the rule would leave hours like these unknown.

Originals, receipt and scripts are ignored local evidence under `reports/kma-rule-holdout4-20261102/`. AK approved R2s on 2026-11-03.

### Fifth held-out sample: 5.0 °C wet-bulb rule in November–March, 2026-11-08

AK approved applying the 5.0 °C cutoff in every month on 2026-11-08 (`wet-bulb-rain-v2`). The rule and criteria were fixed before any request (pre-registration 14:42 KST, first request 14:47:38 KST): in a November–March hour, an amount without a phenomenon code (numeric, normal rain QC, trace 0.0 included; temperature and humidity unflagged, humidity at least 5 %) is PTY 1 when the wet-bulb temperature (Stull 2011, humidity capped at 99 %) is at least 5.0 °C. Truth is the recorded code at stations that code all 24 hours, mapped as server2 maps it. A stricter window check (C5) covers every three-hour mark the rule would type, whatever its own code. The sample was 18 station-months (stations 108, 112, 119, 131, 133, 136, 138, 146, 152, 159, 165, 184; November 2024 to March 2026), none fetched before; 18 calls, one page each, all HTTP 200, result 00 and full rows.

| Criterion | Required | Result |
| --- | ---: | ---: |
| Scored hours (wet-bulb >= 5, own rain/snow/mixed code) | >= 80 | 117 |
| Scored hours at 5.0–8.0 °C wet-bulb | >= 30 | 71 |
| Snow or mixed hours with an amount at wet-bulb >= 0 °C (exposure) | >= 20 | 63 |
| Scored hours with a snow or mixed code | 0 | 0 |
| Typed three-hour windows with a snow or mixed code (160 typed marks) | 0 | 0 |

**The rule passes.** With zero errors in 117 hours the 95 % upper bound is about 2.6 % for staffed stations like these. The cutoff was weakly challenged: the warmest snow or mixed hour with an amount was station 133, 2025-01-06 12:00 KST (air 3.5 °C, humidity 89 %, wet-bulb 2.43 °C), a margin of 2.57 °C; 49 of the 63 exposure hours were at 0–1 °C. Post hoc (not deciding): zero errors at every cutoff from 3.0 to 6.0 °C, so this sample cannot separate 5.0 °C from 3.0 °C; air temperature at or above 5 °C instead would have made 4 hourly and 11 window errors.

Found before the requests, in the third sample's data, with the stricter window check: station 138, 2026-02-25 03:00 KST had no code and a trace amount (0.0) at wet-bulb 6.18 °C while its window held sleet (code 06) at 01:00, so the 5.0 °C rule would type that mark as rain. The third sample's narrower window check had missed it; the post-hoc statement that all three errors there were below 5 °C holds for hours, not for this window.

Originals, pre-registration, receipt and scripts are ignored local evidence under `reports/kma-rule-holdout5-20261108/`.

### R1b and D1 implemented locally, 2026-10-31

`dry-closure-v1` is in [`asos.rs`](../../../server2/src/domestic/kma/source/asos.rs). It runs after the observed replay and only under ASOS-primary.

- **Day closure:** the rules need all 24 latest hourly originals of the observation day, 01:00–24:00 KST. The day closes when its numeric hourly amounts, at any QC, sum to `sumRn`. It also closes when `sumRn` is blank and no hour is numeric.
- **R1b:** on a closed April–October day, a blank QC9 hour without a precipitation code gets `rn1` 0 and PTY 0. Coded hours keep their code type. Unsupported codes stay unknown.
- **D1:** a blank `sumRn` with no numeric or coded hourly precipitation and no positive `sumRnDur` gets `rn1` 0. A non-precipitation journal entry no longer blocks it.
- **Safety limits:** a day is skipped if its stored rain fields differ from what its latest originals give. Only absent fields are filled. Rule-derived values carry the existing `KMA_ASOS` provenance.
- **Effect on the two held-out samples:** applying the same conditions offline fills 791 QC9 hours that were unknown. D1 gives 0 mm on 336 days. The existing empty-journal rule already covered 256 of them; the other 80 have non-precipitation journal text and were unknown before.
- **Cache identity:** the stored summary identity now ends with `dry-closure-v1`.

### R2s implemented locally and derived-value precedence corrected, 2026-11-03

`wet-bulb-rain-v1` is in [`asos.rs`](../../../server2/src/domestic/kma/source/asos.rs). It runs after the observed replay, only under ASOS-primary, on the latest original of each April–October hour. A later code, in any fetch order, outranks it.

While implementing it, a defect in the 2026-10-31 R1b code was found and fixed. Under ASOS-primary, every value in an ASOS record's `values` replaces the row's value. R1b wrote there, so its derived PTY 0 and 0 mm could replace a measured ODAM or forecast VSRT value on the latest days, against the declared precedence. Hourly derived values now stay in a separate `inferred` field. [`merge_hourly`](../../../server2/src/domestic/kma/policy.rs) applies them last, and only where their fields are missing.

One decision goes beyond the validated rule. A derived rain type also replaces a PTY 0 from ODAM or VSRT, because the station measured an amount for that hour. A PTY 1, 2 or 3 from those sources stays. Without this, a measured wet hour next to a dry representative-AWS value would stay unknown on the latest days. This case has no held-out truth, since the validation scored station codes only.

The stored summary identity now ends with `wet-bulb-rain-v1`. Daily totals stay in `values`: `sumRn` is the official value of its own row.

## Mountain and special ASOS stations, 2026-11-03

AK required that ASOS stations on mountains or in special areas are not used as-is for a town's local weather. This section records the current mapping, what outside sources do and the options. Nothing here is implemented yet.

### Current mapping

History maps a town to the nearest `isCityWeather` station within 100 km, by horizontal distance only (`nearest` in `observe.rs`; legacy [`policy.nearest`](../../../server/lib/history/policy.js#L291)). The current-weather path also takes the nearest city station (`near` in `stn.rs`). Legacy flags 38 stations as mountains ([`_checkMountain`](../../../server/lib/kmaScraper.js#L1593)), but its `_filterStnList` keeps a flagged station that is also a city station, and history does not read the flag.

Offline counts over the 777-station seed registry and the 4,369 sub-district rows of `base.csv`:

| Station | Altitude (m) | Towns mapped | Next-nearest city station if it were removed |
| --- | ---: | ---: | --- |
| 100 Daegwallyeong | 773 | 5 | Jeongseon 307 m, Gangneung 26 m, Inje 200 m (18–41 km) |
| 216 Taebaek | 713 | 15 | Bonghwa 322 m, Donghae 40 m, Uljin 50 m, Jeongseon 307 m (18–31 km) |
| 248 Jangsu (not flagged) | 406 | 13 | not computed |
| 271 Bonghwa (not flagged) | 322 | 9 | not computed |
| 217 Jeongseon (not flagged) | 307 | 9 | not computed |
| 102 Baengnyeong, 115 Ulleungdo, 169 Heuksando | 145, 223, 76 | 2, 4, 1 | a mainland or other-island station 79–219 km away |
| 185 Gosan, 188 Seongsan | 74, 18 | 6, 4 | Seogwipo or Jeju (28–39 km) |

Excluding the two flagged stations outright is worse for the towns beside them. Hwangji-dong in Taebaek, 0.4 km from station 216, would move to Bonghwa, which is 391 m lower and 26 km away. Daegwallyeong-myeon would move to Gangneung, 747 m lower and across the ridge. Other towns mapped to these stations, such as Samcheok Dogye-eup, may be much lower than the station, but the repository holds no town elevations, so the mismatch cannot be measured yet.

### What outside sources do

- **WMO siting classes:** representativeness is judged per measured parameter, not per station, and a poorly classed site can still be valuable for an application that needs that exact place ([WMO siting annex](https://old.wmo.int/extranet/pages/prog/www/OSY/Meetings/CBS-GCOS-LeadCentres_Hamburg2011/Annex_1_Siting.pdf)). The current WMO-No. 8 wording on mountain stations was not read; the PDF could not be extracted here.
- **Meteostat:** point data selects stations by distance and altitude difference, with defaults of 35 km and 350 m, and adapts temperature by altitude ([Meteostat Point](https://dev.meteostat.net/python/api/point)).
- **Weatherbit:** prefers a nearby station, shifts to reanalysis as distance grows and drops stations with significant issues (vendor claim, [Weatherbit](https://help.weatherbit.io/how-does-weatherbit-combine-data-sources/)).
- **Open-Meteo:** corrects temperature with a 90 m terrain model at about 0.7 °C per 100 m, including historical data ([Open-Meteo](https://openmeteo.substack.com/p/improving-weather-forecasts-with)).
- **Limits of altitude correction:**
  - A fixed lapse rate is often inaccurate, because it varies with season and cloud cover, and cold-air pooling undermines it ([Hydrol. Earth Syst. Sci. review comment](https://hess.copernicus.org/preprints/9/C3531/2012/hessd-9-C3531-2012.pdf), [AMS paper](https://ams.confex.com/ams/pdfpapers/79839.pdf)).
  - A Korean study found that distance-only interpolation misleads in mountains, and that a daily lapse rate improved minimum temperature at 267 stations ([Yun et al. 2000](https://koreascience.kr/article/JAKO200014714074295.page)).
  - Another Korean study links elevation-correction error to wind speed ([2014 study](https://koreascience.kr/article/JAKO201403359904213.page?lang=ko)).
- **KMA high-resolution grid:** a 500 m analysis of KMA and other agencies' stations with terrain effects, available from 1997, which KMA warns may differ from observations ([data.go.kr 15139478](https://data.go.kr/catalog/15139478/openapi.json)). Its operations, precipitation fields and access for this key were not verified.
- **Not found:** a KMA document naming which ASOS stations are unrepresentative or excluded from regional use. Station 100's `(산간)` address tag and the legacy list are the only labels seen.

### Options

| Option | Effect | Limit |
| --- | --- | --- |
| A. Remove flagged stations | Simple, no new data | Worse for the towns beside them; misses high unflagged stations |
| B. Select by distance and altitude difference; no station means no ASOS values for that town | Keeps Taebaek for Taebaek and removes it for lower towns; applies to all stations | Needs a static town elevation table from a public terrain model, plus a chosen threshold |
| C. Correct temperature by altitude | Keeps a value everywhere | Fails under inversions; cannot correct rain or type; shows a number nobody measured |
| D. Replace mountain towns with the KMA grid | Terrain-aware for temperature | New source, unverified; not a measurement |

Option B is recommended, with C rejected for measured history. Islands need their own limit: a station serves only its own island, because the alternative is far over the sea. Capes such as Gosan may need a per-field decision on wind, following WMO's per-parameter view.

### Offline review of option B, 2026-11-03

AK asked to review option B before any implementation. Nothing in `server2/` changed. Town elevations came from 26 public SRTM tiles (`elevation-tiles-prod` skadi, unauthenticated HTTPS, one attempt each; [SRTM data courtesy of the U.S. Geological Survey](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), public domain). Tiles and scripts are ignored local evidence under `reports/kma-town-elevation-20261103/`.

**Elevation quality.** Terrain at the registry coordinates of the 97 city stations differs from their registered altitude by a median of 14.6 m, and 90 stations are within 100 m. Seven are further off, up to 411 m at Jeongseon (terrain 718 m, registered 307 m). The registry coordinates of some stations therefore look wrong. Town coordinates carry the same risk, so one elevation sample cannot decide alone.

**Candidate rule.**

- An island station serves only its own county, and Jeju stations serve only Jeju. An island's own station keeps its towns regardless of altitude, since no alternative exists across the sea.
- Three elevation estimates are taken per town: the point, the median within 500 m and the lower quartile within 2 km.
- If any estimate is within the threshold of the nearest station, the nearest station stays. A town where only some estimates fit is counted as borderline and not changed.
- Otherwise the nearest station within 35 km that fits is used, when all three estimates pick the same one. Without one, the town uses no ASOS values.

| Altitude threshold | Unchanged | Borderline, unchanged | Moved | No ASOS values |
| ---: | ---: | ---: | ---: | ---: |
| 200 m | 4,314 | 26 | 16 | 10 |
| 250 m | 4,345 | 8 + 2 unsettled | 7 | 4 |
| 300 m | 4,357 | 2 | 4 | 3 |

These counts cover 4,366 towns, with a 35 km limit on replacements.

**Results at 200 m.**

- Daegwallyeong keeps Daegwallyeong-myeon, Yongpyeong-myeon and Hongcheon Nae-myeon. Bongpyeong-myeon and Jinbu-myeon, about 210–240 m lower, get no ASOS values.
- Taebaek keeps all of Taebaek city and four neighbouring towns. Samcheok Gagok-myeon moves to Uljin and Dogye-eup to Bonghwa. Seokpo-myeon is borderline.
- The rule also finds lower-station problems no list would: Namwon Unbong-eup (465 m, station 127 m) moves to Jangsu (406 m).

**Problems the review exposed.**

- Without a replacement limit, the rule sends towns 60–99 km away, such as Jecheon Mosan-dong to Taebaek.
- Without a keep-the-nearest rule, a distance limit removes low island towns that have no altitude problem.
- Many borderline towns are urban lowlands whose coordinates appear to sit on a hill, such as Busanjin-gu Danggam-dong. Jecheon Mosan-dong, 3 km from its station, is likely the same error despite agreeing estimates. `base.csv` coordinates need checking before these results are trusted.
- Chupungnyeong, a mountain-pass station at 245 m, keeps 23 towns, including central Gimcheon at about 70 m, because the difference stays under 200 m. An altitude rule does not address special exposure.
- Whether a replacement crosses a ridge was not checked. The 200 m threshold is a choice, not a validated value.

### Option B implemented locally, 2026-11-03

AK chose option B at 200 m and 35 km, no ASOS values when no station fits, Chupungnyeong kept, and Gosan and Seongsan without wind.

**Official coordinates.** The KMA grid and coordinate workbook (2026-10) was joined to the town list by name. Of 4,366 towns, 3,663 match a row and 404 match numbered parts. The remaining 299 have no official row and are not listed, so they keep their nearest station. Where a row exists, the repository coordinate differs by a median of 0 km and at most 3.2 km. The earlier suspicion about Busanjin-gu Danggam-dong was correct: at the official coordinate it is 31 m, not 276 m. Jecheon Mosan-dong has no official row, so its suspicious 538 m no longer removes its station.

**Result under the implemented rule, using the embedded registry.** 16 towns move and 9 towns use no station. The Rust rule reproduces these counts in a test over the whole town list.

| Change | Towns |
| --- | --- |
| Moved | Samcheok Gagok-myeon and Dogye-eup; Jeongseon Sindong-eup; Hoengseong Gangnim-myeon and Anheung-myeon; Hamyang Seoha-myeon; Hapcheon Gaya-myeon; Sangju Hwaseo-myeon; Yeongyang Subi-myeon; Cheongsong Hyeonseo-myeon; Namwon Ayeong-myeon, Unbong-eup and Inwol-myeon; Sunchang Bokheung-myeon; Jinan Bugwi-myeon; Cheongju Nangseong-myeon |
| No station | Samcheok Nogok-myeon; Yanggu Haean-myeon; Cheorwon Wonnam-myeon, Wondong-myeon and Imnam-myeon; Pyeongchang Bongpyeong-myeon and Jinbu-myeon; Hoengseong Dunnae-myeon; Geumjeong-gu Geumseong-dong |

The rule runs only under ASOS-primary, on both the history mapping and the current-weather station reads. Legacy replay is unchanged. The stored summary identity now ends with `station-altitude-v1`.

**Limits.**

- Whether a replacement crosses a ridge was not checked, and 200 m is a chosen value, not a validated one.
- The registry coordinates of some stations look wrong, such as Jeongseon. They affect distance only, since the rule uses each station's registered altitude.
- 20 borderline towns keep their nearest station because their estimates disagree. Some, such as Buk-gu Gupo 3-dong, have an official coordinate on a hillside.
- Stored daily ASOS summaries still use the legacy replay and keep the wind of Gosan and Seongsan. They do not change the response path checked here.
- Nothing was run against live traffic or a client build.

## Sources

[1] https://data.kma.go.kr/community/nuriLovePopup.do — KMA "동네예보 데이터 활용안내" (2025-05-16): ODAM uses representative AWS stations at 10-minute collection; portal ODAM files through the previous month and VSRT files through the previous day; APIHub `getUltraSrtNcst` base_date limited to the most recent day and `getUltraSrtFcst` to the most recent three days. Retrieved 2026-10-30 KST.
[2] https://data.kma.go.kr/community/board/detailBoard.do?bbrdTypeNo=1&pgmNo=96&bbrdNo=66383 — KMA ASOS answer: blank rain means no precipitation phenomenon; 0 means precipitation with a 0 amount.
[3] https://data.kma.go.kr/data/grnd/selectAsosList.do?pgmNo=36 — KMA ASOS dataset: precipitation reported at three-hour intervals from November to March.
[4] https://apihub.kma.go.kr/getAttachFile.do?fileName=API.pdf — KMA APIHub surface observation manual: `RN` winter three-hour cadence, `RN_DAY`, `WC`, `WW`, `IR`, `IX` definitions.
[5] https://data.kma.go.kr/resources/images/publication/%EA%B8%B0%ED%9B%84%ED%86%B5%EA%B3%84%EC%A7%80%EC%B9%A8%282021.5%29.pdf — KMA Climate Statistics Guidelines, May 2021, Appendix A §1.3.6: hourly phenomenon codes are recorded from the journal for the preceding hour.
