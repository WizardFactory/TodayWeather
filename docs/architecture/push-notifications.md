# Push notifications

[Open the interactive push diagram](diagrams/push-notifications.html) · [Editable JSON](diagrams/push-notifications.json) · [Monthly request report](../../reports/aws/api-traffic-2026-09-22.md)

The app stores alarm/alert settings through a REST API. Independent background workers later select due settings, request weather, and submit a notification to a provider. The diagram's app-settings and notification-handling boxes represent two roles of the same mobile application.

Repository baseline: `c9220de35fe31838e10e692494731b90106b0f65` plus the issue #2565 working-tree compatibility changes below. Source behavior is distinct from production observations. CloudFront push routing was checked on 2026-09-22; read-only follow-up on 2026-09-24 found historical push checkouts on the gather host but no running push process in the inspected inventory. Provider acceptance and actual device delivery remain unverified. Repository content and diagram UI are in English.

## App settings and API contracts

[Push service](../../client/www/js/service.push.js) constructs `clientConfig.serverUrl + /v000902/push` and `/v000902/push-list`. Settings are read from local `TwStorage` (`pushData2`), not fetched with a GET to the push API. `getPushListByCityIndex()` filters local data. Token callbacks and notification events come through the [Firebase adapter](../../client/www/js/service.firebase.js).

| Request | Purpose | Relevant input and behavior |
| --- | --- | --- |
| `POST /v000902/push-list` | Save a batch of settings | Array of records: `category=alarm` or `alert`, token, device type, city/id, location/town, units, language, enable flag and time settings. The client requires an FCM token before submitting; the server also accepts legacy registration IDs. |
| `PUT /v000902/push` | Replace an existing device token | Requires truthy `newToken` + `oldToken`, or `newRegId` + `oldRegId`. Updates alarm and alert collections in parallel. It does not create a new alarm. |
| `DELETE /v000902/push` | Remove settings | Token identifies the device. Only a truthy `cityIndex` narrows the query; a truthy `id` narrows it only inside that branch. `cityIndex=0` or an absent city index therefore removes by token within the selected category; omitted category targets both collections. |
| `POST /v000902/push` | Legacy single-record registration | Reused older handler writes an alarm record through `ControllerPush.updatePushInfo`. The current shared app uses the batch route. |

The [v000902 router](../../server/routes/v000902/index.js) mounts [the reused push handler](../../server/routes/v000705/routePushNotification.js) and [the batch handler](../../server/routes/v000902/route.push.update.list.js). The [v000903 router](../../server/routes/v000903/index.js) reuses the same handlers. `POST /push-list` is an upload operation despite its name; it is not a list-read endpoint.

[Current CloudFront evidence](../../reports/sdlc/push-diagram/aws-routing.json) shows `/*/push` and `/*/push-list` targeting `tw-svc-spot.wizardfactory.net` directly, with HTTP port 80 to the origin. PUT, POST and DELETE are among the allowed methods; only GET and HEAD are configured as cached methods. This branch bypasses the API Gateway/Lambda path used for public weather and geocoding. The checked-in client base URL is a placeholder, so repository source alone does not establish every shipped app's host.

The DELETE implementation uses truthiness rather than property presence. With `{fcmToken, cityIndex: 0, id: 1}`, both controllers build a token-only query, potentially removing settings for other cities. With a truthy city index and `id=0`, the id filter is ignored. This is an existing source behavior; no deletion was executed or code changed.

## Token refresh and the 403 branch

1. `Firebase.init()` registers the native `onTokenRefresh` callback. The app initially defines `pushData.fcmToken = null`, with persisted state restored if available.
2. When the callback token differs, `Push._updateFcmToken()` submits `{newToken: token, oldToken: previousToken}` to `PUT /push`.
3. The app immediately replaces its in-memory token after submitting the request. It does not await HTTP success; the error callback logs failure without rolling that assignment back. This function does not itself persist `pushData2` or retry.
4. The server accepts a complete FCM token pair or legacy registration-ID pair. Otherwise it returns **HTTP 403, `invalid body`**. Accepted pairs call updates against both Mongo models; database errors return 500.

