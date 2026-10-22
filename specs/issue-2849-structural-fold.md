# Structural fold contract

Base: PR #2852 at bd7122ae. See [intent](../intent/issue-2849-structural-fold.md).

For Short and Shortest, consume acquisitions in their existing order. Validate each admitted Row eagerly with checked materialization and strict schema casting. Keep one owned strict data Doc per coordinate/forecast key, replacing at the original publication fence. Track the exact logical outer-document weight and collection-root layout before retention, including the temporary coordinate weight used by an update. Admit each row at the same count/byte thresholds as the eager saver. Rows rejected by the fence are not validated, matching baseline.

Retain only schema-cast data, bounded to DOCS keys; discard uncast Row/unknown fields each iteration. Slot metadata and index are bounded by the same key cap. Materialize final outer Docs in original key order only after selection and retention. Current continues using GridDocs because it merges missing fields. Fallible allocation failure remains Capacity.

The parser still builds and validates the complete Node tree under the existing plan. Transfer object keys and scalar Strings to sorted Items without copying. Keep original charges, full item equality, duplicate JSON key handling, page and error rules.

AC1 maps to differential fence/date/row/byte/count/key/ledger checks and 13-view golden smoke. AC2 maps to parser oracle tests, existing bounded cases and golden smoke. AC3 maps to Clippy/fmt, placement/artifact checks, bounded metadata tests, whole library/integration tests and native HTTP reference equality. No new runtime flag/dependency.
