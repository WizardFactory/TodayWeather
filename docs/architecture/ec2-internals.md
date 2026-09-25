# Service EC2 internals

Read-only SSH inspection on 2026-09-20, approximately 14:59–15:04 UTC, of `ec2-user@ec2-13-124-25-12.ap-northeast-2.compute.amazonaws.com`. This is service instance `i-089297702b70911ec` / `tw-svc-240714`, private address `172.31.62.89`, already correlated with the public service origin. [Timestamped, sanitized host evidence](ec2-readonly-evidence-2026-09-20.json) records process metadata, selected configuration AST, file hashes and socket counts. [Internal diagram](diagrams/ec2-internals.html) · [AWS diagram](diagrams/aws-infrastructure.html) · [SSH access guide](ec2-access.md).

The confirmed path is **HTTP port 80 → nginx → loopback port 3000 → ten PM2 cluster workers → configured Mongo endpoint `172.31.19.0:16652`**. Configuration/source analysis and observed operating-system state support different parts of this statement; no application request or database query was issued.

## Host and process inventory

| Component | Observed state |
| --- | --- |
| OS | Amazon Linux AMI release 2018.03; kernel `4.14.348-187.565.amzn1.x86_64` |
| Reverse proxy | nginx `1.18.0`; one root master, two nginx-user workers |
| HTTP listener | `0.0.0.0:80` and `[::]:80`; no HTTPS listener observed on this host |
| Process manager | PM2 `3.3.1`, running as `ec2-user` |
| Application runtime | Node.js `10.15.3`, executable under `/home/ec2-user/.nvm/versions/node/v10.15.3/bin/node` |
| Application group | Ten `www` processes, `cluster_mode`, PM2 IDs 2–11, all `online` in the snapshot |
| Entrypoint / working directory | `/home/ec2-user/tw-svc/server/bin/www` / `/home/ec2-user/tw-svc/server` |
| Shared application listener | `127.0.0.1:3000`; netstat attributes the cluster's listening socket to the PM2 master, not ten separate public listeners |
| Management modules | `pm2-logrotate` and `pm2-slack`, one fork-mode process each; these are outside the ten application workers |

PM2 metadata was obtained through `getMonitorData` on the existing local RPC socket. No PM2 CLI command that could start a daemon, reload, restart, save or resurrect was run. The recorded worker start times were around 12:17:44–12:17:49 UTC, before this inspection; PM2 reports zero restarts for those current entries. This is not a claim about historical uptime or request success.

## Inbound routing inside the host

The inspected `/etc/nginx/nginx.conf` has a default server on port 80, `server_name localhost`, and `location /` with:

```nginx
proxy_pass http://127.0.0.1:3000/;
```

The default-server selection allows the actual service hostname even though the configured server name is `localhost`. Headers include `X-Real-IP $remote_addr`, `X-Forwarded-For $proxy_add_x_forwarded_for`, and `Host $http_host`. nginx also defines its local error-page locations and includes the standard conf.d/default.d directories. The selected on-disk directives are preserved with line numbers and a whole-file hash in the evidence. Process/listener state supports this topology; the in-memory nginx configuration was not dumped or reloaded.

Both external paths documented in [AWS/code correlation](aws-code-correlation.md) reach this listener:

1. CloudFront default and push behaviors use the service origin over HTTP. Direct KMA, nation, purchase and push-registration paths enter Express through nginx.
2. The weather-coordinate Lambda uses its `SERVICE_SERVER` target to call versioned KMA-address or DSF-coordinate paths over HTTP. Public geocode handlers remain Lambda/DynamoDB paths.

Express [app.js](../../server/app.js), [bin/www](../../server/bin/www), [v000903 route mounts](../../server/routes/v000903/index.js) and [Town24h](../../server/controllers/controllerTown24h.js) match the inspected host files byte-for-byte. Public `/weather/*` and `/geocode/*` remain outside Express. There is no newly discovered nginx rewrite implementing those public Lambda APIs.

## Resolved application configuration

These values come from static parsing of the deployed `server/config/config.js`, combined with the absence of the corresponding overrides in selected process-start environment and PM2 metadata. The configuration file predates the observed workers. No `require(config)`, application startup, heap inspection or configuration write was performed.

| Setting | Host configuration resolution | Consequence |
| --- | --- | --- |
| `NODE_ENV` | `production` in process metadata | Route errors passed to `next(err)` or thrown synchronously, and 404s, reach Express's built-in `finalhandler`, which returns an HTML body containing only the status text (no stack) and writes the stack to `console.error` (PM2 stderr). The `app.js` "error handlers" ([L162](../../server/app.js#L162), [L173](../../server/app.js#L173)) take three parameters, so Express 4 never calls them for errors: neither the Jade `error` view nor `log.error` runs (source analysis, not a probe) |
| `SERVER_MODE` / `config.mode` | No selected override; deployed fallback **`service`** | Startup does not call Manager gather/scrape or push loops |
| Bind / port | `127.0.0.1` / `3000` | Matches observed shared loopback listener |
| `DB_DATA_VERSION` | No selected override; deployed fallback **`2.0`** | Supported domestic reads select v2 controllers/models |
| Mongo endpoint / database | `172.31.19.0:16652` / `twonlyone` | Remote configured datastore; connection evidence below |
| `API_SERVER` | `http://todayweather.wizardfactory.net` | Direct Express coordinate geocoding depends on the public gateway |
| `SERVICE_SERVER` / version | `http://tw-svc-spot.wizardfactory.net` / `v000901` | Defaults used by code paths that request the service |
| KAQ S3 region / bucket | `ap-northeast-2` / `tw-kaqfs-images` | Configuration is present on the service host; it does not establish a scheduled consumer here |

