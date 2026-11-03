# External API inventory review — 2026-10-24

## Result and scope

The maintained [external API manual](../../reference/external-apis/README.md) and [inventory](../../reference/external-apis/inventory.json) describe checked-out application integration contracts at **82f7a4838dda046be966ee9c25c9cb66561d099d**, reviewed **2026-10-24 KST**. The source has 20 invoked KMA data.go.kr operations and four keyless KMA website request forms. The wider catalog has 102 entries, including SDK method groups, historical-native callers and 26 entries without an application invoker. **Those 102/76 figures are catalog coverage, not a count of 102/76 active production OpenAPIs.** Per-consumer status and grouping rules are explicit in the manual.

The review covered `server/`, `server2/`, shared `client/www/`, `web/`, and tracked `tw.ios/`, `ta.ios/`, widget and applewatch sources. Actual request builders/callers were checked, including methods hidden behind SDKs. Graft navigation, a sanitized host/path literal sweep and targeted source reads were reconciled with the older [external provider catalog](../../rewrite/external-providers.md). The older catalog is useful navigation but is not authoritative for current credentials or retirement status.

The sweep found 1,946 URL occurrences, predominantly lockfile/package downloads (1,616), vendor examples, first-party origins and documentation links. It removed query strings and masked IP/opaque segments before recording evidence. URL presence alone never established invocation. Tracked native trees were enumerated through Git because ignore rules can hide them from a normal file search. The final native follow-up found actual Ionic Analytics/User/Deploy calls; these were included as historical-native operations rather than discarded as vendor code.

Coverage exclusions: deployment/benchmark AWS control-plane tooling, package registries/installers, unused vendor methods, XML/license/source-comment URLs, OS sharing and store/social/browser navigation as independent provider transports, and our own first-party HTTP ingress (documented in the [internal endpoint catalog](../../rewrite/api-endpoint-catalog.md)). Confirmed OS sharing is still recorded with an explicit delegated status. No direct Flickr/VWorld/SNS sender invocation was found; no absence claim is made about every possible external binary or unsupported build.

## Provider specification versus implementation

Official sources below establish service identities and documented capabilities. Source links next to each manual claim establish the application's subset, bounds and quirks. A matched quote is a provenance checkpoint, not a proof that every adjacent claim follows from that sentence. No account approval, key, quota balance, production mode, client release or provider data response was verified.

Important distinctions retained:

- data.go.kr `serviceKey` and APIHub `authKey` are different access interfaces. The newest short-guide attachment contains APIHub typ02 examples; runtime data.go.kr URLs are identified separately. [1] [2] [16]
- The KMA usage page and VSRT/ODAM archive pages do not establish seven-day recovery through ordinary point endpoints. [6] [7] [8]
- APIHub ASOS/AWS/station batch interfaces remain research candidates. [4] [5] [11]
- APIHub mid alternatives also remain research-only; automation/equivalence/latency qualification is separate. [17]
- Modern ODAM lacks SKY/LGT; hourly ASOS cloud fraction does not restore PTY/LGT. Local history merge remains missing-only. Historical observation endpoints provide completed dates, separate from local seven-day range policy. [9] [10]
- Mid land/temperature/station ownership differs; provider coverage text and current field mapping are distinguished. [3]
- Portal titles, archive labels and contained DOCX names may differ: UV portal4.0/pathV5 is preserved explicitly. [21] [49]
- Pollen archive20260701/contained20240425 are also recorded separately. [22] [50]
- AirKorea has three dataset families; local server2 allowances are not approved account entitlement. [23] [24] [40]
- The AirKorea bundle includes observation and forecast operations; decoded model GIF forecasts are not observations. [51] [52]
- WAQI subindices are not measured concentrations. VC's route alias does not mean Dark Sky. [28] [29]
- Source timeout/cache/quota constants are not percentile measurements. S3 performance and consistency guidance is not an empty-S3 p95/p99 claim. [12] [14]
- S3 conditional-write and GetObject references support operation semantics, not provider-to-client timing. [13] [15]

