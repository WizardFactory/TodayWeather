# PR publication scope amendment — 2026-09-24

Source: AK explicitly requested “make pr” after the verified local implementation handoff. The endpoint now includes committing this candidate, pushing its feature branch and creating one PR against `WizardFactory/TodayWeather:master`. Merge and deployment remain outside this request.

The existing [local completion](completion.md), stage counters and receipts remain historical evidence. They describe the completed local endpoint, including the absence of a commit/PR at that time. This amendment extends publication authority; it does not rewrite those results or claim an eligible cross-provider PR review.

## Candidate and verification

All 60 entries in [candidate.json](candidate.json) were checked against the working tree before publication and match the independently verified candidate `sha256:184769c5a403bff6971dcd94047847c6dde0f1ded0af7b004174349b47af4e13`. Local SDLC pre-commit validation passed. [QA-2](qa-2.md) passed after correction of all mandatory local findings. Recorded checks include TypeScript, production build, 27 tests and eight real Chromium/BFF scenarios.

The remote base advanced from `87b8855f308611a07897cd3a39c45fefb3088d77` to `01eb787b10cc2694ea52642b8b24ad8c5426503e`, incorporating unrelated gather/RSS work. Only `.gitignore` overlaps this candidate. The base was integrated without conflicts, preserving its additional raw-diagram receipt exclusion and adding exclusions for the two local web diagram receipts. All 59 other candidate files remain unchanged. Historical QA attests its original candidate; the publication integration checks attest this combined tree. Record the final head, base, verification and PR URL in the durable PR description.

Raw Archify browser-check receipts and captures stay local per repository guidance. Authored diagram JSON/HTML, assessments and app screenshots are publishable. Selected non-secret execution logs are retained to support the test receipts; temporary work plans, dependencies, generated builds and private runtime configuration are excluded.

After base integration, TypeScript and the production build passed again, followed by 27 tests and eight real Chromium scenarios (20.1 seconds, demo BFF). [Integration evidence](publication/integration.json) binds the resulting 60-file source manifest and all four retained execution logs. Previously reviewed app screenshots and historical execution receipts are preserved. Native/server files match the new base exactly; no application behavior changed during publication.

The existing independent QA context also returned [PASS for the publication integration](publication/independent-check.md), verifying all 159 incoming baseline files, the 59 unchanged candidate files and the three-path ignore-only delta. Its original local QA verdict remains applicable to the unchanged application.

## Publication boundary

The new web workflow performs verification only. The legacy Travis deployment recipe is restricted to `master`; this operation publishes a feature branch and PR without merging. No native build, collector startup or hosting deployment is part of publication.

Reference issue [#2558](https://github.com/WizardFactory/TodayWeather/issues/2558) without automatically closing it. Full parity remains open: conditional/forecast notifications, real installed-device push, provider freshness/international coverage, commercial/native policy and public hosting operations. CI results and deployment readiness must be reported separately from local test results.
