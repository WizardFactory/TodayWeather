# Example data and boundaries

All JSON here is **synthetic**. It contains no production response dump, token, credential or real-time observation. Optional fields shown in a sample are not guaranteed on every response. Read the [contract tables](../client-data-contracts.md) before treating a sample as a schema.

| File | Boundary and use |
| --- | --- |
| [client-kma-response.json](client-kma-response.json) | Partial raw KMA response for current WeatherUtil characterization |
| [client-kma-normalized.json](client-kma-normalized.json) | Output produced by executing the current KMA client parser |
| [client-world-response.json](client-world-response.json) | Partial public-gateway-shaped world response; direct DSF `location.lon` differs from gateway `location.long` |
| [client-world-normalized.json](client-world-normalized.json) | Output produced by executing the current world client parser |
| [screenshot-weather.json](screenshot-weather.json) | Broader world-shaped fixture with synthetic air station/history/forecast for visual captures; Seoul is a test label |
| [screenshot-weather-basic.json](screenshot-weather-basic.json) | Earlier same-day basic visual fixture, used for compact captures and safe-area comparison |
| [screenshot-nation.json](screenshot-nation.json) | Synthetic `weather` and `air` arrays for national-map layout |
| [screenshot-special.json](screenshot-special.json) | Explicitly fictional weather bulletin with no optional image |

The first four examples include explanatory metadata and are reproduced by the isolated command in [Client data contracts](../client-data-contracts.md). That command runs existing parser code without DB/provider calls. Screenshot fixtures instead travel through the existing client HTTP/parser/controller path against the loopback server. They test representative rendering, not server composition or meteorological correctness.

Weather `date`/`time`, dotted `dateObj`, AQI `YYYY-MM-DD HH:mm`, publication timestamps and timezone offsets are separate contracts. Do not infer one universal date parser. Similarly, app/geocoder `{lat,long}`, direct world backend `{lat,lon}` and Mongo `[longitude,latitude]` are not interchangeable.
