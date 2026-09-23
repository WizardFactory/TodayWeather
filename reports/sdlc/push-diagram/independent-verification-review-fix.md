# Independent verification: PR2552 review corrections

Verdict: **PASS**. No mandatory findings. Independent-verification iteration 4 of 10.

Reviewer: `/root/verify_push_diagram`, separate from builder. This is bounded independent documentation verification, not a cross-provider PR review or merge-ready assessment.

Candidate: `edb51651c355f13f0745a093c5ed92c9906996a269376144659c072271dbb74f`.
Base: `8472b51bd84c0282253bf62cf155761d335c1470`.
Endpoint: user-authorized PR branch push; no merge authority.

## Assessment

- Recommendation 1 PASS: evidence.md explicitly records 38,069 Android-like callers among 155,998 unversioned requests and leaves client attribution unresolved. AGENTS and AWS correlation bind the 70.72% figure to the monthly window and distinguish the separately dated v000901 Lambda observation from per-request historical correlation. Both cited iOS widget sources contain unversioned weather/coord builders.
- Recommendation 2 PASS: both AWS correlation and evidence pages now link the monthly report and relevant open questions.
- Recommendation 3 PASS: independently converted UTC endpoints to KST: 2026-08-24 04:53:45 through 2026-09-23 04:53:45, end exclusive. The report explicitly keeps daily grouping in UTC. Aggregate JSON/CSV bytes remain unchanged.
- Recommendation 4 PASS: independently browsed the official AWS CLI installation guide on 2026-09-23. Its Linux install-script section confirms x86-64/ARM support, package download verification, per-user installation, default `.local/share/aws-cli` and `.local/bin` locations, and XDG overrides. The documented recipe uses that official installer and adds persistent executable discovery. Bash syntax checks pass. The text explicitly says installation was not executed and restricts earlier authenticated behavior to CLI v1.46.1. Official source: [AWS CLI installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), Linux install-script section, inspected lines 50–65.
- S3 boundaries PASS: the cited sanitized receipt records absent bucket/account Public Access Block configuration, no bucket policy, CanonicalUser-only sampled ACLs and denied anonymous listing/HEAD. Text correctly treats these as dated bounded observations, neither proof of exposure nor a complete privacy assurance. The three sample dates and 08:04 UTC observation agree with JSON; full object/access-path assurance and hardening remain follow-up. No AWS mutation is claimed.
- Token explanation PASS: actual service source restores fcmToken from pushData2, compares token values before updating, immediately replaces the in-memory token after PUT, and only persists via separate savePushInfo. Actual route sends `invalid body` without explicitly logging that string, while logging the request body earlier. The added text correctly bounds repeated callbacks, fresh sessions, explicit save, and the lack of proved production causality. The prior isolated stubbed execution receipt is described as such, not as live device behavior. Independent math confirms monthly 403-only 86.57%, combined HTTP errors 96.29%, September 21 96.43%, and partial September 22 92.80%.

AC1, AC2 and AC3 PASS for the current documentation correction.

## Checks actually executed

1. Read review-fix amendment, candidate manifest, build/self-verification artifacts, relevant review-assessment investigation and sanitized S3/token JSON. Inspected git diff for all changed guidance/explanation/report files.
2. Independently matched all 15 file hashes in the manifest. Checked 117 local links and Markdown anchors, all resolving. Parsed and syntax-checked seven sh/bash blocks using `bash -n`; none executed. Verified CLAUDE.md remains the single-line canonical adapter `@AGENTS.md`.
3. Python datetime conversion and arithmetic from unchanged aggregate JSON checked KST, traffic percentage, Android-like count, and all new 403 denominators.
4. Read actual client load/save/update/init token methods and server PUT handler. Inspected both widget weather/coord constants. Checked application-source diff against the supplied base is empty and all 14 diagram source references still match their pinned revision.
5. Compared current diagram JSON/HTML and monthly CSV/JSON hashes with the previous publication manifest: unchanged. Reused existing independent source/visual and exact-artifact browser evidence accordingly; no graph change requires rerendering.
6. `git diff --check` passed. Browsed only the official AWS documentation URL for installation facts; no installer, AWS account, SSH, application or provider requests occurred.

