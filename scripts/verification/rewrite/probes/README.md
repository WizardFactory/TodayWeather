# Historical source probes

These programs reproduce selected observations in the [rewrite reference package](../../../../docs/rewrite/README.md). Their recorded baseline is `bd6640f2`; they extract functions from source and are not the maintained regression suite for every later revision. Saved outcomes are [dated evidence](../../../../docs/evidence/rewrite/probes/).

During the 2026-09-30 relocation, original and relocated programs were compared against source at `a5fdde1f`:

| Probe | Outcome on that source |
| --- | --- |
| Storage migration, push/Branch entry, unit conversion, KMA time zones | Executed successfully in both locations |
| AirKorea station merge | Both fail because the newer extracted method needs `_parseDateTime`, absent from the historical harness |
| Push text/purchase expiry | Both fail because the newer extracted builder needs `_getCurrentWeather`, absent from the historical harness |
| Start-popup choice | Requires the isolated browser harness; not a Node executable |

To reproduce historical results, use the documented source revision and its original probe paths in an isolated checkout. Redirect new results to an external directory or ignored `reports/verification/rewrite/probes/`, never over the saved evidence. A historical successful result is not a pass on current source. Use `server/test/offline/` and `client/test/` for maintained regression checks.