## Retrieved artifact versions and hashes

All attachments were public documentation downloads without provider credentials or data requests. DOCX paragraph/table text was inspected, including operation names, parameters, fields and timing; no Word document was authored. ZIP outer labels are portal labels, not guaranteed dates for every contained document. The RSS PDF was downloaded but its body was not text-reviewed: local `pdftotext` and `pypdf` were unavailable, and no PDF-body contract is claimed. The point-guide artifact has a separate retained hash record in the [KMA provider review](kma-provider-review-2026-10-24.md#retained-identities-and-verification-limits).

| Public artifact | Version/context | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `warning-guide.zip` | Portal archive260601; contained generic warning DOCX (service metadata1.0) | 433,648 | `6cb5f8e52df4709d5e7daff129948a33620bf708b9f9abd405480e07b0b32ca4` |
| `zones-guide.zip` | Portal archive240715; contained forecast-zone guide (service metadata1.0) | 346,877 | `db0adf241dc08fc4a9afb56a8fac10f1b4768e33fd31e5e4c1128174c7efd013` |
| `uv-guide.zip` | Portal4.0 label; contained LivingWthrIdxServiceV5 | 1,620,487 | `c7c9b660e5bd43a7452f4082ab54d980bb6053031d8913dc399623f3d966cfc2` |
| `pollen-guide.zip` | Portal archive20260701; contained DOCX filename20240425 and 25Q1 area-code directory | 1,606,213 | `c885f5d09cb2690b4721a3077cd22e6ceaee41d3a45a45520335c82871e23c7d` |
| `airkorea-guide.zip` | 20260630 bundle; pollutionv1.4,statisticsv1.3,stationv1.2 among documents | 3,220,274 | `a7ade5483790051006d04359cfdd179e4e48d54e8345c8fd9d44ded2969936cb` |
| `air-stations-guide.zip` | Same20260630 bundle from station portal attachment | 3,220,274 | `a7ade5483790051006d04359cfdd179e4e48d54e8345c8fd9d44ded2969936cb` |
| `kasi-guide.docx` | Rise-set v1.2; revision2017-05-04 | 169,335 | `4912c578ebcfb7d9a5e5d89de7c378ec9b23782bd95b0a0aaa38902f0bbf5aeb` |
| `kma-rss.pdf` | Official RSS PDF; downloaded,body not text-reviewed | 295,167 | `f6f9dcf06066374b3ae2fda736c51c6f0f8f17983d57cf4ab85963f7cfb9c3a8` |

## Public source register

All sources were accessed on 2026-10-24. Sources1–17 reuse the same-day retained KMA/S3 research; remaining sources were retrieved for this manual. Numeric IDs deliberately retain a gap after correction of an incorrectly paired failed URL. Excerpts below are short verbatim evidence snippets checked against retained public text. They support source identity/context; detailed contract claims are cited in the manual next to source-code evidence.

| Citation | Retrieved source | Supporting excerpt |
| --- | --- | --- |
| [1] | KMA short and ultra-short forecast service | “초단기실황, 초단기예보, 단기((구)동네)예보, 예보버전 정보를 조회하는 서비스입니다. 초단기실황정보는…” |
| [2] | KMA APIHub short grid and point specifications | “- 10분 간격 발표 tmef 발효시간 년월일시(KST) -…” |
| [3] | KMA mid-range forecast service | “중기예보는 단기예보 이후 향후 11일까지의 기상전망, 육상·해상 날씨,…” |
| [4] | KMA APIHub ASOS hourly and daily ranges | “* 최대 31일 조회 가능 stn 지점번호 해당…” |
| [5] | KMA APIHub AWS minute cloud phenomena and daily data | “전운량(1/8) 1.6 AWS2 시정자료 API 활용신청 https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min_vis?tm2=201507140812&stn=0&disp=0&help=1&authKey={인증키입력} URL복사…” |
| [6] | KMA grid data usage guide 2025-05-16 | “base_date는 최근 1일까지만 가능하며, nx, ny의 격자좌표를 입력하여…” |
| [7] | KMA ultra-short forecast historical files | “※ 자료제공기간은 2010.6. 부터 조회일 전일까지 ※ (2016.4.27.…” |
| [8] | KMA ultra-short observation historical files | “* 2018년 7월11일 이전 자료는 AWS 관측값이 아닌…” |
| [9] | KMA ASOS hourly JSON service | “조회 기간 종료일(YYYYMMDD) (전일(D-1) 까지 제공) 종료시 endHh…” |
| [10] | KMA ASOS daily JSON service | “조회 기간 종료일(YYYYMMDD) (전일(D-1)까지 제공) 지점 번호 stnIds…” |
| [11] | KMA station metadata including historical time | “해당 시점에 존재하는 지점목록 (없으면 현재시각) stn 지점번호…” |
| [12] | AWS S3 performance guidelines | “horizontallyUse byte-range fetchesRetry requestsCombine Amazon S3 and Amazon…” |
| [13] | AWS S3 conditional writes | “HTTP If-None-Match or If-Match header. The If-None-Match header…” |
| [14] | AWS S3 consistency model | “Amazon S3 provides strong read-after-write consistency for PUT…” |
| [15] | AWS S3 GetObject range and version semantics | “Amazon S3 doesn't support retrieving multiple ranges of…” |
| [16] | KMA short service guide 261019 in public 2610 ZIP | “※ 매시간 30분에 생성되고 10분마다 최신 정보로 업데이트(기온,…” |
| [17] | KMA APIHub mid-range products | “중기예보란 예보일로부터 4일(최대5일)에서 10일까지의 기간에 대한 예보를 뜻합니다.…” |
| [18] | Rapid7 InsightOps NodeJS logging | “NodeJS \| InsightOps Documentation Welcome Log Management (InsightOps)…” |
| [19] | KMA weather warning service | “기상특보 조회서비스 \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기…” |
| [20] | KMA forecast-zone metadata service | “예보구역정보 조회서비스 \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기…” |
| [21] | KMA life index service portal | “생활기상지수 조회서비스(4.0) \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기…” |
| [22] | KMA pollen risk service | “꽃가루농도위험지수 조회서비스(3.0) \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기…” |
| [23] | AirKorea pollution observations and forecast | “대기오염정보 \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기 이…” |
| [24] | AirKorea station metadata | “측정소정보 \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기 이…” |
| [25] | KASI rise and set service | “출몰시각 정보 \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기…” |
| [26] | Google Air Quality current conditions reference | “currentConditions.lookup \| Air Quality API \| Google for…” |
| [27] | OpenWeather Air Pollution API | “Air Pollution Getting Started Weather APIs Pricing Marketplace…” |
| [28] | Visual Crossing Timeline Weather API | “Timeline Weather API Documentation \| Visual Crossing Skip…” |
| [29] | WAQI JSON API | “JSON API $ curl -i "http://api.waqi.info/feed/shanghai/?token=demo" The JSON…” |
| [30] | Kakao Local REST API | “좌표로 행정구역정보 변환 기본 정보 메서드URL인증 방식 GEThttps://dapi.kakao.com/v2/local/geo/coord2regioncode.${FORMAT}…” |
| [31] | Google Geocoding requests | “Geocoding request and response \| Geocoding API \|…” |
| [32] | Google Time Zone requests | “Time Zone requests and responses \| Time Zone…” |
| [33] | Google Places Autocomplete | “Autocomplete \| Maps JavaScript API \| Google for…” |
| [34] | Firebase HTTP v1 message submission | “HTTP v1 API \| Firebase Cloud Messaging Skip…” |
| [35] | Google OAuth service-account exchange | “Service Accounts Sign In with Google App Verification…” |
| [36] | Firebase Analytics | “Google Analytics for Firebase Skip to main content…” |
| [37] | Firebase Remote Config | “Remote Config Skip to main content Build Build…” |
| [38] | Google Mobile Ads SDK | “Mobile Ads SDK (Legacy) \| Android \| Google…” |
| [39] | Google User Messaging Platform consent | “User Messaging Platform (UMP) SDK Set up UMP…” |
| [40] | AirKorea regional statistics | “대기오염통계 현황 \| 공공데이터포털 콘텐츠 바로가기 푸터 바로가기…” |
| [41] | New Relic Node.js agent (retired repository integration) | “Install the Node.js agent \| New Relic Documentation…” |
| [43] | AWS S3 PutObject | “PutObject - Amazon S3 View a markdown version…” |
| [44] | AWS S3 ListObjectsV2 | “ListObjectsV2 - Amazon S3 View a markdown version…” |
| [45] | AWS CloudFront CreateInvalidation | “CreateInvalidation - Amazon CloudFront View a markdown version…” |
| [46] | Firebase Crashlytics | “Crashlytics Skip to main content Build Build Get…” |
| [47] | KMA warning public guide (retrieved 2026-10-24) | “기상청 기상특보 조회서비스 Open API 활용가이드 center-114300목 차목…” |
| [48] | KMA forecast-zone public guide (retrieved 2026-10-24) | “기상청 예보구역정보 조회서비스 Open API 활용가이드 center-114300목 차목…” |
| [49] | KMA LivingWthrIdxServiceV5 guide | “LivingWthrIdxServiceV5 API명(국문) 생활기상지수 조회서비스 API 설명 개선된 자외선지수,…” |
| [50] | KMA pollen V3 guide (contained DOCX filename 20240425) | “꽃가루농도위험지수(참나무)조회] 상세기능명세 3 2) [꽃가루농도위험지수(소나무)조회] 상세기능명세 14 3)…” |
| [51] | AirKorea public guide 20260630 (pollution attachment) | “국가대기오염정보 활용 안내6 HYPERLINK \l "_Toc54881013"2.1 계정 신청방법62.2…” |
| [52] | AirKorea public guide 20260630 (station attachment) | “국가대기오염정보 활용 안내6 HYPERLINK \l "_Toc54881013"2.1 계정 신청방법62.2…” |
| [53] | KASI rise-set guide v1.2 | “출몰시각 정보제공 서비스_v1.2.docx 개정 이력 버 전 변경일…” |
| [54] | AWS EC2 IMDSv2 | “session token that defines the session duration, which…” |
| [55] | OpenAI Responses create reference | “Create a response Retrieve a response Delete a…” |
| [56] | OpenAI Structured Outputs guide | “Structured Outputs is a feature that ensures the…” |
| [57] | AWS S3 HeadObject | “HeadObject - Amazon S3 View a markdown version…” |
| [58] | Google legacy Places Autocomplete | “Autocomplete \| Maps JavaScript API \| Google for…” |
| [59] | Branch Cordova, PhoneGap and Ionic SDK | “Cordova, PhoneGap, and Ionic SDK…” |

