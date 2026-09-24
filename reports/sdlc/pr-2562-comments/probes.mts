import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const core = await import(pathToFileURL(join(root, 'packages/weather-core/src/index.ts')).href);
const { NotificationService, validateRule, dueAlarm } = await import(pathToFileURL(join(root, 'web-api/src/notifications.ts')).href);
const output: Record<string, unknown> = {};
const raw = JSON.parse(await readFile(join(root, 'docs/rewrite/examples/client-kma-response.json'), 'utf8')).response;
for (const [label, fields] of Object.entries({ missing: {}, threeHourRain: { r06: 3 }, snowOnly: { s06: 2 }, nullableOneHour: { rn1: null, r06: 3 } })) {
  const data = structuredClone(raw);
  delete data.current.rn1; delete data.current.r06; delete data.current.s06;
  Object.assign(data.current, fields);
  const point = core.normalizeWeather(data).current;
  output['precipitation_' + label] = { value: point.precipitation, hours: point.precipitationHours };
}
output.warningUrls = core.normalizeWarnings([
  { imageUrl: 'http://www.weather.go.kr/warning.png' },
  { imageUrl: 'https://untrusted.example/warning.png' },
]).map((v: any) => v.imageUrl ?? null);
const ruleInput = { place: core.PLACES[0], units: core.DEFAULT_UNITS, timezone: 'Asia/Seoul', days: [0,1,2,3,4,5,6], times: ['07:00','07:01'], enabled: true, alert: { enabled: false, start: '07:00', end: '22:00' }, revision: 0 };
output.acceptedPlaceIds = ['', '../settings', 'seoul?unexpected=1'].map(id => validateRule({ ...ruleInput, place: { ...ruleInput.place, id } }, 'r').place.id);
const directory = await mkdtemp(join(tmpdir(), 'pr2562-notifications-'));
let release!: () => void, started!: () => void;
const waiting = new Promise<void>(resolve => release = resolve);
const sending = new Promise<void>(resolve => started = resolve);
let sends = 0;
const service = new NotificationService({ directory, secret: 'probe-only-'.repeat(5), publicKey: 'probe', privateKey: 'probe', subject: 'mailto:probe@example.com', secure: false, send: async () => { sends++; if(sends === 1) { started(); await waiting; } } });
const request = (method: string, headers = {}) => ({ method, headers });
try {
  const install = await service.handle(request('POST'), '/installations', {});
  const headers = { cookie: install.headers['Set-Cookie'].split(';')[0], 'x-csrf-token': install.body.csrf };
  await service.handle(request('PUT', headers), '/subscriptions/current', { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys: { p256dh: Buffer.alloc(65,1).toString('base64url'), auth: Buffer.alloc(16,2).toString('base64url') } });
  await service.handle(request('PUT', headers), '/notification-rules/r', ruleInput);
  const first = service.tick(new Date('2026-09-23T22:00:00Z'));
  await sending;
  let readCompleted = false;
  const read = service.handle(request('GET', headers), '/notification-rules', {}).then(() => readCompleted = true);
  const second = service.tick(new Date('2026-09-23T22:01:00Z'));
  await new Promise(resolve => setTimeout(resolve, 25));
  output.apiReadBlockedBySend = !readCompleted;
  release();
  await Promise.all([first, read, second]);
  output.queuedMinuteSends = sends;
  output.noCatchupForUninvokedMinute = dueAlarm(validateRule(ruleInput, 'r'), new Date('2026-09-23T22:02:00Z'));
} finally { release(); await rm(directory, { recursive: true, force: true }); }
const { createApi } = await import(pathToFileURL(join(root, 'web-api/src/api.ts')).href);
const handler = createApi({ mode: 'demo', upstream: 'https://synthetic.example', fetch: async () => { throw Error('Unexpected upstream call'); }, origin: 'http://localhost:5173', notifications: { capabilities: () => ({ enabled: true }), handle: async () => ({ body: { synthetic: true } }) } });
output.developmentOrigins = [];
for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
  let status: number | undefined, body: unknown;
  const req = { method: 'POST', url: '/api/web/v1/installations', headers: { origin }, socket: { remoteAddress: 'probe' }, async *[Symbol.asyncIterator]() {} };
  await handler(req, { writeHead: (value: number) => status = value, end: (value: string) => body = JSON.parse(value) });
  (output.developmentOrigins as unknown[]).push({ origin, status, body });
}
console.log(JSON.stringify(output, null, 2));
