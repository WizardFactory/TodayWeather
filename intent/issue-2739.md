Task: issue-2739; owner: builder (Claude); base: 44d76a0f (origin/master); date: 2026-10-14.
Authority: AK on 2026-10-14 asked to revise the issue where needed and proceed to pre-merge; server2 is handled separately.
Criteria: AC1, AC2, AC3, AC4, AC5.

# Intent

The legacy gather process refreshes forecast-zone codes from the retired `newsky2.kma.go.kr` host, so the refresh fails at every startup and mid-term temperature collection keeps using a stale zone list. Move the refresh to data.go.kr `FcstZoneInfoService/getFcstZoneCd` ([#2739](https://github.com/WizardFactory/TodayWeather/issues/2739)), hide zones the provider no longer returns, and request `getMidTa` only for the KMA guide's land zones.

- AC1: The refresh fetches every page over HTTPS with the `DONGNAE_SECRET_KEYS` list, rotates on key rejection, and stores every zone. A 3xx, a non-`00` code, a malformed body or an incomplete page fails with no writes and no key or URL in logs.
- AC2: After a complete refresh, a stored zone absent from it (e.g. `11H10603`) is marked retired, not deleted, and no zone lookup returns it. Unmarked rows stay visible, so a failed refresh keeps the current data.
- AC3: A local run against the real service with an isolated database stores the provider's zone count. Town mapping returns the guide codes for 서울, 광주 (광역시/경기), 고성 (강원/경남) and 군위 (`경상북도 군위군` and `대구광역시 군위군`).
- AC4: A maintained data file lists the 176 land zones of the 240715 guide with 종료/신설 applied (`11H10707` in, `11H10603` out). Mid-term temperature collection requests `getMidTa` only for listed, non-retired zones; a test fails for an unlisted zone such as `11A00102`.
- AC5: No non-test code under `server/` references `newsky2`. K5, the key operations guide, `server/CONFIGURATION.md`, the weather-collection architecture document and its Archify diagram describe the new endpoint.

In scope: the zone controller and model, the mid-temperature zone selection, the town mapping, offline tests and smoke, documentation, commit/push, PR, CI, cross-provider review and corrections.
Excluded: server2 (separate task), shared `dataGoKrRejection` codes, merge/auto-merge/queue, deployment, production gather runs and secrets in any artifact.

Risks: the provider may change the zone count or contract; the guide list is static and must be maintained by hand when KMA publishes a new edition. Existing production rows from newsky2 carry fields (`ht`, string `tmEd`) that the new rows overwrite or keep; consumers read only `regId`, `regName`, `regSp`, `regUp` and `geo`.
