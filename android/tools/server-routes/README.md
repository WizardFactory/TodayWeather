# Route table of the legacy server

`generate.mjs` reads `server/app.js` and every router it mounts and writes the route table that `RequestPathsTest` (core-data) dispatches the native client's requests through (AN-18, #2897; spec R8). It is the only part of the Android work that reads `server/`; the Gradle build reads the generated `core-data/src/test/resources/server-routes/routes.json`.

```sh
node android/tools/server-routes/generate.mjs      # from the repository root, Node 22 or later
```

Running it again without changes in `server/` changes nothing. CI runs it with the full history and fails on a difference; the Android workflow runs on changes to `server/app.js`, `server/routes/**` and `server/package-lock.json`. The table records the last commit of each file read, so commit a server change first, then regenerate and commit the table.

## What it reads

- Text only: it never loads a module (`app.js` starts collectors by `SERVER_MODE`, and the route modules need a database). Comments, strings, templates and regular expressions are masked before calls are found.
- `app.use`/`router.use` with or without a path, `require('./…')` mounts, other middleware (its handler and arity), and `get`, `post`, `put`, `delete`, `patch`, `head`, `options`, `all` routes; `app.get(setting)` with one argument is a setting, not a route.
- Paths: string literals, or a variable of the same file holding a regular expression literal (the gateway's `OWN_PATH`).
- Router options: `caseSensitive` only (the gateway's router).
- The express and path-to-regexp versions from `server/package-lock.json`: express 4 with path-to-regexp 0.1, whose rules the tool applies to build each layer's expression (routes match the whole path, mounts and middleware a prefix ending at `/`; `/` mounts match every path).

It stops with the file and line on anything else: `router.route`, `router.param`, another Router option, an unreadable path or handler, a handler array in `use`, or another express major version.

## Output

`routes.json` lists the routers in file order, each with its layers in registration order (the order Express tries them): `line`, `kind` (`route`, `mount`, `middleware`), `method` for routes, `path`, `regex`, `ignoreCase`, `matchesAll` for `/` mounts and middleware, `router` for mounts, `handler` and `arity` for middleware. `sources` holds the last commit and SHA-256 of each file read. Requests the server does not serve under `v000903`, or that go elsewhere, are listed with their decisions in `server-routes/exceptions.json`.
