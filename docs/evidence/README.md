# Selected evidence

These are dated observations and verification records, not claims of current production health. Maintained behavior and operating procedures live in architecture and operations docs.

- [AWS traffic aggregates](aws/api-traffic-2026-09-22.md): request windows, aggregate counts and limitations.
- [Rewrite reference verification](rewrite/README.md): capture diagnostics, selected runtime findings and artifact receipts supporting the reference documentation.
- [AWS diagram verification](architecture/aws-infrastructure/README.md): historical artifact/delivery identity.
- `tasks/`: selected source/operational observations and separate builder/verifier records consumed by maintained documents. Recorded verdicts retain their original candidate and limitations.
- [Repository cleanup verification](tasks/reports-cleanup/verification.md): checks and scope of this migration.
- [Migration mapping](report-migration.json): retained source paths, original hashes and destinations.

The cleanup classified 652 report files at the recorded baseline, copied the selected material and preserved all original local bytes before untracking. Remaining logs, intermediate receipts and copied diffs can be retrieved from [the pre-cleanup Git tree](https://github.com/WizardFactory/TodayWeather/tree/a5fdde1f/reports); they are not dependencies of a fresh checkout. Historical links inside selected records use that revision. Required report content was not re-executed or re-certified during relocation.

Raw capture/receipt JSON is preserved as historical data, so paths recorded inside it may describe the original machine/run. Active document links, tools and screenshot-manifest diagnostics use the new locations. Future runs must not overwrite these records automatically. See [retention policy](../development/artifact-retention.md).
