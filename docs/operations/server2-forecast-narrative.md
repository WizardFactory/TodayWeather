# Native national and regional forecast narratives

S20e / [issue #2809](https://github.com/WizardFactory/TodayWeather/issues/2809)
ports the optional object from merged PR #2805. This is repository and local
verification work; production eligibility, installed-widget behavior, live
provider quotas and a complete previous release remain separate S20 gates.
Client presentation is issue #2803.

## Response contract

Successful domestic KMA responses choose a regional office from their assembled
`source: KMA` and `regionName`. National `KR` responses use office 108. Country
matching is case-insensitive after URL decoding; another country receives no
national narrative. National child weather rows omit regional narratives.
Weather/air fields and requested units retain their existing contracts.

The optional root field contains `stationId`, `region`, `announcement`,
`expiresAt`, `text`, `language: ko`, `source: KMA` and `textFormat: plain` in
that order. Announcements are real 12-digit KST calendar minutes, converted to
UTC ISO strings. Accept 0 <= age < 24 hours. The original Korean text keeps its
characters and line breaks, with CRLF/CR normalized to LF. Render it literally;
HTML-looking text is not trusted markup.

| Office | Region |
| --- | --- |
| 108 | National |
| 109 | Seoul, Incheon, Gyeonggi |
| 159 | Busan, Ulsan, Gyeongnam |
| 143 | Daegu, Gyeongbuk |
| 156 | Gwangju, Jeonnam |
| 146 | Jeonbuk |
| 133 | Daejeon, Sejong, Chungnam |
| 131 | Chungbuk |
| 105 | Gangwon |
| 184 | Jeju |

The native map preserves PR #2805's full province names, short names and renamed
province aliases, including Jeonbuk/Gangwon special autonomous names and the
accepted Jeonnam-Gwangju name. It does not use a user's exact coordinates as
the narrative storage identity. Missing, expired, future, wrong-office,
malformed or unavailable optional data is omitted. A prose failure does not
change a weather status or create a legacy fallback.

Attached prose caps cache age to the lesser of the existing age, 300 seconds and
whole seconds until expiry. Direct and gateway writers apply the bound before
HEAD/304 handling. ETag covers the final body; a HEAD or304 has no body. Existing
no-store error responses stay no-store.

## Collection, storage and stop

Native KMA/town serving constructs one inert narrative service. After both
listeners bind, the process starts a separate owned worker; its first tick is
delayed 180 seconds. Later ticks are 180 seconds apart, skip missed ticks and never
overlap a cycle. There is no startup pre-collection requirement and an HTTP
request never starts a narrative provider acquisition. Ordinary weather's
existing on-demand acquisition remains independent.

One cycle visits ten offices serially using `DONGNAE_SECRET_KEYS` and
`VilageFcstMsgService/getWthrSituation`, page 1 / numOfRows 10. The native S08
executor preserves its existing funded same-key retry. Auth/quota/funding or
invalid candidate failure can advance through the configured key ring once;
transport failure does not advance that ring. A provider step has a 30-second
deadline; S3 publication has its separate bounded allowance. One office's failure
does not prevent the remaining offices from being attempted.

Funding is per API/key/KST day, separate from warning and grid APIs. The official
[dataset 15058629](https://www.data.go.kr/data/15058629/openapi.do), read 2026-10-17,
documents a 10,000/day/key development allowance. This is the default, not an
observed operating allowance or quota-headroom measurement. No new verification
mode, secret setting or production enable flag is introduced.

Original response bytes use existing S06 raw records under source
`kma-forecast-narrative`, kind `overview`, with a named office identity. The
v2 catalog partition is the publication's 12-digit `tmFc`. The first committed
conditional-absent single-record catalog wins. A later differing body cannot
replace it, even if its fetch timestamp is earlier. An unreferenced losing raw
object does not become serving authority; do not repair it into the winner.
Ordinary multi-record catalog union semantics remain unchanged.

After memory loss, bounded S3 index/raw reads for the relevant two KST days
rebuild the object. Reads wait within the request deadline and at most two
seconds for this optional lookup. Ten office caches have a 30-second refresh;
every return checks publication freshness. A successful local publication
invalidates its office cache. Storage ambiguity, corruption or incomplete
discovery omits prose. No Mongo query or runtime legacy-file read is involved.

On shutdown, the process aborts and joins the narrative worker before its
existing listener/delivery drain. Pending cycles are owned by that task, not
detached into a new scheduler. This feature writes no warning feed, zone,
registration, delivery claim or result ledger, and performs no push send.

## Reproduce the local verification

From the repository root, with the existing Rust toolchain and ignored Cargo
target selected for this task:

```sh
node server2/tools/golden/record_narrative.js server2/tests/narrative/contract.json
cargo test --manifest-path server2/Cargo.toml --locked --test narrative
cargo test --manifest-path server2/Cargo.toml --locked --test catalogs publication
cargo test --manifest-path server2/Cargo.toml --locked --test runtime_services narrative
cargo build --manifest-path server2/Cargo.toml --locked --release --example narrative_smoke
python3 server2/tools/narrative_smoke.py --binary <retained-release-narrative-smoke> \
  --out reports/server2-narrative/new-run
```

The oracle runs only the named legacy modules with an injected model/requester
and frozen clock. Its 21 cases / ten offices are a validation/object-order reference;
it does not contact Mongo or a provider. Retain its embedded source hashes.

The extra release smoke uses an owned loopback S3/provider peer, synthetic keys
and an allowlisted child environment. It first serves missing prose without
acquiring, explicitly runs the test entrypoint's acquisition cycle, disables
the provider, then starts fresh serving processes to check recovery. It checks
regional/national routing, unchanged weather, HEAD/304 and no child prose.
It also requires a valid JSON HTTP201 fault to produce no raw/index publication
and checks that successful raw metadata retains the provider content type.
Its KMA weather input is a selected frozen native snapshot; national city/air
inputs are doubles. It does not establish full provider startup, IAM/TLS,
production parity, actual widget rendering or a production rollback bundle.
The production binary has no test refresh command or configurable provider root.

Use a new output directory for each run. Keep original failures and hashes;
never relabel a historical execution onto a later binary. Consult the
[selected verification record](../evidence/tasks/issue-2705-s20e/verification.md)
for actual commands, captures and limitations, and the
[design workflow](../architecture/diagrams/server2-forecast-narrative.html)
for the proposed ownership split and its accepted legacy-contract evidence.

## Diagnosis and rollback boundary

Inspect the scheduled domestic worker trace and nested provider acquire,
funding and S3 publish/read outcomes. Authentication, quota/funding validation,
transport, corruption and expiry are different conditions. Never log keys,
provider URLs or original prose as diagnostic fields. A completed worker cycle
does not by itself prove every office committed successfully.

For absent prose, check the selected office, publication clock/expiry, per-API
funding and the exact committed catalog/raw identity. Preserve the base weather
response. Do not query a live provider as a health probe or force a raw orphan
into an existing catalog. An optional read omission is not a weather failure.

A code rollback leaves immutable S3 originals in place; it must not rewind
warning/push journals or replay failed/unknown sends. Qualifying an earlier
complete server2 release/configuration for the updated production inventory is
still required before cutover. See the [cutover procedure](server2-cutover.md).
No command here authorizes deployment, mirroring, live providers, device sends,
resource changes, final state copies or #2724 measurements.
