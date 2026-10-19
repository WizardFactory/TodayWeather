# Issue 2831 verification — 2026-10-19 KST

Implementation base: `1e31ac1ee91e916f9c36162ff474c4386b36ecd4`.
Scope: legacy server; pre-merge only. No deployment/restart or merge.

## Captured baseline and limitations

Read-only requests at 00:37–00:38 KST found Myeong-dong origin and CDN already
using fresh AirKorea current observations (`2026-10-19 00:00`, AQI 59). CDN was a
cache miss. Stored AirKorea publication was `2026-10-18 23:00`. An unversioned
public coordinate request also returned recovered AirKorea current values. These
observations do not prove the repair or independently establish provider allowance.

A subsequent normal coordinate-provider request captured actual OpenWeather
current-only `airInfo` (`2026-10-19 00:42`, AQI 52, PM10 19.22, PM2.5 10.17).
The [retained projection](../../../../server/test/offline/fixtures/air/issue-2831-current-only.json)
and [provenance](../../../../server/test/offline/fixtures/air/issue-2831-current-only.provenance.json)
record the URL, raw response digest and unmodified projected bytes. This capture
uses `/v000903/dsf/coord/...`; it is not the original incident capture or a claim
that domestic fallback was still failing at capture time. The local regression
supplies stale domestic observations independently of that current-only snapshot.

## Reproduction and checks

- `air-forecast-observation-fallback.test.js`: before implementation, 11 of 12
  checks failed for missing station context/forecast enrichment and unsafe absent
  input. After repair and coverage expansion, 17 checks pass. Covers single/list,
  omitted/explicit/KAQ selection, stale observations, empty/unnamed metadata,
  provider location-name rejection, invalid/expired/partial data, horizon,
  metadata/observation/forecast store errors, publication provenance and safe current-only behavior.
- Existing `air-forecast-fallback.test.js`: 27 checks pass, preserving #2770's
  valid/partial KAQ preference, error/unavailable fallback, `24:00`, +24 h cutoff,
  explicit AirKorea and neither-source behavior.
- Separate `air-forecast-observation-http-smoke.js`: real loopback HTTP and MongoDB
  7.0.14, production station/observation schemas, existing stored forecast reader,
  actual legacy middleware and the exact installed-client chart-data block.
  Captured OpenWeather current values/attribution stay byte-equivalent after
  enrichment in single/list × KAQ/explicit/omitted flows. Each PM pollutant gets
  23 stored future hours through 23:00, publication October 18 05:00; the chart
  obtains 11 numeric future PM10/PM2.5/AQI slots. Empty stores and absent station
  metadata retain safe current-only behavior. This is local isolated data, not
  live provider or production DB validation.

Commands and prerequisites: [operations](../../../operations/air-forecast-fallback.md).
The full legacy offline suite passed locally on Node 24.19.0. Focused regression
and real Mongo/HTTP smoke also passed on Node 16.20.2. The added lagging-observation regression pins explicit AirKorea to
strictly future slots; the HTTP smoke uses the actual legacy air middleware
chain, while the separate #2770 smoke covers the full weather router. Archify validation, delivery,
strict artifact and browser checks passed; light/dark captures were visually
inspected at desktop sizes. CI and independent review are recorded on the PR at the actual candidate revision. Generated detailed
runs remain local; the fixture, this selected evidence and durable PR comments
survive CI artifact expiration.

## Remaining live acceptance

After separately approved rollout, compare origin/public responses while current
source is non-AirKorea against the DB station/hour values and provenance. Keep
acquisition freshness separate and keep the issue open until that proof exists.
[#2636](https://github.com/WizardFactory/TodayWeather/issues/2636) still owns
observation/publication acquisition limitations.

## AK historical-observation extension (2026-10-19)
User requested restoring stored AirKorea past observations with provider current. Three new behavior assertions failed before implementation (past rows absent, zero absent), then focused 21 passed. The existing isolated HTTP/Mongo smoke now seeds stale 10:00/14:00/15:00/16:00 KST observations and retains the original captured OpenWeather current-only baseline (history and forecast suppressed for baseline). Six single/list × KAQ/AirKorea/omitted flows return four numeric past PM/AQI slots with actual station/source, three visible past chart slots, exact provider current, 23 stored future PM rows and 11 visible future chart slots. Actual fixture values/provenance and future publication remain unchanged. No live rollout proof or production mutation is claimed.

Executed for this extension: focused21 on Node16.20.2 and Node24.19.0; full `npm --prefix server run test:offline` on Node24; real Mongo/HTTP/chart smoke on both runtimes. Archify finalize passed validate/deliver/strict artifact/browser gates; visual-check passed and 1440 light / 2048 dark captures were inspected. No client implementation, schema, dependency, provider, key, quota, acquisition, deployment or restart change. The unchanged smoke cleanup stops its temporary listener/Mongo. The final independent review and CI status are recorded on PR #2833 at the exact published candidate.
