# Solar-term test fixtures provenance

Factual header and `□ 24절기` table rows extracted from the public Korean electronic gazette (관보) notices for offline parser verification under `server2/tests/`.

- `2024.txt`: Ministry of Science and ICT Notice `2023-0641` (published 2023-06-23, 2024년 월력요항), spaced Hangul layout variant.
- `2027.txt`: Korea AeroSpace Administration Notice `2026-0078` (published 2026-06-29, 2027년 월력요항), unspaced Hangul layout variant.
- `server1-parity.json`: Frozen cross-implementation parity vectors extracted offline from `server1` at commit `e271d8e3` (`server/lib/solarTerms/{calendar,summary,summaryCache}.js`, `server/locales/{ko,en}.json`, and `astronomy-engine@2.1.19`). Includes ranked `v000903` domestic summary outputs, KST-midnight TTL values, 72 UTC crossing instants for boundary years (2026, 2027, 2076), and all 47 KST-midnight-adjacent crossing instants across 2024–2076.