A first-token callback with an absent old token can therefore reach the 403 branch in this source. This is a code-supported failure scenario, **not proof of the cause of the logged 403 responses**. No client body or origin response body was correlated with those requests. The presence of PUT in CloudFront's allowed-method list is not evidence that every request passes every edge/origin check.

An [isolated source check](../../reports/sdlc/pr2552-review-assessment/token-reproduction.json), with HTTP, storage and Firebase stubbed, confirmed that a repeated callback with the same token in one session sends no additional PUT. A new service instance without a persisted token can again send `oldToken=null`; after an explicit `savePushInfo()`, the same token does not trigger replacement on initialization. The relevant condition is a missing persisted token, not simply whether a user currently has alarms. This check did not reproduce production requests or device behavior.

The server's invalid-pair branch sends `invalid body` as an HTTP response without explicitly logging that message. A count of that string in server logs alone therefore cannot establish this cause. An origin investigation must first confirm deployed code/logging and correlate token-presence indicators with request/status timestamps; raw token-bearing bodies should not be copied into reports. A separate fix should distinguish initial token acquisition from replacement and preserve persistence and failed-replacement retry semantics. No token behavior was changed here.

## Persistence and scheduling

Alarm records use the [push model](../../server/models/modelPush.js); conditional alerts use the [AlertPush model](../../server/models/alert.push.model.js). Settings include device tokens, city/id, units, package (`todayWeather`/`todayAir`), enable flags and times. Mongo coordinates are `[longitude, latitude]`; the app supplies `{lat, long}`. Alarm writes use upsert; alert writes find an existing record then save or update.

Only [the `SERVER_MODE=push` startup branch](../../server/app.js) starts both workers. Mode selects background execution, not HTTP route availability. The [2026-09-20 service-host inspection](ec2-internals.md) observed `service` mode. A 2026-09-24 read-only follow-up found separate `tw-push` (alarms) and `tw-alert-push` (alerts) checkouts on the gather host, both at `6ee558da` with local changes splitting the startup roles. The current ec2-user PM2/process inventory contained only the gather application, with neither push checkout running. No message broker is required by this code path: workers poll persisted settings.

| Worker | Trigger | Selection and send decision |
| --- | --- | --- |
| Scheduled alarm: `ControllerPush` | A 60-second interval | Match UTC seconds-of-day `pushTime`; exclude explicitly disabled records; filter local weekday using `timezoneOffset`; build a daily weather/air notification. Processing uses concurrency 6. |
| Conditional alert: `AlertPushController` | A 60-second interval, running work at UTC minutes **7, 17, 35, 50** | Enabled records inside their time window, including overnight windows. Recent-send gates and precipitation/air-quality state or forecast thresholds determine whether to send weather, air, both, or nothing. |

These are intervals, not durable scheduler guarantees. The alert database prefilter skips records when either recorded weather or air send falls within the preceding six hours; the later per-category comparison also checks six-hour limits. Do not infer independent unrestricted hourly delivery from the four polling minutes.

Workers fetch weather from configured `SERVICE_SERVER`: `/v000902/kma/coord/...`, `/v000902/kma/addr/...` or `/v000902/dsf/coord/...`, with units and language. Alarm fallback can geocode a record before choosing KMA/DSF. They format localized notification text after obtaining weather. The diagram's `weather GET` represents a request/response dependency, not a separate scheduled collector.

Sources: [alarm controller](../../server/controllers/controllerPush.js), especially `getPushByTime`, `requestDailySummary`, `_filterByDayOfWeek`, `sendPush` and `start`; [alert controller](../../server/controllers/alert.push.controller.js), especially `_makeRequestUrl`, `_getAlertPushByTime`, `_compareWithLastInfo`, `_sendAlertPush` and `start`.

## Provider submission and app handling

[Provider selection](../../server/controllers/controllerPush.js) first checks for `fcmToken`: Firebase Admin submits a message using the TodayWeather or TodayAir configuration. An iOS record without `fcmToken` returns `FCM token is required for iOS notifications`; it is neither sent nor reported as successful. Legacy Android registrations retain the GCM branch. The direct APNs fallback and its SDK, credentials configuration and unused feedback hook have been removed. FCM-mediated iOS delivery is unchanged; Firebase handles its APNs integration. Stored registrations are not deleted or disabled by this removal.