## Access gaps and verification limits

- MFDS landing page returned zero extractable content; no normative `/api/risk.do` public specification was retrieved. Its contract is source-backed and marked website JSON. This was not a data-endpoint availability check.
- KAQ map-case HTML, fixed forecast GIF paths, old WAQI `obs.en.json`, Weather Unlocked old routes, historical Ionic services, old MET/AccuWeather/Foreca test modules have no retrieved normative current-version specification. Their entries say source-only/legacy/adapter-only as appropriate.
- Branch direct downloads returned403, but public web retrieval of the official Cordova page succeeded; only the successfully retrieved page is registered. [59]
- The wrong Rapid7 `node-js` URL returned404; the official `nodejs` replacement succeeded and is the only registered Rapid7 source. [18]
- Old Firebase migration, Apple receipt and Google subscription-reference probes returned404; these failures are not provider shutdown-date or live operation evidence.
- Generic OpenAI reference pages exceeded the retrieval cap; the official typed Responses reference and Structured Outputs guide succeeded. [55] [56]
- No real service credentials, authenticated provider/data request, collection runtime, cloud mutation/inspection, build, device delivery, current provider entitlement, billing quote, production behavior or p95/p99 was tested. Public documentation retrieval is the only network activity in this review.
- Worker coverage review used the same available model/provider family. It is a source coverage check, not a cross-provider review, and does not substitute for live compatibility qualification.

