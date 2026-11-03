# Linux bundle implementation plan

One PR, root owner, base main 1f076b80. [Specification](../specs/issue-2813.md); exact paths/outside reasons: [S20f declaration](../server2/config/tasks/S20f.json). Execution notebook remains root-owned `.planning/2026-10-13-server2-next-sequence-after-s10` in the coordinating checkout; generated task receipts stay ignored.

1. Prove the missing native output using the existing artifact snapshot; test invalid Cargo selection, source/payload tampering and fixture-path admission.
2. Implement a small build/export CLI using existing ELF/source validation and native registry. Consume selected Cargo JSON; preserve all regular tracked server2 inputs and hashes. Do not modify runtime, dependencies, native-suite checks or global build settings.
3. Add controls plus native export to tools/ci.py inside the existing recursive artifact upload. Reuse the CI target directory. Build sequentially; no host compilation or new dependency cache.
4. Run local controls and separate real copy/validation/tamper CLI smoke using retained ELF inputs. Then obtain actual clean CI Linux bundle, verify on the owned host and run existing native suite, widget and narrative checks; keep all original failures. CPU Standard/2GiB may limit this host; no automatic class change or replacement.
5. Update actual usage capture and manual PDF, placement/artifact checks, independent review (cross-provider fallback under installed SDLC), current CI and authorized main integration. No live operational rollout.

## Scenarios
- OP-BUILD (AC1): CI operator on clean exact checkout builds selected release targets, exports fresh native/, inspects eleven roles and two probes. Missing/ambiguous Cargo artifacts or a dirty source tree abort; existing two-binary export remains.
- OP-TRANSFER (AC1/AC3): operator copies bundle to an empty owned host, verifies all hashes/static ELF and explicit fixture mapping. Changed source/binary, symlink, unexpected extra file or absent mapping blocks execution; do not overwrite an existing checkout.
- OP-RUN (AC2): operator runs native_suite, widget_smoke and narrative_smoke with the transferred binaries and frozen inputs; inspect actual reports and bounds, stop owned processes. No live provider, S3 account or push settings enter children.

Risks: Cargo target identification and embedded fixture paths are the main regression risks. Reject ambiguous records and verify exact source mapping. Shipping only binaries was rejected because tests use CARGO_MANIFEST_DIR. Compiling on the small host was rejected to avoid resource/cost churn. Cleanup only ignored regenerable output after consumers finish; preserve binaries/hashes/reports. A tool-only bundle is not a new previous backend release.

## CI transfer amendment

Official upload-artifact v4 excludes hidden files by default and ZIP transport loses executable/directory modes. The S04 gate intentionally pins the existing shared workflow shape. Keep that workflow unchanged. The producer will optionally create a fresh verified `native.tar.gz` containing all entries and modes; `tools/ci.py` stages the unpacked tree outside the upload directory and puts only this archive below the existing artifact upload. No shared path or placement-gate exception is needed. This also avoids the directory-mode loss observed in the coordinator's files-only transfer archive. Never copy credentials: only regular tracked server2 inputs enter the archive.

Retain original source3/host run identities. Final packaging code/tests/CI may differ; prove every runtime/fixture/harness and the thirteen executable bytes unchanged before reusing those runtime results. Renew producer/archive controls and real Linux archive roundtrip on the final candidate. Actual CI download must validate every path; the whole failed initial host run remains historical.
