# S19b selected verification - 2026-10-17 UTC

The common suite completed all 11 existing checks with `verdict: PASS`, `full_coverage: true`, and process exit 0. Execution ran from 2026-10-17T03:19:54.368192+00:00 to 2026-10-17T03:24:26.798504+00:00. This is a local owned-fixture execution, not whole-service prior-release recovery, live shadow or production qualification.

## Execution identity and retained history

- Selected JSON SHA-256: `907258334acf3f7d56244df6152bd6b110ed822b655abf6cd5ef74cf5c7249c6`.
- Common runner SHA-256: `460dd5c922f26777c2104d4b36fb8d653fc62a9efd518d6f7f0ce5d365994045`.
- Artifact manifest SHA-256: `7755e045cf05a893c64ec5a521d6c829ce8298681eed725826df1cbd94c7112e`.
- Checkout HEAD: `9734886971849ea3812ac95e1821978a5aa129c4`, dirty. The manifest revision/profile are caller declarations, not signed build provenance.
- Initial full run JSON SHA-256: `129569a2e8e74b13398fa418816a1ce8f660c8783aaad6cd16c9331571737ea9`. It remains FAIL: nine passed, world returned HTTP 501 and conditional alert failed the accepted assertion. The two outcomes were not relabelled after the retry.

The previous full PASS (functional-2, SHA-256 cc43cb227d8d5de443257847bf80d6bf3ce1e5e627140db22632dbf7b48644a6) remains retained. This selected execution renews all 11 checks after the reporting-only correction. No original wire/provider assertion changed. Raw per-check reports, commands, timestamps, stdout, binary hashes and build logs remain in ignored task evidence. The selected JSON hashes every retained check file. The maintained capture below is formatted actual stdout plus a labelled summary derived from this JSON. Static stdout bytes alone do not establish independent execution identities.

## Observed layers

| Check | Layer | Result | Count / detail |
| --- | --- | --- | --- |
| kma-core | paired-http-replay | PASS | See layer-specific evidence |
| kma-rich | paired-http-replay | PASS | See layer-specific evidence |
| world | http-coexistence-smoke | PASS | See layer-specific evidence |
| warnings | loopback-http-smoke | PASS | See layer-specific evidence |
| summary-model | library-tests | PASS | 27 |
| summary-http | http-integration-tests | PASS | 10 |
| state | library-and-http-tests | PASS | 18 |
| notice | loopback-http-smoke | PASS | See layer-specific evidence |
| conditional-alert | loopback-http-smoke | PASS | See layer-specific evidence |
| warning-push | loopback-http-smoke | PASS | See layer-specific evidence |
| workers | process-matrix | PASS | 27 |

KMA CORE and Rich each compared 220 and 92 candidate responses against their separate frozen baselines, across cold, warm, corrupt-disk and lost-disk passes. Both sides had zero oracle mismatches, and the deliberate perturbation controls were detected. Their frozen baseline timing is transport timing, not a live legacy benchmark.

World retained its original provider-sharing, restart, privacy and frozen legacy coexistence/switch assertions. It is not legacy-free recovery. Warnings used a recorded synthetic provider and owned S3 peer. Summary-model uses library/in-memory doubles; summary-http uses the existing `summary_s3` HTTP tests. State combines library and owned HTTP tests. Notice and delivery checks used synthetic translation/weather/geocode/OAuth/FCM services, and recorded zero external calls. Workers covered all 27 distinct current-factory phase/termination cases; they do not compare an earlier release.

## First-run fixture repairs

The world smoke was missing current native-geocoder settings. It now uses the existing recorded London Google response, synthetic keys, owned Google/Kakao roots and the `geocode,dsf` family. No runtime fallback, golden oracle or weather assertion was changed. Because native recovery reuses the world fixture class, its 10 unit controls were renewed and passed.

A diagnostic-only conditional-alert run observed `alert-admission`. The raw seed lacked the initialized `precipAlerts` and `airAlerts` that actual registration already supplies. Initializing those fields made the existing accepted/one-fetch/one-send/restart-zero assertions pass. Production Rust was unchanged. Original failed artifact SHA-256: `e6193ec881ec7dd6bfddbbc08f5298aa58630296c3bdeba3a68dd8a8a050e6f7`; corrected example artifact: `dd33532d2a6cf7874bf0ba5b9ca96c4d9f54f721c664816cc84698d9d24ca763`. Corrected source: `13b87032d4f0d14de152dfa9e641ccf3f07c998fdfaae6f3a8102e1a7dfbfb1b`. The base revision declaration is qualified by this dirty-source delta and retained compiler output.

The common runner's 14 Python controls cover preflight, selection, false-PASS refusal, hash drift, narrow environment, retained failure and process-group timeout cleanup. They use injected runners/dummy artifacts and are separate from the actual integrated execution. Existing shadow controls passed 31 tests. The initial missing-module import failed before any behavioral assertion; it is feature absence only and does not establish behavioral Red for the original controls. The later reporting correction has an intended assertion-level Red (14 tests, one failed assertion, zero errors), followed by Green and post-refactor 14 OK. An earlier test-edit NameError is retained separately and is not the intended Red. Missing prerequisites and setup errors remain blocked/not-run evidence, never product PASS or intended regression Red.

![Formatted actual command, stdout and report summary](suite.png)

The editable [operator guide](../../../operations/server2-native-verification.md), its [PDF](../../../operations/server2-native-verification.pdf), and the [workflow design](../../../architecture/diagrams/server2-native-verification.html) describe the command, coverage and limits. The diagram specifies tool flow; it is not a deployed runtime claim.
