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
