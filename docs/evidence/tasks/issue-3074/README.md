# NWS point-alert replay for #3074

On 2026-11-20 around 08:18 UTC, the official NWS active point endpoint returned
HTTP 200 with [two features in Miami](https://api.weather.gov/alerts/active?point=25.76,-80.19)
and [zero in New York](https://api.weather.gov/alerts/active?point=40.71,-74.01).
The [saved projection](nws-point-bulletins.json) retains the issuer's IDs,
timestamps, status, affected zones and CAP references used in the checks. It
comes from the NWS open data API. NWS provides the
[API terms and rate-limit overview](https://www.weather.gov/documentation/services-web-api)
and [alert geolocation guide](https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf).

- The point filters selected a Flood Watch and a Rip Current Statement for
  Miami. The latter lists coastal Broward and coastal Miami-Dade and returns
  null GeoJSON geometry. The NWS point lookup provides the applicable zone
  decision. A null geometry in a country-wide response is insufficient to
  assign a warning to a point.
- The Miami Flood Watch is an actual update which references the
  [previous NWS message](https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.e137ee0c26e3ff14d4b275565ab4c6d285721595.001.1),
  retrieved by ID later on November 20. The earlier bulletin's UGC coverage
  for this event matches the update. At 20:17:59 UTC on November 19 the
  earlier bulletin could still apply. At 20:18:00 UTC the update replaces it,
  even when the earlier bulletin arrives afterward. The replay verifies a
  revision using actual issuer bulletins. It does not claim a recorded NWS
  cancellation for this event.
- The Flood Watch expires at 12:00 UTC on November 20, and the Rip Current
  Statement revision expires at 14:00 UTC while its explicit hazard end is
  November 21 at 00:00 UTC. The replay shows why an expired message requires a
  fresh authoritative snapshot to establish whether a warning is still in
  force. The morning collection supplies no evidence about any replacement
  bulletin issued after collection.
- The valid empty New York snapshot produces `current` with zero results.
  A missing response and an elapsed freshness horizon produce `unavailable`.
  The two failure cases are deliberate replay inputs.

From the repository root run `python3 scripts/verify-official-warning-replay.py`.
It runs offline on the projected data and does not use credentials or start
server1. The [source and response mapping](../../../reference/regional-weather/official-warnings.md)
specifies scopes and outstanding city qualification.
