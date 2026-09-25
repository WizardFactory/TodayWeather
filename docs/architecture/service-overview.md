# Overall service structure

## System shape

This repository contains a Node.js/Express weather backend, an Ionic 1/AngularJS/Cordova application shared by TodayWeather and TodayAir, and checked-in native iOS/widget/watch projects. The backend contains API serving, scheduled data gathering, scraping, and push workers in one codebase. `SERVER_MODE` selects background work; it does not select which HTTP routes exist.

[Interactive overview](diagrams/service-overview.html) · [Collection detail](weather-collection.md) · [Request detail](mobile-api.md)

## Components and ownership

| Area | Responsibility and entrypoints |
| --- | --- |
| `server/bin/www`, `server/app.js` | HTTP listener; Express middleware, MongoDB connection, API mounts, mode-dependent background startup |
| `server/routes/v000001` … `v000903` | Versioned APIs; newer routers reuse selected older handlers rather than copying every endpoint |
| `server/controllers/controllerManager.js` | Domestic product scheduling, self-HTTP `/gather/*` dispatch, normalization and saving |
| `server/controllers/controllerTown.js`, `controllerTown24h.js` | Load domestic products, merge observations/forecasts, add air/life indices, convert units and summarize |
| `server/controllers/worldWeather/` | World-weather API assembly, DSF cache/fill, AQI and historical collection machinery |
| `server/lib/` | Provider HTTP/XML/JSON access, KMA scraping, units and image parsing |
| `server/models/` | Mongoose weather, geographic, push and purchase-related models |
| `client/www/js/` | App startup and screens; `WeatherUtil` HTTP/conversion, `WeatherInfo` city state, `TwStorage` persistence |
| `client/gulpfile.js`, `tw.*`, `ta.*` | Product/platform build variants; copy configuration, select purchase plugin, resources and native projects |
| `tw.ios/`, `ta.ios/` | TodayWeather/TodayAir native shells, Objective-C widgets, platform web assets |
| `applewatch/` | Older WatchKit application/extension and its own bundled web assets |

Sources: [server entry](../../server/app.js), [server package](../../server/package.json), [Ionic dependency](../../client/bower.json), [build variants](../../client/gulpfile.js).

## Runtime modes

In the issue-2563 checkout change, [app.js](../../server/app.js) first loads
[config/env.js](../../server/config/env.js): dotenv reads `server/.env` before
Express and configuration imports. The path is independent of the working
directory, and existing process variables take precedence. A missing file is
allowed; other read failures stop startup with a sanitized error. This is a
repository startup change, not a new observation of the deployed EC2 process.
See [server configuration](../../server/CONFIGURATION.md) for syntax, runtime compatibility,
provider-key applicability and local-file protection.

The [configuration](../../server/config/config.js) defaults to `SERVER_MODE=local`, bind address `127.0.0.1`, and port `OPENSHIFT_NODEJS_PORT`, then `PORT`, then `3000`.

| Mode | HTTP routes | Automatically started background work |
| --- | --- | --- |
| `local` (default) | All normal mounts | `startManager()` and `startScrape()` |
| `gather` | All normal mounts | `startManager()`; listener timeout extended to 24 hours |
| `scrape` | All normal mounts | `startScrape()` |
| `push` | All normal mounts | `ControllerPush.start()`, `AlertPush.start()` |
| `service` | All normal mounts | None of those background loops |

[Startup conditions](../../server/app.js) and [HTTP listener](../../server/bin/www) establish these facts. The source alone does not establish process count; the [service-host snapshot](ec2-internals.md) separately observes ten API cluster workers in service mode. `local` starts two consumers of the manager's shared in-memory task array. There is no durable message broker or distributed scheduler in that path.

## API surfaces and the external boundary

