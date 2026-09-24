// Five credential-free public GETs from an unrelated HTTPS browser origin.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeWeather, normalizeNation, normalizeWarnings, DEFAULT_UNITS, PLACES } from '../../../packages/weather-core/src/index.ts';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  const origin = 'https://webapp-review.invalid';
  await page.route(origin + '/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Read-only browser CORS probe</title>'}));
  await page.goto(origin);
  const base = 'https://todayweather.wizardfactory.net';
  const units = new URLSearchParams({...DEFAULT_UNITS, airForecastSource: 'kaq'}).toString();
  const requests = [
    ['weather', '/weather/v000903/coord/37.567,126.978?' + units],
    ['reverse', '/geocode/v000903/coord/37.567,126.978'],
    ['address', '/geocode/v000903/addr/' + encodeURIComponent('서울')],
    ['nation', '/v000903/nation/KR?' + units],
    ['warnings', '/v000903/kma/special'],
  ];
  const observations = [];
  for (const [operation, path] of requests) {
    if (process.argv[2] && operation !== process.argv[2]) continue;
    const url = base + path;
    const seen = [];
    const failures = [];
    const listener = response => {
      if (response.url() === url) seen.push(response.allHeaders().then(headers => ({status: response.status(), headers})));
    };
    const failureListener = request => { if (request.url() === url) failures.push(request.failure()?.errorText); };
    page.on('response', listener);
    page.on('requestfailed', failureListener);
    const value = await page.evaluate(async url => {
      try {
        const r = await fetch(url, {credentials: 'omit', redirect: 'error', headers: {Accept: 'application/json', 'Accept-Language': 'ko'}, signal: AbortSignal.timeout(20000)});
        const text = await r.text();
        return {readable: true, status: r.status, type: r.type, contentType: r.headers.get('content-type'), text};
      } catch (error) { return {readable: false, error: String(error)}; }
    }, url);
    page.off('response', listener);
    page.off('requestfailed', failureListener);
    const row = {operation, path, readable: value.readable, status: value.status, responseType: value.type, contentType: value.contentType, error: value.error};
    row.networkFailures = failures;
    const headers = (await Promise.all(seen)).at(-1)?.headers || {};
    row.transportHeaders = Object.fromEntries(['access-control-allow-origin', 'cache-control', 'age', 'x-cache', 'vary'].filter(k => k in headers).map(k => [k, headers[k]]));
    if (value.text) {
      row.bytes = Buffer.byteLength(value.text);
      row.sha256 = createHash('sha256').update(value.text).digest('hex');
      try {
        const raw = JSON.parse(value.text);
        row.topLevelKeys = Object.keys(raw);
        if (operation === 'weather') {
          const normalized = normalizeWeather(raw, {units: DEFAULT_UNITS, mode: 'live', location: PLACES[0]});
          row.normalization = {ok: true, source: normalized.source, hourlyCount: normalized.hourly.length, dailyCount: normalized.daily.length};
        } else if (operation === 'nation') {
          const normalized = normalizeNation(raw, {units: DEFAULT_UNITS, mode: 'live'});
          row.normalization = {ok: true, topLevelKeys: Object.keys(normalized)};
        } else if (operation === 'warnings') row.normalization = {ok: true, count: normalizeWarnings(raw).length};
        else row.geocodeShape = {hasCoordinates: Number.isFinite(raw.location?.lat) && Number.isFinite(raw.location?.long), hasNameOrAddress: Boolean(raw.name || raw.address)};
      } catch (error) { row.normalization = {ok: false, error: String(error)}; }
    }
    observations.push(row);
    console.log(JSON.stringify(row));
  }
  await writeFile(new URL(process.argv[2] ? `${process.argv[2]}-browser-evidence.json` : 'browser-evidence.json', import.meta.url), JSON.stringify({observed_at: new Date().toISOString(), browser: 'Chromium', origin, credentials: 'omit', note: 'Browser CORS checks are real; normalization runs separately in Node using the shared pure module. No application deployment or device push tested.', observations}, null, 2) + '\n');
} finally { await browser.close(); }
