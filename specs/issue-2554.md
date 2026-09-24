# Specification
Inputs: intent/issue-2554.md and reports/sdlc/issue-2554/investigation.md.
Fix wdEn assignment using existing convertWeatherString, handling absent/unknown direction with -1. Preserve schema and weather English code.
In service merge validate finite numeric RSS values, use ws as m/s and integral wd 0..7 times 45 degrees (0 is north; 8, fractions and nonnumbers are rejected). No derivation of vector components.
Use field-specific source validity: nonnegative precipitation/humidity/wind speed and codes; temperature above -50 including real -1 C, excluding -999; components above -100. Absent/null/nonfinite/non-numeric values are unusable. Equal publication fills undefined/null/nonfinite/sentinel base values; newer replaces only with usable RSS; older exits. Preserve optional base fields.
Match strictly future RSS slots by YYYYMMDDHHMM, including first/all-future and midnight. Existing KST time helpers and downstream conversion stay wired unchanged. tmx validation reads tmx at 15:00; tmn at 06:00.
Both DB formats retain names/ws/wd on disk. No migration: existing wdEn sentinel rows remain until ordinary refreshed collection. RSS freshness is separate from observations/shortest.
Verification: test before implementation, matrix of DB modes/publication order/compass directions/sentinels/slot boundaries; separate actual response middleware smoke with isolated data boundaries and unit conversion; architecture validation/browser/visual checks and independent assessment.