## Verification record

Checks are recorded after the final manual/inventory revisions. Citation verification checks ID/URL consistency and evidence presence; it does not prove scientific equivalence or account availability. Link/anchor checks are local source/artifact checks and do not turn every public URL into a live API test.

| Check | Result / scope |
| --- | --- |
| Inventory validation | Passed: 102 unique IDs, valid status/invoker relationships, all entries present in their linked manual section; 24 invoked KMA request forms. |
| Local links and fragments | Passed: 307 local file/heading/source-line references across the six manual pages, this evidence record and architecture index. |
| Inventory source anchors | Passed: 170 existing file/in-range line references. This is navigation validation, not automatic semantic proof. |
| Official references | Passed: inventory official-document URLs map to the retained 58-source register. Credential-shaped content/query checks found no concrete credential in the new manual/inventory. |
| Citation consistency | Passed: `sources.py verify --strict --evidence`; all 58 registered sources cited with retained matched excerpts, no unknown/unused IDs. The prose coverage heuristic is not a sourcing-quality score. |
| Source coverage audits | Completed in three bounded KMA, weather/air/life and support/native reviews. All 14 reported corrections/optional precision items were applied and rechecked; no reported finding remains unresolved. |
| Artifact retention | Passed: `python3.11 scripts/check-artifact-policy.py --staged` on a temporary index containing the intended manual paths and existing uncommitted maintained link targets. Real index SHA-256 remained unchanged; no actual staging/commit. |
| Runtime/build/performance | Not run: documentation-only task. No collection, provider-data request, build, deployment or latency test. |

