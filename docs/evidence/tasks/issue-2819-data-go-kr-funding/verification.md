# DataGoKr selected-attempt funding verification (#2819 B2)

Local correction of the funding logic on baseline `1e31ac1e`; not operating quota
measurement or cutover qualification. [Contract](../../../../specs/issue-2819-data-go-kr-funding.md),
[plan](../../../../plans/issue-2819-data-go-kr-funding.md),
[declaration](../../../../server2/config/tasks/DataGoKrFunding2819.json).

## Behavior

Each selected data.go.kr HTTP attempt reserves one logical unit immediately
before send. A successful first key does not fund an unused key or retry. Known
local `Exhausted` alone can advance to the next candidate, without a fabricated
HTTP attempt. Auth/quota stops that key and permits only a distinct funded next
key. Actual HTTP attempts stay bounded at two and use the original deadline.
Unknown/corrupt/transport/clock/deadline funding remains fail-closed; no refund.
VC still prepays its maximum two-attempt49/25/1-record cost.

The normal ring retains its concurrent settlement guard and remembers successful
keys. A larger ring skips an exhausted selected pair for the next call, rather
than scanning every configured key in one call. AirKorea retains reverse order
and remembered success. An API-local funding cap never latches its provider-wide
KST quota marker. `CallReport` keeps skipped local candidates for settlement; there is no dedicated
metric for a successful local skip. `funding_denied` counts calls that terminate
with a funding error, while provider counters count actual HTTP outcomes.
Reserved logical units are distinct from S08 authority block claims.

## Initial checks before review corrections

- Before runtime edits, five focused assertions failed as intended: fresh one-unit
  A, unused spent B, local A-to-B, larger-ring progress and AirKorea local-cap
  continuation. Compiles succeeded. A separate first fixture compile failure
  (private consume API) is retained as setup failure, not Red; the corrected
  fixture uses public nonrefundable reserve/drop.
- Seven new regressions now pass, including rejection after local rotation and
  retry-to-B at the two-HTTP limit. These seven are included in the target counts
  below, not added again.
- `cargo test --lib`:93 passed.
- `cargo test --test budget`:32 passed, including ambiguous/unknown-noHTTP,
  original deadline, cancellation/ownership and unchanged VC maximum prepayment.
- `cargo test --test formats`:39 passed.
- `cargo test --test providers`:49 passed.
- `cargo test --test domestic asos`:8 passed,156 filtered. Total 221 passed.
- The first whole regression invocation retained its old unused-candidate burn
  oracle failure (31budget passed/1failed). That assertion now verifies no unused
  authority creation and that an actually exhausted unused key stays unchanged.
- Format and all-target clippy with `-D warnings` pass. Native macOS ARM64,
  Rust 1.99.0, one ignored shared target and process-scoped debug/incremental
  settings; no global toolchain/profile changes.

## Separate functional execution

```sh
cd server2
cargo run --locked --offline --example data_go_kr_funding_smoke
```

The executable composes the real domestic acquirer/keyring and S08 BudgetStore
with owned HTTP and a volatile conditional budget transport. Synthetic authority
blocks are one unit. Fresh A yields one page, one reservation and one HTTP, with
no B authority object. Pre-reserved/exhausted A yields two requests on B; B stays
remembered and no provider-quota outcome is invented. Total owned HTTP3, live
provider calls0; owned listener is aborted and awaited. No production .env/keys
or instance role is consulted. This is a dev executable, not release qualification.

```json
{
  "fresh_first_key": {
    "authority_used": 1,
    "completed_pages": 1,
    "http_attempts": 1,
    "local_a_exhausted": false,
    "logical_reserved_units": 1,
    "provider_quota_outcomes": 0,
    "remembered_key_index": 0
  },
  "known_exhaustion_rotation": {
    "authority_used": 3,
    "completed_pages": 2,
    "http_attempts": 2,
    "local_a_exhausted": true,
    "logical_reserved_units": 2,
    "provider_quota_outcomes": 0,
    "remembered_key_index": 1
  },
  "live_actions": false,
  "live_provider_calls": 0,
  "owned_http_total": 3,
  "production_eligible": false,
  "scope": "owned-http-volatile-s08",
  "verdict": "PASS"
}
```

Report SHA-256: `539c9c234089987a5bcc4a0114846be3a95aa4e95a784722ec4124a6085a6082`.
Initial executable SHA-256: `2c38e10689497263fb648687fb4ea2bb322d0697f30d92f534bc2de169ca1d1d`.
Renewed correction executable SHA-256: `8c666d327a3dd587e55a834bd95cd9c370f749bdea0043252513a782129ddf43`.
Both executions produced the same report bytes; their executable identities stay distinct.
The final runtime source map and executable are retained outside Cargo output;
raw runs and original failures stay in ignored task evidence. No maintained link
depends on those local reports.

