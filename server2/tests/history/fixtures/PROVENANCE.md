# S14 history fixtures

All fixtures are synthetic. None comes from a production database, provider or user.

| File | Shape and purpose |
| --- | --- |
| `kma.town.current.v2.jsonl` | `mongoexport` default output (one document per line) of the legacy `kma.town.current` model (`server/models/kma/kma.town.current.model.js` at 47a96078). Mixes relaxed and canonical Extended JSON (`$date` ISO and `$numberLong`, `$numberInt`, `$numberDouble`), an absent field, a `null` field, sentinels and out-of-order `fcsDate` for grid 60/127, plus one document for grid 61/127. |
| `current.v1.jsonl` | `DB_DATA_VERSION` 1.0 `current` model documents (`server/models/modelCurrent.js`): one array document per grid, array subdocument `_id`s, and a second document for the same grid that the legacy `limit(1)` read ignores. |
| `KmaStnMinute2.jsonl` | `KmaStnMinute2` documents (`server/models/modelKmaStnMinute2.js`) for stations 108 and 112; `date` holds the KST wall clock in UTC fields, as the legacy scraper stores it. |
| `expected-current-v2.json` | `JSON.stringify` of the legacy `kmaTownCurrentController.getCurrentFromDB` callback value for grid 60/127. |
| `expected-current-v1.json` | `JSON.stringify` of the legacy `ControllerTown._getTownDataFromDB` callback value for grid 60/127. |
| `bad-array.json`, `bad-personal.jsonl`, `bad-row-field.jsonl` | Rejection cases: `--jsonArray` output, a document with coordinates, and a row with a device identifier. |
| `bad-duplicate-key.jsonl`, `bad-station-id.jsonl` | Rejection cases: a repeated member name hiding a device identifier, and a station id outside 32 bits. |
| `bad-daily-metadata.jsonl`, `bad-date-range.jsonl` | Rejection cases: identifiers hidden in v1 `dailySource.__v`, and a `pubDate` outside the supported instant range. |

The two expected files were written by hand from the legacy read code and then confirmed by
running the legacy functions at 47a96078 over these fixtures with stubbed models (evidence kept
with the S14 SDLC records, outside this tree). The tests read no legacy file at run time.
