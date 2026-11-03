# ASOS original observations — 2026-10-25

These unedited JSON bodies are KMA observations for public Seoul station 108,
2026-10-18 through2026-10-24, retrieved at2026-10-25 19:16 KST. They contain no
service key, request URL, account metadata or private/user location.

| Body | Operation under apis.data.go.kr/1360000 | Bytes | SHA-256 |
| --- | --- | --- | --- |
| asos-hourly-108-20261018-20261024.json | AsosHourlyInfoService/getWthrDataList | 85712 | 0f632a75700f91e629793cc742624f28ce7d325b01b26a575ccf1688772fa0c0 |
| asos-daily-108-20261018-20261024.json | AsosDalyInfoService/getWthrDataList | 7565 | 7837028411118dfc528f78ecb3c28a6f86cff4e1c77852a7c42f32eeb84ddc3f |

Source: Korea Meteorological Administration; [hourly service](https://www.data.go.kr/data/15057210/openapi.do),
[daily service](https://www.data.go.kr/data/15059093/openapi.do).
Korea Open Government License Type 1 (source attribution), as listed by the portal.
The test asserts acquired coverage independently from unqualified blank-field
semantics. It does not certify seven-day full weather closure, station coverage,
real end-to-end latency or equivalence with captured grid forecast history.
The actual rain-QC property is `rnQcflg`, blank on124rows and`9` on44rows;
`rnQcflag` is absent. An early diagnostic inspected the latter misspelling, and
an earlier prose correction incorrectly described all flags as blank. These
counts are from the unchanged original. The parser accepts both spellings;
that behavior does not qualify a missing rain-QC definition. All18nonblank
phenomenon codes in this body are01, including8with numeric rain0.0.

## Winter controls retrieved 2026-10-26 KST

Two further fixed requests retrieved Seoul 108 observations for 2024-11-26 through 2024-11-28
through the same official hourly/daily operations at 00:48 KST. These are exact
original bodies, without credentials or authenticated request URLs.

| Body | Bytes | SHA-256 |
| --- | ---: | --- |
| asos-hourly-108-20241126-20241128.json | 36955 | f8a16e10086139fd2f7b849b5929a9d70cd40c12ce6c9ce2694a5c3f402422a1 |
| asos-daily-108-20241126-20241128.json | 4633 | 1be9f51a966912f165291b254fa5c6d2fdcd85d0026ee71cb6f755d853979a25 |

The 72 hourly rows include 20 numeric precipitation amounts, all at three-hour
marks, and 52 blank amounts with QC9. Rain, sleet, snow and combined domestic
phenomenon codes occur. The eight amounts ending at 03:00..24:00 sum to the
official daily amounts of 26.0 and 22.4 mm for November 26/27. This corroborates
the ending-three-hour interpretation for these two days and tests the following
midnight explicitly. It does not qualify every winter interval, repair QC9,
split three-hour quantities into hourly amounts or certify a full response.
Daily journals contain continuation across midnight and visibility annotations;
the restricted summer journal experiment does not parse them.

## Journal rejection controls retrieved 2026-10-26 KST

Two finite source-only profiles made four and six data.go.kr HTTP requests, respectively, using the same official hourly/daily operations above. Each returned HTTP200/resultCode00 and its full single-page result. Bodies contain public station observations only; credentials and authenticated URLs are excluded. These originals preserve failed or uncertain source controls, not qualified full-history response inputs.

| Body | Bytes | SHA-256 |
| --- | ---: | --- |
| asos-hourly-159-20261018-20261024.json | 86143 | 1b08a7c18643b062d6eda5d0c25214bd5cb5ceedef0dc5c086f1647b485d835d |
| asos-daily-159-20261018-20261024.json | 8861 | bfa15be42084eaa30af9740d9bad908103f8d6621d9865e1d444d134c547b75d |
| asos-hourly-184-20261018-20261024.json | 86254 | 7e61a1d5e5be5c981c642a5ad63db8f71ef5211a725b38dd62c01f1799c79c73 |
| asos-daily-184-20261018-20261024.json | 8631 | e0261db42f43142e943a57ce2bc27d124000f3bcbc27a72f7394f2927b090bb6 |
| asos-hourly-112-20250127-20250130.json | 49149 | 8dd36fd5ecdd5d189a8066288862b55c6d2efb1df4a7aeb4979dea499d07bfa3 |
| asos-daily-112-20250127-20250130.json | 4964 | aa4e3d51bd3141289b8edbffa8af0be5cba1fd04772f5c069b63b7de273ec34c |
| asos-hourly-105-20250302-20250305.json | 48756 | 75d908c4a746b922169fe2ee983d8cc813f854f745528c61c47718556b1f57dc |
| asos-daily-105-20250302-20250305.json | 4203 | 2b3819d46d7220d4ee6a17fcb6ad79a7b6f194efb39246068067cc2b6dcda14c |
| asos-hourly-165-20261011-20261014.json | 49137 | 780f10335a08b8145fe4b1876c31757393b003f8b2c009952ba834ac0c7bdae0 |
| asos-daily-165-20261011-20261014.json | 4622 | 21ed40726407cad2efc7fab51bdb2918ced2a3a6b75579eb3761b3d9cfb23db3 |

Busan159 and Jeju184 each return168hours/7days for October18–24,2026. The pre-call frozen candidate rejected Busan drizzle and misread Jeju intensity-first checkpoints; its two Jeju mismatches remain recorded. The corrected offline replay preserves Jeju01:00–03:00 on October21 as unknown, rather than inventing an onset or no-rain interval. This correction is post hoc.

A separately frozen corrected candidate retrieved96hours/4days per new station: Incheon112 (January27–30,2025), Gangneung105 (March2–5,2025), and Mokpo165 (October11–14,2026). Incheon has trace rain0.0 at January28 21:00 despite no journal precipitation in the preceding three-hour window. Gangneung has numeric daily rain with empty journals on all four days. Mokpo returns an odd-length phenomenon string `1` at October13 23:00; the strict comparator rejects it. Native mapping was not broadened for this raw spelling. These cases fail the fixed gate and must not be excluded to claim agreement.

The new tool supports the retained winter and continuation syntax for diagnostics; parser support does not establish missing-journal semantics, station staffing, hourly quantities or LGT. There is no runtime journal fallback. The rain amount is checked separately because the official guideline derives hourly phenomenon codes from the daily journal.

## Phenomenon-coverage controls retrieved 2026-10-30 KST

The fixed profile `asos-qc9-structure-20261030` made exactly 16 data.go.kr requests with no retries or redirects, using the same official hourly/daily operations. All returned HTTP 200 with `resultCode` 00 and the complete single page. Six bodies are kept as exact originals; they contain public station observations only, without credentials or authenticated URLs. They are precipitation-guard regressions, not qualified full-history inputs. See the [2026-10-30 research](../../../../docs/evidence/research/kma-history-gap-options-2026-10-30.md).

| Body | Bytes | SHA-256 | Case it covers |
| --- | ---: | --- | --- |
| asos-hourly-101-20260701-20260731.json | 379820 | 6fcc6a3715a4d6f40f9558ccde2f10fc01278da32ce1e4ac719a8f3f5a54b042 | Chuncheon: no phenomenon codes on any of 180 wet hours |
| asos-daily-101-20260701-20260731.json | 32259 | 245ce2f82c08d42b913fd968c7c7d2bf5315f4062c19a3d1176bf93dd377adde | Chuncheon daily totals, empty journals |
| asos-hourly-143-20260701-20260731.json | 368326 | 9a49054fc3fc87ad0b44942bbe6039590d1f7be03fbaef2d02cf59fb9dae80c7 | Daegu: codes only 09:00–19:00; QC9 blocks on dry days stay unknown |
| asos-daily-143-20260701-20260731.json | 32344 | c3445122358d926a2d113d74909d1e39effbb9272e6902f5c9651d6c8000b625 | Daegu daily totals |
| asos-hourly-156-20260701-20260731.json | 368311 | 0a1c5349d59c8f659c43d9557a966cec021b767075a02e3a27769a819d812666 | Gwangju: codes only 09:00–19:00; QC9 hours with rain codes; numeric 0.0 flagged QC9 |
| asos-daily-156-20260701-20260731.json | 32839 | e8294471b243b55fb941ae47d67ac37a82c22cad60eddadedffa699eae5d1336 | Gwangju daily totals |

The other ten bodies of the profile (Daejeon 133, Gangneung 105 July, Suwon 119, Jeonju 146, Cheongju 131) remain in the ignored run directory with their hashes recorded in the research document.
