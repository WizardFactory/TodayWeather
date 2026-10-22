# Structural cold-build CPU work (#2849)

AK requested a PR for the two checked structural optimizations after local feasibility verification. Endpoint: pre-merge; no merge, auto-merge or deployment. Parent PR #2852 remains unmerged at bd7122ae.

- AC1: Short/Shortest winner selection, publication fences, insertion/key order, retention and original pre-retention count/byte/row errors remain equivalent to the bounded eager saver. Current merging stays eager.
- AC2: The bounded parser preserves scalar conversion, duplicate/unknown-field identity, malformed-page handling and conservative admission while transferring ownership instead of copying Node strings.
- AC3: Remove timing experiments, retain bounded workspace ownership, pass relevant regression/integration/smoke and placement checks, and document measured limits honestly.

The <=2.5 s p95 objective of #2849 is still unmet. This incremental PR reduces CPU work; it does not claim completion of the overall performance objective. No cache retention/SSD, S3 packs, runtime settings, provider calls or infrastructure changes.
