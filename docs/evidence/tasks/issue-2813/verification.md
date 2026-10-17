# Linux native verification bundle - 2026-10-17

Scope: [#2813](https://github.com/WizardFactory/TodayWeather/issues/2813), prerequisite of [S19](https://github.com/WizardFactory/TodayWeather/issues/2704) / [S20](https://github.com/WizardFactory/TodayWeather/issues/2705). Actual owned host `i-0e0147ba431c7c68f`, t3.small Spot, ap-northeast-2d. No production qualification, traffic mirror, real provider/S3-account call or live device send.

## Build and input binding

The final local Linux build snapshot is `8dcd717f9f80f314df89585c5ff802783da7496d` with server2 tree `b0e21283b5c7af36ccf936194ecfc88dfa077679`. This is a local source snapshot, not a GitHub PR head. Its 694 regular tracked server2 inputs, 11 native roles and two probes are exported. Final tar SHA-256 `7767a25d688ec8863c3d8c3b6f77b90d50932df9f5823536df2812decbed3dd7`; bundle metadata SHA-256 `826dc482dbe8c2e9541d17dd824cc035047aa83b9a53a85927688683f38fa2de`. The original two-binary CI export remains unchanged.

Actual runtime execution used source `9fc48ffb4143ab5b9aa6db581053f4682cfbde6f` / tree `54f8b0b082cb5c6215f8ed510d2cac9ba01d0387`. The final packaging source differs only in `tools/native_artifact.py`, its test and `tools/ci.py`; every runtime, fixture and harness byte is unchanged. All thirteen executable hashes match between those builds. Actual server2 executable SHA-256 is `b7654b6ca2fc2710521ff3726de4845dbe4fa00cfa400d76632e4b4be9e9a48e`. The PR integration record binds its final commit/tree without relabelling these executions.

Actual x86_64 Linux/musl release builds used locked Cargo and the existing local Linux container facility with two build jobs. The first build compiled examples in 7m57s and tests in 2m06s, then exposed an empty Cargo-message separator bug. Cached subsequent builds renewed export on the corrected source. Final controls cover 14 cases, including real CLI archive extraction, hidden inputs, source modes and tamper blocking. Existing artifact controls (4) and native-suite controls (14) remain passing. Separate offline Linux CLI/real release foundation smoke passed; it is Linux/amd64 Rosetta, not native EC2 performance.

Tar transport retains hidden tracked inputs and modes through the unchanged shared upload. The producer validates every archived payload against its source bundle before success. This follows the [upload-artifact v4 input contract](https://github.com/actions/upload-artifact/blob/v4/action.yml) and [documented archive/permission limitations](https://github.com/actions/upload-artifact#limitations). `.env.example` has empty AWS/provider values or quoted empty arrays; no untracked account/configuration files enter the export.

## Actual EC2 outcomes

Before the original source3 native/widget/narrative/logging batch, the coordinator
checked that the existing `/work/server2` symlink belonged to its earlier owned
verification run, then replaced only that owned mapping with
`/home/ec2-user/server2-verification/issue-2813-native3/source/server2`.
The retained `host-command3.sh` calls `native_artifact.verify(b,
require_source_root=True)` before launching the children; the targeted retry's
`host-command4.sh` does the same before either child. A failed call raises before
execution. These in-process admission calls succeeded, but their returned JSON
was not printed as a standalone CLI receipt. The batch stdout therefore does not
contain a separate `--verify --require-source-root` command result. This describes
the retained execution code and results; it does not claim an additional run.

A new standalone strict CLI check on the same retained source3 bundle at
2026-10-17 14:58:38 UTC returned PASS / exit 0 and printed the actual
`/work/server2` mapping. Its stdout SHA-256 is
`d6acf4b6592e2522b3db006c58efe125cedff3c6292e2492a1c702a8e46cd921`. This admission-only check started
no product process and did not repeat or relabel the earlier native runs. System
nginx remained inactive.

The original full native run is **FAIL**, with nine PASS and two failures when KMA report metadata invoked the absent Git executable. It is preserved at report SHA-256 `13301656732217aa8bb527a0a572aaad2b4cd1bc0c53649b6a1e18d5c96f2c83`. After installing Git 2.50.1, only CORE/Rich were rerun: both PASS, report SHA-256 `81fdddf09f85634dfc8d42f8a364087c388216e1f98d44e7b730c1cc35c2fce4`. Neither native report has `full_coverage=true`; eleven distinct checks have passing evidence across the two runs. This is not represented as a successful whole first invocation.

| Check | Selected passing evidence |
| --- | --- |
| kma-core | Targeted retry: 55 cases x 4 passes; 220 oracle comparisons per side, zero mismatches, perturbation detected |
| kma-rich | Targeted retry: 23 cases x 4 passes; 92 comparisons per side, zero mismatches, perturbation detected |
| world / warnings | Original owned HTTP/S3 checks PASS |
| summary-model / summary-http / state | Original 27 / 10 / 18 tests PASS |
| notice / conditional-alert / warning-push | Original owned peers PASS; no actual push endpoint or device |
| workers | Original 27 process cases PASS |

Separate actual `/ww` HTTP smoke PASS: raw contract, HEAD/304, missing gcode 400, disabled-family 404, restart identical bytes and zero extra weather/air work with providers disabled. Narrative and logging smokes also PASS. These do not establish installed iOS widget activation, full provider startup, live S3 recovery or production parity. The S3/provider/FCM peers are owned fixtures; baseline timings are frozen-response transport, not live legacy execution.

Original host launcher syntax and writable-directory transport failures are retained. The files-only transfer omitted directory modes, allowing seven Python bytecode files; all 694 original source payloads and executable hashes remained unchanged. Those bytecode files were inventoried and removed, source directories restored read-only, and final targeted execution verified both payload hashes and exact file set unchanged. The final tar archive includes the directory entries and preserves their modes.

The KMA retry batch's largest child RSS was 121000 KiB; this is not a full production working set or a capacity qualification. No quota/headroom or seven-day shadow claim is made.

## Open operational result

The separate actual EC2 nginx rehearsal failed at `nginx -t`: distro nginx 1.30.5 attempted `/var/lib/nginx/tmp/client_body` as the unprivileged account. No deadline assertion ran. [#2814](https://github.com/WizardFactory/TodayWeather/issues/2814) owns that correction; the system nginx service remains inactive. It is not a native-bundle PASS or a production listener result.

The previous full backend release still lacks forecastNarrative and remains ineligible under AK's no-omission decision. These results do not close #2704/#2705 or authorize traffic mirroring, live sends, final-state copies or cutover.

## Actual CLI record

![Typeset actual retained CLI results](linux-bundle.png)

The image retains the earlier packaging snapshot `af6e72af` / tree `dbc3f845`
and its source3 execution mapping. The final review-correction snapshot above
changes only the producer and its controls from that snapshot; all thirteen
executables and runtime/fixture/harness bytes remain identical. The image renders
the actual retained CLI records and their source mapping; it is not a browser or application UI screenshot and does not constitute another execution. The browser/webview capture host timed out and native window capture was unavailable. The operator PDF uses this labelled CLI results capture under the API/CLI documentation alternative; raw failure and successful execution files remain retained.
