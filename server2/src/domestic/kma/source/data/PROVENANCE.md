# KMA reference data (S15b-1)

Byte-identical copies of legacy repository data files (same repository, MIT license), embedded with
`include_str!` by `server2::domestic::kma::source`. The runtime never reads `server/`. Copied at
master `1ce314d6`; the files last changed in `8899b60a`.

| File | Origin | sha256 |
| --- | --- | --- |
| `part.csv` | `server/utils/data/part.csv` | `49bdc0ac73c1a878b33d1dda83f6824f789ab48dfed835552aeb94b60bc25f03` |
| `base.csv` | `server/utils/data/base.csv` | `4964458e67add7e2051f481868edd29ad097f73a97525346a533d0e7b0965db6` |
| `region.csv` | `server/utils/data/region.csv` | `a7e091b70d119868fdb56db4e1632002d79a717ff6559ecbd1a8505a993217c9` |
| `kma_forecast_land_zones.csv` | `server/utils/data/kma_forecast_land_zones.csv` | `f0a930e24a827250cff534738b51d6328cc5ebf07b7920f32d5e45884310bcec` |

- `part.csv` and `base.csv` build the town list as `initTownDataToMongo.js` and
  `updateTownDataToMongo.js` do (`base.csv` keeps its CRLF line ends, which legacy splits on `\n`
  only).
- `region.csv` is the `makeRegIdTable` code table of `getRegIdByTown`.
- `kma_forecast_land_zones.csv` is `KmaForecastZoneController.landZoneIds()` (#2739), the zones
  legacy collects with `getMidTa`.

Towns legacy added later by request-time geocoding are not in these files; S15b-4 geocodes and
stores them natively.

## Area numbers (S15b-3b)

Byte-identical copies, copied at master `7ca6f002`; `20160704_AreaNoResutl` last changed in
`a8daad6f` and `20180119_kma_lifeindex_areano.csv` in `e6828d13`.

| File | Origin | sha256 |
| --- | --- | --- |
| `20160704_AreaNoResutl` | `server/utils/data/20160704_AreaNoResutl` | `3ec05e31b76d76fa3dc1222ee014179f6a25715357e7c70426c532e30a7964d5` |
| `20180119_kma_lifeindex_areano.csv` | `server/utils/data/20180119_kma_lifeindex_areano.csv` | `f44d6fa89b201655b479ffbc3ab2208ba1142838a9f7b6340961494ad5429581` |

- `20160704_AreaNoResutl` is the geocoded list `utils/updateAreaNo.js` saved to `areaNoList`
  (`update({town}, {areaNo, town, geo}, {upsert})`).
- `20180119_kma_lifeindex_areano.csv` is the list `utils/update.areano.to.db.js` applied: an
  existing town gets `$set {areaNo, updatedAt: "20180119"}`. A town missing from the 2016 list
  needed a Kakao geocode, and the script calls `toFixed` on the string coordinates Kakao returns,
  so no new town was stored. `areaNoList` is therefore these two files only.

