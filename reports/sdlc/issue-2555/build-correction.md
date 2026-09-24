# Review corrections for #2557
User authorized fixes and push for comment [5807240137](https://github.com/WizardFactory/TodayWeather/pull/2557#issuecomment-5807240137). Parent 5e653285726e4035490ca13de532fdb8ccb7e218. Source candidate is recorded in candidate-correction.json.

- Fixed all 16 day-4–7 sea height mappings. All 26 fields now have distinct-value assertions and later-day invalid-value regressions.
- Reject totalCount/item-count mismatches before organization. One page, 999 items and existing request/retry budgets remain unchanged. This prevents silent prefix persistence but does not add pagination; larger products remain unsupported.
- Normalize raw or exactly once-percent-encoded service-key strings via one decode and one query encode. Preserve literal raw plus, avoid double encoding; malformed escapes/missing keys fail with static diagnostics. Literal percent must be encoded as %25; no production config inspected.
- Added test:offline and a dedicated read-only GitHub Actions job with Node22.22.2 and isolated Mocha2.5.3/xml2js0.4.23/async2.6.4. Default legacy npm test/Travis/deployment paths unchanged. Official action tag references resolved at creation and pinned by SHA.
- Added explicit hourly short activation hold until period consumers are repaired. No guessed conversion or active scheduler changes. Updated collection docs and regenerated Archify JSON/HTML.

Verification: 17 intended failures against parent implementation (86 passing); corrected suite 103 passing. Separate XML/requester/storage smoke verifies 26 sea heights, rejects later-day invalid heights and truncated pages without additional writes, and checks query normalization/log secrecy. Detailed commands/outcomes in self-verification-correction.md. Remote reviewer resolution is pending; author correction is not reviewer closure.
