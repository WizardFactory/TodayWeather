# S10e plan: legacy settings and server2/.env

Source: [intent](../intent/issue-2753.md), [spec](../specs/issue-2753.md), issue #2753, parent #2614.
Declaration: [server2/config/tasks/S10e.json](../server2/config/tasks/S10e.json).

## User scenarios

1. Operator starts server2 with the legacy settings. Prerequisites: `server2/.env` is a copy of the
   legacy `server/.env` plus `SERVER2_S3_BUCKET` and the coexistence routing entries. Actions: start
   `server2` from `server2/`. Expected: it binds the legacy `PORT` (unless the process environment
   sets another), builds the listed native families from legacy keys and serves. Failure path: a
   missing bucket, key list or invalid port stops startup with a configuration error before binding;
   no value is printed. Coverage: AC1, AC3; `legacy_env_alone_builds_every_native_family`,
   `gateway_process_binds_the_legacy_port_and_refuses_invalid_settings_before_binding`,
   `the_working_directory_env_file_is_read_and_the_process_environment_wins`.
2. Operator overrides one value for coexistence. Prerequisites: the copied `.env` has the legacy
   `PORT`. Actions: start with `PORT=3002` in the process environment. Expected: server2 binds 3002
   and metrics 3003. Coverage: AC3; dotenv precedence tests.
3. Developer creates a Paseo worktree. Expected: `server2/.env` is copied with mode 600 and ignored;
   an existing file or symlink is kept; a symlinked source or `server2` directory is refused.
   Coverage: AC3; scratch-repository check of the setup block.
4. Developer runs tests and smokes. Expected: no real `.env` is read (empty working directories,
   `loopback_server` reads the process environment only); peers are reached through test-only
   builders. Coverage: AC5; smokes and workspace tests.
5. Operator imports seeds. Expected: the importers read the same S3 settings from the environment
   and `server2/.env`. Coverage: AC2, AC3; seed settings test.

## Steps

1. Declaration and issue comment; this plan.
2. Red test on the base; implementation (`dotenv`, `Config::from_vars`, `Builtins`, S3, geocoder,
   world, AirKorea, data.go.kr, importers, `loopback_server`, `process::run`).
3. Tests and smokes (`smoke.py`, `gateway_smoke.py`, `kma_smoke.py`, `world_smoke.py`, shadow tools,
   `deploy/local`, `deploy/smoke.sh`, CI builds the example).
4. `paseo.json` setup block (placement category `workspace-setup`) and `server2/.env.example`.
5. Live configuration check from `/Users/ak/paseo/TodayWeather/server2/.env` (names and booleans).
6. Documents: `server2.md` S10e section; foundation, gateway, smoke-shadow and infrastructure guides
   with regenerated PDFs; README and configuration summaries.
7. Merge origin/master, full checks, PR, CI, Codex review until PASS; merge-ready report.

## Archify

Excluded: the change replaces setting names and loading; no route, collector, response or storage
flow changes, and no Archify JSON lists the changed settings.
