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

## `html-entities.json` (S15b-2)

A byte-identical copy of `maps/entities.json` from the npm package `entities` 1.0.0 (the copy
`htmlparser2` 3.8.3 bundles under its own `node_modules`, which legacy cheerio 0.20.0 uses), sha256
`faeaf228b74fa90547cccf84c939924eca20eb54315095af7397e959f584ff80`, 2,125 names. `server2::domestic::kma::source::html` decodes
semicolon-terminated named entities with it, as htmlparser2's `_parseNamedEntityStrict` does.
License of the `entities` package:

```
Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## `kmastninfos.seed.jsonl` (S15b-2 station registry seed)

The legacy station registry (`KmaStnInfo`, collection `kmastninfos`) as a seed file of
`server2/tools/migration/export_station_seeds.py`: a manifest line, then the exported documents
byte for byte in `_id` order. Public KMA station information only: station id, name, address,
altitude, coordinates (`geo`, `[longitude, latitude]` geocoded by legacy), `isCityWeather`,
`isMountain`, `rnsHit`, `rnsCount`, plus the legacy `_id` and `__v`.

| Field | Value |
| --- | --- |
| Export | one-time read-only export authorized by AK on 2026-10-15 (`find` on `kmastninfos` only; the connection URL was read in-process from `server/.env` and never printed or stored) |
| Database | production `twonlyone` |
| Exported at | `2026-10-15T00:34:30.549Z` |
| Documents | 776 (97 `isCityWeather`, 38 `isMountain`, 695 with `rnsHit`/`rnsCount`; `stnId` `965` and `989` each appear three times (772 distinct ids), as legacy holds them) |
| Raw export sha256 | `fe82638edb21696c0e8a737cd1fd19e8a0b0ae70c36e7083e6f9dd7c8e06c568` (the raw file was deleted after conversion) |
| Seed sha256 | `bbc199e3405345b14c70f4b3a6a4f7032b34d7011c327f0aefce78b2dacc3ae7` |

`server2::domestic::kma::source::seed::embedded()` carries this file. A later export published by
`station_seed_import` replaces it when it is newer. The final read-only export at cutover is a
cutover step.

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

