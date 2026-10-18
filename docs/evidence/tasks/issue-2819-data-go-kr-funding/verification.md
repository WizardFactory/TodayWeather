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
KST quota marker. Metrics count actual funded HTTP attempts separately from local
denial; reserved logical units are distinct from S08 authority block claims.

## Actual checks

- Before runtime edits, five focused assertions failed as intended: fresh one-unit
  A, unused spent B, local A-to-B, larger-ring progress and AirKorea local-cap
  continuation. Compiles succeeded. A separate first fixture compile failure
  (private consume API) is retained as setup failure, not Red; the corrected
  fixture uses public nonrefundable reserve/drop.
- Seven new regressions now pass, including rejection after local rotation and
  retry-to-B at the two-HTTP limit. These seven are included in the target counts
  below, not added again.
- `cargo test --lib`:93passed.
- `cargo test --test budget`:32passed, including ambiguous/unknown-noHTTP,
  original deadline, cancellation/ownership and unchanged VC maximum prepayment.
- `cargo test --test formats`:39passed.
- `cargo test --test providers`:49passed.
- `cargo test --test domestic asos`:8passed,156filtered. Total221passed.
- The first whole regression invocation retained its old unused-candidate burn
  oracle failure (31budget passed/1failed). That assertion now verifies no unused
  authority creation and that an actually exhausted unused key stays unchanged.
- Format and all-target clippy with `-D warnings` pass. Native macOS ARM64,
  Rust1.99.0, one ignored shared target and process-scoped debug/incremental
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
Executable SHA-256: `2c38e10689497263fb648687fb4ea2bb322d0697f30d92f534bc2de169ca1d1d`.
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
