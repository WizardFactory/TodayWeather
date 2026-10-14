# Contract: S13c AirKorea quota key rotation (server2)
Inputs: [#2745](https://github.com/WizardFactory/TodayWeather/issues/2745) (AK decision, 2026-10-14), [S13b spec](issue-2741.md), legacy [#2746](https://github.com/WizardFactory/TodayWeather/pull/2746). Base: `05c06c67`. Placement: [S13c.json](../server2/config/tasks/S13c.json).

## Behavior (`server2::domestic::acquire`)
- **Classification** is unchanged (S08/S13b `classify_format`): `Disposition::Quota` for HTTP 429 or code 22 (envelope, XML or JSON gateway, also inside a 401/403 body, and the `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR` marker). The data.go.kr AirKorea page lists 22 as the daily limit and 23 as the per-second limit; 23 stays non-quota.
- **Key loop** (`acquire_paged`, non-rotating families = AirKorea): order is the S13b order (remembered key, otherwise the last entry, then descending with one wrap). For each entry: if `KeyRing::exhausted(index, now)` skip it without funding or HTTP; otherwise collect every page with that key. `Auth` → next entry. `Quota` from a provider answer → `KeyRing::exhaust(index, now)` (until the first instant of the next KST day, `fetch_max`), next entry; `Quota` from the per-page recheck (key already exhausted) → next entry without re-marking (review S13C-R1). Success → remember the index on `Complete`. Any other result → return it.
- **Per-page recheck** (`collect_pages` with a fixed key): before funding a page, an exhausted key ends the pass with `Provider(Quota)` (no reservation, no HTTP), so a parallel acquisition's exhaustion takes effect between pages.
- **Final result**: `Provider(Quota)` when at least one entry was exhausted, otherwise `Provider(Auth)`.
- No runtime mode, setting or verification flag. The #2604 rings (KASI, forecast zone) and S08 funding denials are unchanged.

## Funding and bounds
Each page call reserves two units on the offered key's budget before HTTP (unchanged S13b single-candidate executor). Worst case per acquisition with *n* keys and *P* ≤ 20 pages: *n·P* calls, *2·n·P* attempts and reserved units, the same as the S13b credential failover. No key repeats a page after a quota or credential rejection.

## Verification
`cargo test --locked --workspace` including the formats tests: quota on the last key then success on the previous key, memory and funding counters; every quota form (including the live-recorded 429 body) rotates; code 23 stops; all keys at quota → `Provider(Quota)`, then no HTTP or funding until KST midnight, then a new probe; quota on page 2 restarts with the next key; parallel exhaustion between pages. fmt, fresh clippy, placement gate, artifact policy. Live: one 서울 station request through the acquirer with the operator keys and the local S3 peer.