The FCM payload contains notification title/body and a string `cityIndex`. An unregistered FCM token disables matching records through the relevant controller. Alert state is updated asynchronously before submission, so state persistence and provider acceptance are not one transaction. Alarm batch handling logs per-record send errors and continues. FCM callbacks report SDK acceptance or an error; SDK acceptance does not establish device delivery.

[Push providers](../../server/lib/pushProviders.js) initialize Firebase on first send. Constructing service routers no longer reads Firebase service-account files. FCM retains Firebase Admin 5.13.1 and its two named apps; its installed Firestore dependency brings native grpc even though this application uses messaging, not Firestore. The Node 16 lock overrides grpc to 1.24.11. The application no longer reads `APN_*` settings or local APNs certificate/key files.

Historical source introduced FCM preference in May 2018, including iOS. On 2026-09-24 both old push checkouts still contained Firebase credentials and an APNs certificate/key pair; those certificates expired on 2019-07-17. The API checkout's default APNs files were absent. These are distinct host observations and do not establish Firebase credential validity, a successful past delivery or when the workers stopped. Local compatibility tests do not verify any production credential.

Issue #2565 removes the New Relic import, package and agent configuration while retaining application logging. [Offline runtime checks](../../server/test/offline/README.md#node-16-runtime-and-push-compatibility-2565) exercise the real FCM HTTPS transport against a local synthetic peer, plus isolated app startup; they do not test Apple/Google credentials, delivery or the production OS. The older deployed service still imports APNs 1.7.8; remove its direct APNs call sites together with the package in a narrow compatibility patch, preserving its private configuration, credentials and logging instead of deploying full current master. Before downtime, back up the old runtime/dependencies, PM2 dump, nvm default and init script, and verify native imports on Amazon Linux 1. During approved maintenance, move PM2 6.0.14 and all 10 workers to the actual Node 16 executable, align the saved interpreter/nvm default/SysV paths, perform one final service stop/start, then check health, the same baseline weather request and logs/restart counts for five minutes. Operational completion remains separate from these local compatibility checks.

On a notification tap, [the app](../../client/www/js/service.push.js) parses `cityIndex`, selects that city, and broadcasts `reloadEvent`. A foreground notification broadcasts `notificationEvent`. Provider acceptance, a 200 settings response, and a displayed or opened device notification are separate outcomes.

## Observed request errors and boundaries

In the [30-day CloudFront report](../../reports/aws/api-traffic-2026-09-22.md), covering **2026-08-23 19:53:45 UTC through 2026-09-22 19:53:45 UTC**:

| Operation | Requests | Observed responses |
| --- | ---: | --- |
| `PUT /v000902/push` | 18,872 | 16,337 HTTP 403; 1,834 HTTP 502; 694 HTTP 200; 7 status `000` |
| `POST /v000902/push-list` | 2,525 | 2,313 HTTP 200; 209 HTTP 502; 1 HTTP 408; 2 status `000` |
| `DELETE /v000902/push` | 2 | Both HTTP 200 |
| `POST /v000705/push` | 12 | All HTTP 500 |

PUT's monthly HTTP 403-only rate is **86.57%** (16,337 / 18,872); its combined HTTP 4xx/5xx rate is **96.29%**. Daily 403 rates vary: September 21 is 96.43%, while the partial September 22 window is 92.80%. These denominators must not be interchanged. Status `000` is a client disconnect before a response, not an HTTP status. These are incoming API requests, not notifications sent. The logs do not establish whether a token changed, a database write completed or a provider delivered a message.

The batch settings handler logs individual alarm/alert persistence errors and passes those callbacks onward without an error, so HTTP 200 is not proof that every submitted setting was saved. This and the token-refresh scenario are relevant source limitations, not fixes implemented in this documentation task.

## Artifact verification

[Delivery receipt](../../reports/sdlc/push-diagram/diagram-delivery.json) records **9/9 showcase checks, zero errors and warnings**, with 14 revision-pinned repository references. Browser evidence (local-only `reports/sdlc/push-diagram/diagram-browser.json`) records containment at 1440×900, 1600×1000, 1920×1080 and 2048×1320. [Visual review](../../reports/sdlc/push-diagram/visual-review.md) separately records actual light/dark screenshot inspection. Independent source verification is recorded in the task's verification report.
