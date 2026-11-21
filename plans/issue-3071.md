# #3071 implementation plan

Spec: [supplemental hourly forecasts](../specs/issue-3071.md).

1. Run test-first checks through the server1 overseas route. Assert exact UTC
   time, fixed units, valid zero, cache behavior and backward compatibility.
2. Extend the existing Visual Crossing request. Preserve the provider epoch
   through the DSF parser and schema with optional columns. Publish the
   supplemental series from the current VC forecast record on v000903 only.
3. Carry it through weather-core, TWDomain/TWModel and Android core-domain/model.
   Use the normal data paths in tests for desktop/PWA and native consumers.
4. Update mobile API and collection docs and their affected diagram contract.
   Verify the actual response with a separate local HTTP smoke.
5. Publish one PR against master. Review the exact head, run required CI and
   verify merge and production coupling.

The largest regression risk is treating one-hour provider metrics as existing
three-hour weather rows. Verify a non-three-hour slot in the new series and
retain a fixture asserting the legacy cadence and values. Using a second
provider request would repeat record charges and create a second cache lifecycle.
This contract adds optional fields to the same cache schema and needs no backfill.
Rollback is a code revert and existing records remain readable.

| Scenario | Steps and expected result | Failure behavior |
| --- | --- | --- |
| S1 London or Tokyo overseas location | Request v000903 with the recorded local hour fixture and inspect the future UTC slot, expected units and unchanged legacy forecast cadence (AC1, AC2). | Missing/invalid provider values are omitted, and old cache and legacy route requests still return usable forecasts. |
| S2 Weather client data | Open a WebApp forecast or a native weather detail through its normal response normalization using the same server1 shape (AC3). Read a zero and a dated modeled forecast. | Cached/downgrade responses without the new series continue to load. |
