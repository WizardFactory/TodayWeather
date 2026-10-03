# Station query compatibility specification

Input: [intent](../intent/issue-2648-mongoose.md). Revision: 1.
Use Query.setOptions({maxTimeMS: 2000}) in getStnList, findHourlies2 and history/service.loadForTown metadata loader. Mongo native cursor in Store.read keeps maxTimeMS(2000). No HTTP contract, schema, timezone, source policy, schedule or configuration changes. Errors keep existing bounded fallback behavior; no new provider calls or retries.

Tests must instantiate real models and use the installed exact mongoose version from server/package.json. Intercept only query execution/storage, never query construction/chaining. Assert query filter/projection/sort/limit/lean/options at execution. Test normal rows, missing rows and execution errors, metadata enabled/disabled and native cursor compatibility. Route smoke uses real route/controller with real pinned queries and a loopback HTTP request; fixture storage is isolated and explicitly reported. No production config or database connection.

Risk: permissive model mocks can mask unsupported methods. Reject a dependency version mismatch and remove maxTimeMS from the general route mock. Alternative dependency upgrade rejected: unnecessary release/runtime risk. This preserves behavior and 2000 ms Mongo server operation limit, which does not guarantee total request latency or cancel transport.