The audits corrected the native AIR-SIDO adapter-only status, legacy/native VC allowance versus fixed funding, FCM success-body validation, native Google parameter scope, S3 miss handling, legacy UV HTTP and LGT units, retry attempt counting and per-operation inventory bounds. Existing user changes and the earlier Korean acquisition diagram/design were preserved. No build/cache output was created by the workers, so no Cargo cleanup was needed. Maintained changes stay under `docs/`; task-local raw research, helper scripts and audit logs remain ignored.

## Sources

[1] https://www.data.go.kr/data/15084084/openapi.do — KMA short and ultra-short forecast service
[2] https://apihub.kma.go.kr/apiList.do?seqApi=10 — KMA APIHub short grid and point specifications
[3] https://www.data.go.kr/data/15059468/openapi.do — KMA mid-range forecast service
[4] https://apihub.kma.go.kr/apiList.do?seqApi=2 — KMA APIHub ASOS hourly and daily ranges
[5] https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=239 — KMA APIHub AWS minute cloud phenomena and daily data
[6] https://data.kma.go.kr/community/nuriLovePopup.do — KMA grid data usage guide 2025-05-16
[7] https://data.kma.go.kr/data/rmt/rmtList.do?code=410&pgmNo=571 — KMA ultra-short forecast historical files
[8] https://data.kma.go.kr/data/rmt/rmtList.do?code=400&pgmNo=570 — KMA ultra-short observation historical files
[9] https://www.data.go.kr/data/15057210/openapi.do — KMA ASOS hourly JSON service
[10] https://www.data.go.kr/data/15059093/openapi.do — KMA ASOS daily JSON service
[11] https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=317 — KMA station metadata including historical time
[12] https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html — AWS S3 performance guidelines
[13] https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html — AWS S3 conditional writes
[14] https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html — AWS S3 consistency model
[15] https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html — AWS S3 GetObject range and version semantics
[16] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007732424&fileDetailSn=1 — KMA short service guide 261019 in public 2610 ZIP
[17] https://apihub.kma.go.kr/apiList.do?seqApi=10&seqApiSub=287 — KMA APIHub mid-range products
[18] https://docs.rapid7.com/insightops/nodejs — Rapid7 InsightOps NodeJS logging
[19] https://www.data.go.kr/data/15000415/openapi.do — KMA weather warning service
[20] https://www.data.go.kr/data/15057111/openapi.do — KMA forecast-zone metadata service
[21] https://www.data.go.kr/data/15085288/openapi.do — KMA life index service portal
[22] https://www.data.go.kr/data/15085289/openapi.do — KMA pollen risk service
[23] https://www.data.go.kr/data/15073861/openapi.do — AirKorea pollution observations and forecast
[24] https://www.data.go.kr/data/15073877/openapi.do — AirKorea station metadata
[25] https://www.data.go.kr/data/15012688/openapi.do — KASI rise and set service
[26] https://developers.google.com/maps/documentation/air-quality/reference/rest/v1/currentConditions/lookup — Google Air Quality current conditions reference
[27] https://openweathermap.org/api/air-pollution — OpenWeather Air Pollution API
[28] https://www.visualcrossing.com/resources/documentation/weather-api/timeline-weather-api — Visual Crossing Timeline Weather API
[29] https://aqicn.org/api — WAQI JSON API
[30] https://developers.kakao.com/docs/latest/ko/local/dev-guide — Kakao Local REST API
[31] https://developers.google.com/maps/documentation/geocoding/requests-geocoding — Google Geocoding requests
[32] https://developers.google.com/maps/documentation/timezone/requests-timezone — Google Time Zone requests
[33] https://developers.google.com/maps/documentation/javascript/place-autocomplete — Google Places Autocomplete
[34] https://firebase.google.com/docs/cloud-messaging/send/v1-api — Firebase HTTP v1 message submission
[35] https://developers.google.com/identity/protocols/oauth2/service-account — Google OAuth service-account exchange
[36] https://firebase.google.com/docs/analytics — Firebase Analytics
[37] https://firebase.google.com/docs/remote-config — Firebase Remote Config
[38] https://developers.google.com/admob/android/quick-start — Google Mobile Ads SDK
[39] https://developers.google.com/admob/android/privacy — Google User Messaging Platform consent
[40] https://www.data.go.kr/data/15073855/openapi.do — AirKorea regional statistics
[41] https://docs.newrelic.com/docs/apm/agents/nodejs-agent/installation-configuration/install-nodejs-agent — New Relic Node.js agent (retired repository integration)
[43] https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html — AWS S3 PutObject
[44] https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html — AWS S3 ListObjectsV2
[45] https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html — AWS CloudFront CreateInvalidation
[46] https://firebase.google.com/docs/crashlytics — Firebase Crashlytics
[47] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003648415&fileDetailSn=1 — KMA warning public guide (retrieved 2026-10-24)
[48] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002950397&fileDetailSn=1 — KMA forecast-zone public guide (retrieved 2026-10-24)
[49] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003684430&fileDetailSn=1 — KMA LivingWthrIdxServiceV5 guide
[50] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003674579&fileDetailSn=1 — KMA pollen V3 guide (contained DOCX filename 20240425)
[51] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003666340&fileDetailSn=1 — AirKorea public guide 20260630 (pollution attachment)
[52] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003666341&fileDetailSn=1 — AirKorea public guide 20260630 (station attachment)
[53] https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002694817&fileDetailSn=1 — KASI rise-set guide v1.2
[54] https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html — AWS EC2 IMDSv2
[55] https://developers.openai.com/api/reference/typescript/resources/responses/methods/create — OpenAI Responses create reference
[56] https://developers.openai.com/api/docs/guides/structured-outputs — OpenAI Structured Outputs guide
[57] https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html — AWS S3 HeadObject
[58] https://developers.google.com/maps/documentation/javascript/legacy/place-autocomplete — Google legacy Places Autocomplete
[59] https://help.branch.io/developer-hub/docs/cordova-phonegap-ionic — Branch Cordova, PhoneGap and Ionic SDK