## Documentation and bounds

[Contract flow](../../../architecture/diagrams/server2-provider-admission.html) /
[editable source](../../../architecture/diagrams/server2-provider-admission.sequence.json)
was updated before implementation as the selected illustrative funding contract.
Artifact/browser checks and light1440/dark2048 inspection passed. Final source
assessment matches implemented ownership/rotation; no diagram is execution proof.
No new product feature/UI was introduced; existing dated PDFs are not relabelled
as new executions. Placement/artifact checks and independent review/current CI
are still required for PR readiness.

No allowance values, production key/account quota lookup, live provider/S3, push
send, deployment or merge occurred. Operating data.go.kr allowances remain open.
B3 late-publication scheduling, D1/D2 capacity, seven-day shadow, eligible complete
recovery and S20 cutover gates remain unresolved. This result closes none of those.

## Selected review corrections

DGK-CLAUDE-001: the unchanged old optimized S08 smoke was rebuilt and actually
failed its replacement-exhaustion assertion under selected-attempt funding. The
original Red executable/log are retained separately. The scenario now explicitly
issues and abandons A's last block before constructing its replacement, rather
than relying on obsolete unused-retry prepayment. Two terminal HTTP400 modes
never create unused B authority, so expected totals become 20 authorities,
44 authority units and 21 witnesses, with 22 provider HTTP requests. Authority
units remain S08 block claims, not logical HTTP costs. The manual renderer accepts
both the original dated receipt and this new exact receipt; old S08 captures and
PDF are not relabelled or rerendered as new evidence.

DGK-CLAUDE-003: a new real-HTTP regression first failed because A's actual quota
reply was hidden by B's local exhaustion. The executor now preserves observed
Quota/Auth only when the distinct next candidate is known locally exhausted;
ambiguous errors still remain terminal funding errors. New two-candidate controls
cover Unknown/Corrupt/Transport/Clock with one A authority read, no B reads or
writes and no HTTP; AirKorea all-local-exhaustion remains Funding(Exhausted),
with no authentication error or provider-wide KST marker.

DGK-CLAUDE-002/004/007/008: diagram wording, metric scope, repeated AirKorea S08
lookup cost and prose spacing are corrected. No local-exhaustion metric or cache
was introduced. DGK-CLAUDE-005/006: boundary cases and broader affected targets were executed.
The exact clean-target inventory is below. Current CI and independent resolution
remain required. The same strict reviewed direct-native inventory/header correction is
transferred from PR2821 to this unchanged baseline test API; it changes no runtime
behavior or timeout and does not resolve weather latency/D2.

## Current correction results and baseline limit

Twelve clean target/filter processes passed **407 Rust tests**, with 1 ignored:
lib 93, budget 33, providers 50, formats 40, history 47, warnings 31, gateway 58,
narrative 5, integration 3, direct legacy-version contracts 15, runtime-services
31 and the focused daily/API isolation check 1. The ten new regressions are
included in these counts. The corrected runtime-services test requires one
narrative HTTP under a one-unit allowance, then no additional HTTP on exhaustion,
while the separate warning API remains funded. The daily/API isolation test keeps
its two-unit allowance and requires two actual successes before exact exhaustion.
These stronger checks replace obsolete retry-prepayment assumptions.

The **whole domestic target did not pass**: its latest result is 161 passed,
1 failed, 2 ignored. The unchanged positive three-second KMA test failed in two
full B2 runs, passed alone in 2.71 seconds, and also failed in a full pre-B2 control
(C1 head `05a8fcfd`, which has no B2 funding change). The control has unrelated C1
push changes and is not a pure master run; the KMA source, backend and relevant
source/life test bytes are identical. Thus B2 funding is not necessary to reproduce
the failure. Its root cause is not established. The original failed whole runs
remain retained and are not counted as clean target success. No positive assertion,
production timeout or test-thread policy was changed. This remains part of the
existing #2819 D2/capacity qualification, and blocks overall readiness/shadow.

The separate current dev acquisition/keyring/S08 CLI again passes with 3 owned
HTTP requests and no live calls. The maintained **release** S08 smoke now passes
with 20 authority objects, 44 authority units, 21 witnesses and 22 provider HTTP
requests. Its prior replacement assertion failed before the correction. The
current renderer's actual pure receipt functions accept the real new log and
reject a modified counter or timestamp. No PDF renderer main was run and no
historical PDF/capture was overwritten. Format and all-target clippy pass on the
current sources. Executables, source maps, runner hashes, raw logs and diagnostic
controls remain in ignored task evidence. Independent review and current Linux
CI must still assess this scoped correction; none of these results authorizes
merge, live providers or production use.
