# Offline legacy collector helper provenance

These helpers were ported unchanged from the executable source retained in
`server2/tests/domestic/fixtures/SOURCE-PROVENANCE.md` (S15b-1). They execute the
legacy collector/parser/saver with Mongoose5.1.2 over a private in-memory driver.
The original documented SHA256 values identify those source bodies. They are
verification-only, never runtime dependencies. `record.js` composes them with an
independent legacy HTTP response and adds explicit network/private-input guards.
Parent authorized this exact recorder legacy-source-read exception2026-10-16.

The resulting fixture embeds actual helper, legacy source, dependency package manifest and static seed SHA256 values. See [fixture provenance](../../../tests/domestic/fixtures/S3-RESPONSE-PROVENANCE.md) for exact recording and denominator limits. Mongoose is pinned to 5.1.2; Node to 16.20.2. All other required packages use the legacy pinned versions.
