# KMA full response: measured history, client eval and station selection

AK requested this work between 2026-10-25 and 2026-11-03, and on 2026-11-03 asked to proceed to the pre-merge endpoint (`/sdlc premerge까지 진행`). The endpoint excludes merge, auto-merge, merge queues, deployment, production mutation and new accounts.

## Outcomes

- **HISTORY:** under ASOS-primary, completed days use measured ASOS history through the existing mobile response. Measured precipitation never reads as dry, and an unknown type stays missing.
- **RULES:** the AK-approved rules R1b, D1 and R2s apply. The rules that failed held-out validation (R2, W1, the all-season wet-bulb variant) do not.
  - 2026-11-08 note: AK approved applying R2s's 5.0 °C wet-bulb cutoff in every month (`wet-bulb-rain-v2`, [ASOS-primary parity](issue-2614-kma-asos-primary-parity.md)). The all-season variant that failed above used a 2.5 °C cutoff.
- **PRECEDENCE:** a rule-derived hourly value never replaces a measured value or a recorded precipitation type from ASOS, ODAM or VSRT.
- **STATION:** a mountain or special-area station is not used as-is. A town reads a station by distance and altitude, or no station.
- **CLIENT:** a checked contract and automated eval protect the wire format of every API version seen in production traffic.
- **RESPONSE:** the client response comes first, with canonical raw persisted after it, as the existing design records.
- **PLACEMENT:** all implementation stays under `server2/`, and outside paths are documentation declared in `KMA-FULL-RESPONSE.json`.

## AK decisions

Recorded in [issue #2614](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6606307418).

## Exclusions

- Grid combination generation.
- The continuous cold and restore timing campaign, and seven-day source closure beyond what the rules above provide.
- Request-wait conformance: 3 s is required and 8 s is implemented under ASOS-primary. This stays an explicit open item for AK.
