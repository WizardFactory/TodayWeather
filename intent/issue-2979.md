# Intent: server2 log pipeline LP-2 (#2979)

Source: AK, 2026-11-14 — decisions per recommendation and "구현 진행" for [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977). LP-2 is [#2979](https://github.com/WizardFactory/TodayWeather/issues/2979).

- **Outcome:** collector failures never affect the server; destinations are independent; records written during an outage are redelivered from the journal; loss is visible (counters on loopback, a periodic status record at every destination, journal overrun records).
- **Endpoint:** pre-merge, stacked on LP-5 (PR #2985) and LP-1 (PR #2984). No deployment or AWS change.
- **Excluded:** Spot notice and stop drain (LP-4), boot configuration and IMDS identity (LP-3).

Amendment (AK, 2026-11-14): duplicates allowed only for a collector-only restart while the server writes; exactly once remains required for outages and shutdowns.
