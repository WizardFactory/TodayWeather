# Historical observation recovery

This checklist replaces a missing report link. It is reconstructed from the current [CLI](../../server/bin/backfill-history.js), [argument validation](../../server/lib/history/cli.js), [policy](../../server/lib/history/policy.js) and existing architecture docs on 2026-09-30; it does not recover or assert the missing report's execution evidence.

## Before an authorized recovery

- Record deployed revision, intended ASOS station/date range and database version. Configure `ASOS_HISTORY_SERVICE_KEY` and the station allowlist `ASOS_HISTORY_STATIONS` privately.
- Scheduled recovery and response reads use separate `ASOS_HISTORY_ENABLED` and `ASOS_HISTORY_READ_ENABLED` switches. Inspect their actual deployment values. The explicit CLI independently requires the key and allowlisted station; do not treat the scheduler flag as a CLI guard.
- Confirm the configured database and provider entitlement. Do not start `app.js` or use `/gather/*` as a health probe.

The separately authorized command, from the repository root, is:

```sh
node server/bin/backfill-history.js --station <ID> --start <YYYYMMDD> --end <YYYYMMDD>
```

The policy restricts requests to completed KST dates in a bounded seven-day range. This command reads the provider and writes the configured database. Record stored readback and remaining gaps; invalid configuration exits 2 and incomplete recovery/errors exit nonzero. Do not interpret an HTTP response alone as complete recovery.

## Verification and rollback

Use the isolated scenarios in [offline testing](../../server/test/offline/README.md) before rollout. After authorized operation, compare saved hourly/daily observations and returned history for the intended station/time window, including missing fields and units. Retain timestamps and gaps without credentials or raw personal request data.

For rollback, restore the known-good code/configuration through the existing operator procedure and disable the relevant opt-in recovery/read behavior as appropriate. Preserve stored records; do not perform destructive cleanup. See [collection behavior](../architecture/weather-collection.md) and [response contracts](../architecture/mobile-api.md) for compatibility and existing live-observation limits.
