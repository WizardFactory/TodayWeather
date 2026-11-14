# Intent: server2 log pipeline LP-3 (#2980)

Source: AK, 2026-11-14 — decisions per recommendation, "구현 진행" for [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977), then "머지하고 작업계속" after LP-1/LP-5/LP-2 merged. LP-3 is [#2980](https://github.com/WizardFactory/TodayWeather/issues/2980).

- **Outcome:** a new or replacement instance ships its logs from the boot configuration alone (no SSH, no static key); every stream and object names its instance and boot; several instances never mix records; a disk that survives a restart ships its backlog.
- **Endpoint:** PR to `master`, reviewed and merged under the standing "머지하고 작업계속" authorization. No deployment and no AWS change.
- **Design choices (recommendations applied):** identity from IMDSv2 with a machine-ID fallback; the boot configuration is one generated user-data script that pins a commit and each pipeline file's SHA-256 and downloads the files from that commit (embedding them reached EC2's 16 KiB user-data limit); a surviving disk is handled by per-boot backlog readers seeded from the saved position (Vector reads only the current boot on systemd 250–257).
- **Excluded:** Spot interruption notice and time budget (LP-4, #2981); the qualification host (LP-6, #2983).
