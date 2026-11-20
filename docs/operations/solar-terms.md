# Korean solar-term calendar on server1

The forecast presenter looks up a Korean civil date in memory. Calendar clients can independently request `GET /calendar/v1/kr/solar-terms/{year}` without location, units, language or credentials. The annual resource always returns Korean names for all 24 events. The [client delivery plan](../../plans/issue-3050.md) specifies which events can enter the weather summary.

## Reading the calendar

A successful body includes `year`, `timeZone: "Asia/Seoul"`, `status`, `revision`, `officialEdition` and chronological `terms`. Each term has a stable longitude ID, `nameKo`, effective `date` and `corrected` flag. A calculated snapshot has null edition metadata. A verified snapshot identifies the gazette notice, source URL and publication date. Revalidate a cached year with its ETag after one hour. On 200 replace the complete year; on 304 retain it. A source failure leaves readers on the last complete revision. A malformed year gets 400, an out-of-horizon year gets 404, and unavailable in-range data gets 503.

Startup calculates the current KST year plus 20 future years. Set `SOLAR_TERMS_FUTURE_YEARS` to an integer from 20 to 50 on every server1 worker to extend coverage. Preparation stages one more year privately so the first lookup after KST New Year succeeds. The service bundles the independently checked 2026 and 2027 editions for cold starts. The service and gather workers need access to the same Mongo database.

## Calculation and source

The pinned MIT-licensed Astronomy Engine 2.1.19 uses a truncated VSOP Earth series, light travel time, true ecliptic of date, and its default Espenak–Meeus delta-T model. We bracket each apparent geocentric longitude crossing within its half-month and ask `SearchSunLongitude` for its UT-based JavaScript Date. The calendar projects that instant into UTC+09. Future civil dates close to midnight are sensitive to model error and future time-scale differences. The replay output flags events within 30 minutes of KST midnight for inspection; this is a screening window. Korean date corrections leave computed instants intact. [Astronomy Engine](https://github.com/cosinekitty/astronomy) · [KASI official almanac archive](https://astro.kasi.re.kr/kor/life/post/almanac)

Only `SERVER_MODE=gather` fetches official documents. Once each KST day when Mongo is available, it checks this year's published almanac. From June 1 it also checks the following year. It follows the KASI official almanac entry to its electronic-gazette notice and downloads that notice's PDF using the gazette's content download operation. The gather host needs HTTPS access to `astro.kasi.re.kr` and `www.gwanbo.go.kr`, and Poppler's `pdftotext` on PATH. The parsed PDF must identify the publisher, notice number, publication date and requested calendar year, and contain the 24 known terms with unique, valid dates in order. A missing publication, changed document layout or extractor failure logs the year and retries the following KST day. A regular request never invokes the extractor.

The `krSolarTermEditions` collection retains one atomic Mongo document per year and official publication order, including PDF bytes, SHA-256 digest, verification time and algorithm version. The highest valid publication date and notice serial for the year wins. Concurrent inserts of the same document converge through its unique key. A different digest or different dates for the same edition trigger a conflict for operator inspection. Failed or older writes preserve the existing winner. Workers refresh the in-memory snapshots every minute and after opening their DB connection. On restart, reads for the current and following year return 503 until the initial Mongo restore finishes, so an old seed cannot briefly supersede a previous correction. More distant calculated years remain available. After a completed restore an unavailable database leaves the last loaded snapshots in memory. A source outage during or after restart permits recovery from Mongo. A corrected edition may take one refresh interval to reach all serving workers, plus the remaining HTTP freshness period on existing annual responses.

## Operator checks

Run from the repository root with installed server dependencies. The first command checks the real official archive and PDF. The second replays a retained original and its canonical viewer URL without network access. Both commands print the edition digest and calculated instant, calculated date, official date and correction decision for every term. Neither command writes the database.

```sh
node server/utils/solar-term-almanac.js 2027
node server/utils/solar-term-almanac.js 2027 /path/to/2027.pdf 'https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001782374733940000&tocId=I0000000000000001782199865342000&isTocOrder=N'
node server/test/offline/solar-terms.test.js
```

The offline suite compares official dates, checks 51 full years and exercises the HTTP statuses, ETag revalidation, incomplete publications, concurrent corrections, restart and KST rollover. To rerun the persistence scenarios against a disposable local Mongo compatible with the pinned driver, set `SOLAR_TEST_MONGO_PORT` to its loopback port. The test creates a uniquely named test database.

Reference checks on 2026-11-20 matched all 96 published dates in the 2024–2027 gazettes. Parser fixtures preserve the relevant factual rows in the 2024 and 2027 layout variants. The 2026 and 2027 bootstrap files contain only edition identity, provenance and dates. [2024 gazette](https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001687328191439000&tocId=I0000000000000001686831567351000&isTocOrder=N) · [2025 gazette](https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001718691575469000&tocId=I0000000000000001718610362021000&isTocOrder=N) · [2026 gazette](https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001750933230079000&tocId=I0000000000000001750814485377000&isTocOrder=N) · [2027 gazette](https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001782374733940000&tocId=I0000000000000001782199865342000&isTocOrder=N)

Before public enablement, verify that the deployed ingress forwards `/calendar/v1/kr/solar-terms/{year}` to the intended service origin, compare its ETag and response with the origin, and confirm the gather worker can publish a complete official edition. This feature changes the Node origin. Deployed edge routing and production database capabilities require separate operational checks.
