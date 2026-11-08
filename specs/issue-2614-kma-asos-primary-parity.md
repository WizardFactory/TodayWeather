# Acceptance for ASOS-primary parity (second part)

- **PAST-FORECAST:** with stored SHRT publications covering past slots, past short rows carry their `pop`, `wav` (and the other values legacy keeps from the stored forecast that observations do not supply), with ASOS-observed fields over them; without a covering publication `pop` is 0 as legacy `adjustShort` sends it; current-row behaviour from #2899 unchanged.
  Tests (domestic): `observed_history::a_past_row_keeps_its_stored_forecast_values_under_the_observed_ones`, `observed_history::without_a_stored_publication_a_past_row_sends_legacys_missing_forecast_values`, `observed_history::a_past_slot_asos_fills_sends_legacys_lightning`, `observed_history::past_days_take_probability_amounts_and_lightning_from_their_kept_rows`, `observed_history::asos_filled_hours_keep_the_missing_wind_component_value`, `observed_history::asos_primary_replaces_forecast_history_and_uses_official_daily_values`.
- **WET-BULB:** a numeric uncoded ASOS amount in January (or any month) with wet-bulb >= 5 °C gives PTY 1 (rain); below 5 °C it stays unknown; recorded weather codes still win.
- **NOWCAST-FILL:** an hour of the last 23 h with unknown PTY/RN1 after the ASOS rules causes one owned `getUltraSrtNcst` acquisition for that cell and base time (or a stored read); its PTY/RN1 fill the hour on the answer that has them; hours older than 23 h are never requested; known or stored hours request nothing.
- **DAILY:** past days built from filled hours keep their AM/PM fields.
- **DOCUMENTS:** contract, history contract JSON and architecture text match the code.
- **PLACEMENT:** the placement gate passes against `server2/config/tasks/KMA-ASOS-PRIMARY-PARITY.json` (base `origin/feat/2614-kma-response-parity`), and the artifact policy passes on outgoing commits.

Failure paths: a nowcast acquisition that fails or is late leaves the hour unknown for that answer (no 503); legacy replay mode is unchanged (paired replay must stay identical).
