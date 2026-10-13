# S12 warning fixture provenance

Recorded data.go.kr `WthrWrnInfoService` responses, byte-identical copies of
`server/test/offline/fixtures/kma-warning/*.json` at revision
`ca8735cf937a634e7af57396d605e26db8bfc4ff` (recorded for #2609 on 2026-09-27).
Tests and the release smoke embed these copies; nothing reads the legacy directory.

| File | SHA-256 |
| --- | --- |
| `brk-news.json` | `bc81504f7b939aa1a0096d7749f43a5865898fcaa9e86a77daa0b3befca46f8d` |
| `err-30.json` | `b604c42861bd3f7fadd0a1fe4a4e9c0d18ebca873bc801d36fa02849409700c4` |
| `err-99.json` | `e6d8be42f30a3e229c874a22c7d4967e61adc87097f29b70b906400cdef54584` |
| `pwn-cd-0921-0927.json` | `0c42f5958d5a4d00ae4d62c62bd72c959188bd0421df56c52b1b2afaffa13ec4` |
| `pwn-cd-daily-excerpt.json` | `901b0207c8101d5e93d4dc079186a39e78dbcf6f69321a07a626c478cce6c18d` |
| `pwn-status.json` | `7a272f41ac1a805851a8d6014f4450904ec8b2fb3228b1146c7ea1948f351a27` |
| `wrn-msg-0926.json` | `c4299c36a19b7db29389a4f9a1234638634a7c0593f360c6470269672e1e186c` |
| `wthr-info.json` | `5c64db031a7ca165d50735cffef1cf2e99fd873116f922c10f0d4eea7d13a5e2` |
| `wthr-pwn.json` | `d3d5d90e1578e1669d107f39b912ab345ca31d85782da68f531dd0f7dfdb1b72` |

## `oracle-expected.json`

Expected outputs of the legacy pure functions (`parseSpecialText`, `parsePreliminaryText`,
`zonesForTown`, `prepareEvents`/`applyEvents`, `specialInfoFor`, `_insertLineChange`,
`announcementOf`, `kstDate`) for the recorded texts/rows above and 20 towns. They were
produced on 2026-10-13 by executing the legacy modules at `ca8735cf` with Node.js v24.19.0
and a stubbed `mongoose`, using an uncommitted oracle script retained with the task's local
evidence (SHA-256 `eceb166f7f5785072cc53d77bab2bb7a21f66017a013df192efa0f59f3db4fd4`).
The S02 goldens in `../../golden/records.json` remain the wire-parity authority.