`app.js` mounts `/` and `/v000001`, plus `/v000705`, `/v000803`, `/v000901`, `/v000902`, `/v000903`, `/ww`, `/req`, and `/health`. `v000903` combines current KMA handlers with reused DSF, push, purchase and summary handlers. Per-route inventory (mount map, handlers, gating, consumers and traffic): [API endpoint catalog](../rewrite/api-endpoint-catalog.md#mount-map).

The current mobile source requests `/weather/v000903/coord/...` and `/geocode/v000903/coord/...`. These are not Express mounts here. Authorized AWS inspection establishes CloudFront -> API Gateway production -> Lambda. Deployed weather Lambda geocodes coordinates using DynamoDB/provider adapters, then forwards KR to `/{version}/kma/addr/...` and other countries to `/{version}/dsf/coord/...` at `http://tw-svc-spot.wizardfactory.net`. That hostname resolves to the current service EC2 instance. Lambda source is outside this repository; service-host SSH now identifies nginx, ten PM2 cluster workers and checkout `5bca407` with config/logger edits; see [EC2 internals](ec2-internals.md). See [AWS/code correlation](aws-code-correlation.md) for evidence, address-route 501, cache policies and exact version handling.

The backend also calls `API_SERVER/geocode/coord/...` in its direct coordinate-to-KMA-address route. Its deployed configuration resolves `API_SERVER` to `http://todayweather.wizardfactory.net`; this separate call must not be confused with weather Lambda's internal geocoder.
Sources: [URL builder](../../client/www/js/service.weatherutil.js), [placeholder client config](../../client/www/client.config.js), [latest router](../../server/routes/v000903/index.js), [backend geocode dependency](../../server/controllers/controllerTown24h.js).

## Persistence and identity

| Data family | Representation / access |
| --- | --- |
| Domestic current, short, shortest | Legacy grid documents use `mCoord={mx,my}`, `pubDate`, and time-series arrays with sentinel values; `DB_DATA_VERSION=2.0` selects newer KMA controllers on supported reads |
| Domestic medium range, RSS, station and air products | Separate product models, region/forecast-zone/station relationships, then read-time merge |
| DSF | Geographic `geo=[longitude,latitude]`, provider timestamps, time offset, current/hourly/daily objects; upsert by `geo` + `dateObj` |
| AQI | Geographic/station data with an independent freshness check and pruning |
| Client state | In-memory cities plus JSON localStorage; Cordova app preferences mirror data for native sharing |
| Push | Device registrations/settings persisted on the server; push processes request weather and send notifications |

See [legacy model](../../server/models/modelCurrent.js), [v2 model](../../server/models/kma/kma.town.current.model.js), [DSF model](../../server/models/worldWeather/dsf.model.js), [client storage](../../client/www/js/service.storage.js) and [push controller](../../server/controllers/controllerPush.js).

App coordinates use `{lat,long}`; server geography often uses `{lat,lon}`; Mongo geospatial arrays reverse that order. Unit conversion and time-zone conversion occur at several boundaries, so neither array order nor temperature units should be inferred from UI display values.

## Other service paths

- Push registration uses versioned REST endpoints; delivery runs in `push` mode and requests weather from `SERVICE_SERVER`. Delivery uses Firebase for FCM tokens, including iOS, with legacy GCM retained for Android. Direct APNs has been removed; see the [push contract and deployment observations](push-notifications.md). [Push client](../../client/www/js/service.push.js), [scheduled push](../../server/controllers/controllerPush.js), [alerts](../../server/controllers/alert.push.controller.js).
- Purchase validation remains on a reused `/check-purchase` router. Gulp selects different purchase controller/plugin combinations for iOS and Android. [Receipt route](../../server/routes/v000705/receiptValidation.js), [build selection](../../client/gulpfile.js).
- Air forecast image processing and S3 helpers exist alongside the weather pipeline. A CloudFront invalidation helper exists, but its periodic manager dispatch is commented out; current CloudFront existence/routing is established separately by AWS evidence. [Manager](../../server/controllers/controllerManager.js), [S3 helpers](../../server/s3).
- Localization uses server `i18n` and client Angular Translate; analytics and advertising are app concerns, separate from the weather HTTP wrapper. [Client utility](../../client/www/js/service.util.js), [app](../../client/www/js/app.js).

## Platform and deployment evidence

The iOS widgets are independent HTTP consumers: their constants include `weather/coord`, `v000901/kma/addr`, and `ww/010000/current/2?gcode=`. They share preferences with the app but do not simply reuse the current Angular request builder. Bundled `www` trees can differ from `client/www`; treat them as platform snapshots until a build proves synchronization. [Weather widget](../../tw.ios/widget/TodayViewController.m), [air widget](../../ta.ios/widget/TodayViewController.m).

The [historical Travis configuration](../../.travis.yml) specifies Node 6.13, `cd server && npm install && npm test`, copies release configuration from S3, and configures Elastic Beanstalk deployment on `master`. [`.ebextensions`](../../server/.ebextensions/01_add_cors.config) modifies nginx CORS configuration. These are checked-in deployment recipes, not evidence of current environments. Gulp references release configuration files outside `client/` that are absent from this checkout; the checked-in client base URL is `https://localhost`.

AWS routing and deployed Lambda behavior are now documented in [AWS/code correlation](aws-code-correlation.md). [Service EC2 inspection](ec2-internals.md) now records the actual API worker inventory, service mode, DB version 2.0, remote database-target sockets and deployed source differences. Separate gather/Mongo server internals, release app configuration and provider success remain unverified.