These differ from the checked-in placeholder configuration (`local`, DB `1.0`, local endpoints). `SERVER_MODE` does not hide HTTP routes: `/gather/*` and `/req/*` remain mounted in service mode. They were not invoked. Ten cluster workers are ten API processes, not ten independent gather schedulers. Request-time DSF/AQI provider fetching remains possible; the absence of startup collection loops does not make the service read-only.

## Database connection evidence

The operating-system snapshot found **100 established TCP sockets**, ten from each of the ten application worker PIDs, to `172.31.19.0:16652`. This agrees with `poolSize: 10` in the byte-matched `app.js`. Prior AWS instance metadata maps that private address to `i-0236094d748e19ec0` / `tw-mongo-ri`; the relevant mapping is retained in the new host evidence.

This closes the previous unknown service-to-database destination. It does **not** prove database authentication, query correctness, replica layout, collection freshness, server version or the remote process configuration. No Mongo client or database query was run, and the Mongo host was not accessed. The observed destination port is **16652**, so a security-group inventory mentioning 27017 must not be mistaken for the application's actual connection port.

## Deployment identity and repository differences

The inspected deployment directory is a Git checkout on `master`, HEAD **`5bca4073255b41f55a8654b3de395cb033a06f03`**, whose commit timestamp is 2019-03-07. This is a checkout identity, not the machine's creation or deployment time. It has tracked edits in `server/config/config.js` and `server/lib/log.js`, plus three untracked files whose contents were not catalogued. Do not describe the running tree as an unmodified release commit.

Local analysis baseline remains `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`. Seven committed server files differ between that baseline and the remote checkout commit: configuration, Manager, Push controller, Town controller, DSF requester, KMA collector and package manifest. The host's tracked edits add the logger difference. Selected host-versus-local SHA-256 comparisons are retained in the evidence.

| Area | Relevant difference / parity |
| --- | --- |
| HTTP/bootstrap/current routes | `app.js`, `bin/www`, v000903 index and Town24h match current local files |
| KAQ consumer | `kaq.hourly.forecast.controller.js` matches; this does not verify the separate gather host's deployment |
| Manager | Deployed commit passes retry budgets 20 for common products and 5 for invalid-current repair; local values are 70 and 50. This is a service-host source difference, not an observed collection run |
| KMA collector | Local code adds a `parseInt(i) > 100` branch that emits `recvFail` before requesting; deployed commit lacks it |
| DSF requester | Deployed commit includes `agentOptions` with `TLSv1_method`; local baseline comments out that override. Provider success was not tested |
| Push / APNs | Push implementation differs; host manifest requests `apn ^1.7.5` and installed version is `1.7.8`, versus local manifest `^2.2.0`. Startup mode here is service |
| Logger / configuration | Locally edited on the host; selected nonsecret configuration is documented above, not copied wholesale |

Other inspected installed package versions include Express `4.13.4`, Mongoose `5.1.2`, Async `2.6.2`, Request `2.88.0`, AWS SDK `2.418.0` and New Relic `4.13.0`. Package installation was not changed. Disk hashes and process entrypoints correlate the deployment; loaded JavaScript heap contents were not independently attested.

## Startup, logging and operational boundaries

SysV init entries at runlevels 2–5 include `S50pm2-ec2-user` and `S85nginx`. The PM2 init script targets `ec2-user` and uses `resurrect`; `/home/ec2-user/.pm2/dump.pm2` contains ten saved cluster-mode `www` entries pointing to `server/bin/www`. This proves configured startup behavior, not a reboot test. No root or ec2-user crontab file was present; OS cron directories still exist, so this is not a blanket statement that cron is absent.

nginx logs use `/var/log/nginx/access.log` and `/var/log/nginx/error.log`. Worker stdout/stderr logs are under `/home/ec2-user/.pm2/logs/www-*`. `pm2-logrotate` is configured with `max_size=10M`, `retain=5`, no compression, 30-second checks and midnight rotation. The `pm2-slack` module is online, but webhook configuration/delivery was not examined or triggered. Historical log filenames do not establish current worker counts; the process/RPC snapshot does.

The inspection used the user-supplied PEM without changing it, first-use host-key acceptance in an isolated local known_hosts file and strict checks afterward. Selected privileged reads used noninteractive sudo. Raw config source, full environments, credentials, webhook settings, request logs and client IPs are excluded from repository evidence. No service configuration, process state or cloud resource was intentionally changed; no restart, deployment, HTTP endpoint probe, database query or lateral SSH occurred.

The separate gather instance's process mode, deployment and consumer bucket remain unverified. The Mongo server internals, shipped mobile release configuration, live weather/provider results and cause of the previously observed KAQ OCR failures also remain open. The effective process time zone is missing evidence: the environment check below did not select `TZ`, the host zone setting is not recorded, and the repository configures none, yet several persisted date encodings depend on the writing process's zone ([time representations](../rewrite/data-model-reference.md#4-time-representations)).

The sanitized snapshot also retains `selected_process_environment_check`: at 15:10:34 UTC, all 12 selected override keys were absent from the process-start environments of all 10 worker PIDs. The configuration SHA-256 remained unchanged. This corroborates the static fallback resolution without publishing environment values or claiming an inspection of JavaScript heap state.
