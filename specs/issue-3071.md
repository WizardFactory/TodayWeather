# Supplemental hourly forecasts

- **AC1.** The server1 overseas v000903 weather response includes a chronologically
  ordered `hourlyDetails` series of future model hours when at least one metric
  is available, with UTC ISO 8601 validity in `at`. Fields are `uvIndex`,
  `windGustMps` (m/s), `wbgtC` (°C), `solarRadiationWm2` (W/m²),
  `solarEnergyMjm2` (MJ/m²) and `severeRisk` (Visual Crossing model score
  0–100). The response's weather source is Visual Crossing.
- **AC2.** Missing and invalid measurements are omitted. Zero and signed
  temperatures are valid. Old cached data, Korean weather, legacy endpoints,
  and the normal three-hour and daily contracts remain compatible. Reuse the
  same provider call and forecast range. Inspect the provider record cost.
- **AC3.** The WebApp's shared desktop/PWA weather model and native iOS and
  Android weather models expose the optional series for the viewed location.
  Existing charts retain their input contracts.
