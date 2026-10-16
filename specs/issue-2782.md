# Issue #2782 specification

Upstream: [intent](../intent/issue-2782.md).

After the existing Korea-area guard accepts a newly geocoded town, convert its gCoord lat/lon with Number before cache insertion, persistence and callback. The guard already excludes nonnumeric strings and out-of-area values; do not change its terminal path or broaden coercion to other consumers. Valid numeric strings and existing numeric results retain precision until makeResult applies existing three-decimal rounding. Preserve grid/city areaNo copying, callback timing and asynchronous persistence semantics. Existing cached towns are returned unchanged. No schema migration, new provider requests or new formatter policy.

Regression uses actual Mongoose 5.1.2 and Town schema with in-memory collection adapters, real controller modules and Express loopback responses. Separate smoke uses temporary local Mongo and loopback HTTP with a local Kakao endpoint; all production/config/timer boundaries isolated. Check first use before save completion, hot reuse, save completion and lean reload, mounted versions and existing/failure paths.

Rejected: formatter-only conversion would leave cache contract wrong; moving all provider conversion changes unrelated callers; reusing a Mongoose document would alter plain-object shape and behavior. Rollback is a revert with process reload; no data migration.
