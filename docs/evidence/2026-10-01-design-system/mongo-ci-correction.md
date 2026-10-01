# Deterministic Mongo smoke correction

Parent PR: #2658. Baseline: ec5722003ef0d9da4c78c253bc2caa4dfad64553. Scope: test harness, CI invocation and verification documentation; production controller/model behavior is unchanged.

The controller begins asynchronous usage and lock mutations before returning a response. The old harness waited 50/100ms, read the database and eventually disconnected, assuming these writes had completed. The failing PR log read `usage.calls` from null and reported a usage write interrupted at shutdown.

The corrected harness observes callbacks of actual model writes through test-only VM dependencies. It drains them before reads, fixture-clock changes and disconnect. A 10-second watchdog fails with the pending operation name; controller write-error logs also fail the smoke. Assertions are not retried and no CI test was removed.

`--hold-writes` withholds the first usage and release operations until all concurrent responses finish, proves the usage row is absent and the lock remains, then releases both and verifies the actual persisted values. This explicitly exercises the old race regardless of hardware speed. Five dependency-free observer tests cover held callbacks, nested retry work, timeout diagnostics, synchronous exceptions and callback error propagation.

The isolated mongod disables the wall-clock TTL monitor because lock fixtures use a captured September timestamp; the TTL index and application takeover behavior remain checked. Existing Mongo instances must explicitly have that setting and be isolated; the harness verifies it without changing the server. The failed-lock check counts scheduled polls instead of comparing elapsed milliseconds.

Local verification on Node 24.19.0, mongoose 5.13.23 and MongoDB 7.0.24: five observer tests passed; held-write real-Mongo smoke passed 16 check groups; ordinary real-Mongo smoke passed 15 groups. Both use fixture requesters, with no live weather providers. CI uses Node 22.22.2 / mongoose 5.13.22 and runs the held-write path; local results do not claim CI or deployment completion.
