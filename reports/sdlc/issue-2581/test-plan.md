# Test plan
AC2: spawn UTC/Asia-Seoul/America-Los_Angeles child processes; assert normal and 24:00 7h accept, 9h reject, 8h strict boundary, invalid calendar input rejection, elapsed duration across DST and immutable Date.
AC3: actual detail middleware and converter with isolated unused dependencies; HTTP route serialization for mixed/stale/empty lists, hourly values absent outside 8h, and non-AirKorea source retained. No app startup, production credentials, external services or collection timers.
AC4: async getArpLtnInfo callback fails after outer try/catch returns; assert next once and no uncaught exception.
AC5: NODE_PATH existing dependency harness; exact Node16.20.2 and Node22.22.2 npm --prefix server run test:offline with complete logs. Any dependency/startup failure is not a pass.
Additional smoke: real Express listener on loopback with actual controllers/converters and synthetic station observations, assert fresh and expired JSON behavior end-to-end. Distinct command/log from TDD, socket closed at completion, no DB writes/providers.
AC1: read-only gather process/DB/provider observations and linked operations follow-up; public evidence must omit private operational details. No live recovery claim.