## Limitations

No installer execution, authenticated CLI test, S3 re-audit, source VM re-execution, browser rerun, production call, credential access, repository edit, shared-state write, commit or push was performed. The existing isolated token receipt was reviewed and independently checked against source, not rerun. S3 evidence remains its original dated bounded sample. The official documentation establishes installer guidance, not successful installation in this environment. Only this /tmp report was written. Main owns state, commit, push and PR status.

## Consumed identities

- `AGENTS.md`: `7a562fe5936ec043a8f721b7e6b8a33ba2bc49c65f3176888531428f0d7eebf4`
- `docs/architecture/README.md`: `19330914bb466ab6318090dd6875d75521fb1ca03c028a46fb7f7f628f67cd1d`
- `docs/architecture/ec2-access.md`: `51ded4fca840050a989b9bc8dab2d264e8f71596b6093d417a9e672c7a7779d4`
- `docs/architecture/push-notifications.md`: `935ce5480a37e6a183ab44653cedfc31f049fbf29907ce537dd5e6bd76be46a3`
- `docs/architecture/diagrams/push-notifications.json`: `3569ff5ba04bac46380404010b18e5b64a7a92aa1e5835d7c4e7f77e2e407ae3`
- `docs/architecture/diagrams/push-notifications.html`: `8dd9d4a93b93d0aa6d8a48f3f0ba21075906da988049ab754773a4aeccf79dfe`
- `reports/aws/api-traffic-2026-09-22-daily.csv`: `00ed357e49bf7af4d3e2f4e041ab15b637fb5743acc36fa5a126e0c5a814b915`
- `reports/aws/api-traffic-2026-09-22-evidence.json`: `0f15f96a401cc1b8a139d5a03a46e572b9982ae3875bfc57ae523560a2206140`
- `reports/aws/api-traffic-2026-09-22-routes.csv`: `769f88fdf3a32961954de4dc8fe8b72727956160471f5011c6ebae5f20fe7c7e`
- `reports/aws/api-traffic-2026-09-22.md`: `83194a6431b8c35483eaa0e31cfbf470988e7bb02528d16836391e100a5e2725`
- `docs/architecture/aws-code-correlation.md`: `7c5c76578fc50edb363db4e0f8cd92488e1bbe247c6f4995ec0d842b891ff7d1`
- `docs/architecture/evidence.md`: `6b59423582f30363700062a4abd6ed1ea99a345212523b9b571c619cd18dea6d`
- `reports/sdlc/pr2552-review-assessment/investigation.md`: `5b15afd024c08b320d0a2f0e9fe3598e0b38a0e9820bf595efbc45d4d9fabbd1`
- `reports/sdlc/pr2552-review-assessment/s3-public-access.json`: `f20ddefa829fb11970c6890c902e7b026579465e5d6cf1508e10fc4376d62bf5`
- `reports/sdlc/pr2552-review-assessment/token-reproduction.json`: `f5a9aed2ce8380cb8662862e04d49475477c617ed70d08060526801741a10b7d`
- `reports/sdlc/push-diagram/review-fix-amendment.md`: `66408b2f1ea44f1a97895a7947454a39a0b37d421218a5d1b1425cafd36815ae`
- `reports/sdlc/push-diagram/review-fix-candidate.json`: `94d0ab2971c54cd6cd8ec9fed5734afc72a2d6b5e3797ec7a507e01938661df6`
- `reports/sdlc/push-diagram/build-review-fix.md`: `edb24ff0b455b89c68c048ba0fcfe09a784ec54c35a1cbfd53395d3972475d00`
- `reports/sdlc/push-diagram/self-verification-review-fix.md`: `96b2bbcb95e33f3506213801a081bef0caa702ff73e6d58fbafd26c381d9b0ef`
- `reports/sdlc/push-diagram/publication-candidate.json`: `6517676e6b1d670440695fdcb903c1bbf3e5938b0a176acdc7966716b74c6cb8`
- `CLAUDE.md`: `336cc4fbf19beaada7ccf9986414fa91851a8d7a07dfb3ccbe800a69eed0ab49`

Written at 2026-09-23T08:22:55.066774+00:00.
