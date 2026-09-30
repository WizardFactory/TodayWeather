# Selected evidence

These are dated observations and verification records, not claims of current production health. Maintained behavior and operating procedures live in architecture and operations docs.

- [AWS traffic aggregates](aws/api-traffic-2026-09-22.md): request windows, aggregate counts and limitations.
- [Rewrite reference verification](rewrite/README.md): capture diagnostics, selected runtime findings and artifact receipts supporting the reference documentation.
- [AWS diagram verification](architecture/aws-infrastructure/README.md): historical artifact/delivery identity.
- `tasks/`: selected source/operational observations and separate builder/verifier records consumed by maintained documents. Recorded verdicts retain their original candidate and limitations.
- [Repository cleanup verification](tasks/reports-cleanup/verification.md): checks and scope of this migration.
- [Migration mapping](report-migration.json): retained source paths, original hashes and destinations.

The cleanup classified 652 report files at the recorded baseline: 533 under `reports/sdlc/` (the narrower count in #2645) and 119 under other report directories. It copied selected material and preserved original local bytes in the author’s checkout before untracking. Remaining logs, intermediate receipts and copied diffs can be retrieved from [the pre-cleanup Git tree](https://github.com/WizardFactory/TodayWeather/tree/a5fdde1f/reports); they are not dependencies of a fresh checkout. Historical links inside selected records use that revision. Required report content was not re-executed or re-certified during relocation.

Raw capture/receipt JSON is preserved as historical data, so paths recorded inside it may describe the original machine/run. Active document links, tools and screenshot-manifest diagnostics use the new locations. Future runs must not overwrite these records automatically. See [retention policy](../development/artifact-retention.md).

## Updating another clone or worktree

Pulling, merging or rebasing this cleanup into another checkout removes previously tracked `reports/` paths there, including originals whose selected copies moved into docs/tools. The author's local preservation does not preserve other checkouts. Back up any local-only or modified report content outside the checkout before updating; Git history only recovers committed bytes.

To recover the complete committed baseline without changing the index or overwriting current local reports, run from the repository root:

```sh
report_restore_dir=$(mktemp -d)
git archive --format=tar --output="$report_restore_dir/reports.tar" a5fdde1fb5bf0d84a4af7aac8815b3690a57a8c2 reports
tar -xf "$report_restore_dir/reports.tar" -C "$report_restore_dir"
```

The recovered files are under `$report_restore_dir/reports/`; review or copy selected files as needed. If the baseline object is unavailable in a shallow clone, fetch the required history explicitly first. Avoid `git checkout <baseline> -- reports`: that also stages the old files and reintroduces generated output into the proposed commit.
