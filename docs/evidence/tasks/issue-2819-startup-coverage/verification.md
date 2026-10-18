# E1/E2 production startup coverage verification

Scope: #2819 E1 plus AK's confirmed E2 optional-file/mandatory-config contract.
Parent is unmerged C6 b080bc48; C1/B1 remain separate unmerged branches. This
records local checks, not main integration, full recovery, shadow or production readiness.

The operational main rejects incomplete native family/world selection before runtime
construction. Complete environment-only settings may omit `.env`; missing required
configuration fails. Shared injected partial factories, explicit development coexistence,
existing constructor validation and listener error precedence remain unchanged.

## Actual checks

- Unchanged-main regression: the bare environment-only parent opened public/private
  listeners. The test killed/joined its owned child and removed its empty directory
  before the intended assertion (exit101, zero passed/one failed). This is the Red,
  with original source map, regression source and executable retained locally.
- Configuration-only world selection baseline: one test passed before extraction;
  it constructs clients with synthetic credentials and endpoint strings but makes no
  HTTP call. Exact parser projection preserves default/empty/trim/duplicate behavior.
- Current complete targets: startup4, foundation8, world41, runtime_services41/2ignored:
  **94 passed / 2 ignored**. Runtime includes the owned combined native route inventory
  with no legacy origin. That is separate from an operational full-native main startup.
- fmt-check, all-target Clippy (`-D warnings`) and optimized main build passed.
- Additional retained optimized actual-main CLI: **7/7 PASS**. Bare/partial/version-gap,
  missing account and incomplete-file configurations exited before readiness. Environment-only
  explicit loopback coexistence and file/process PORT precedence reached health200,
  TERM0 and closed all four product ports. Owned working directories contained no
  unexpected output. No host environment/account/file was inherited.
- Bad binary hash and reused output controls refused with exit2 before children/output.
  Checks use explicit `require`, not optimization-sensitive assertions.

Positive CLI cases use closed-loopback legacy development coexistence. They make only
owned health requests; they do not prove production API parity, provider authorization,
full-native main startup, resource readiness or E3 readiness. Pure complete-coverage
validation queries only family/world/origin selectors; getter guards reject provider,
storage or account lookups. Existing constructors still validate required inputs.

Initial offline execution stopped before compilation because five registry source caches
were incomplete. That setup invocation is NOTPASS, not the Red. Missing cache files were
restored only from registry archives verified against unchanged Cargo.lock checksums;
source/lock/dependency manifests were not changed. Then all checks ran offline/locked.

## Retention and pending gates

Selected local evidence lives under ignored reports/sdlc/issue-2819-startup-coverage:
Red source/bin/log, execution/source maps, checks, functional1, admission/projection,
Archify source/HTML/browser/visual evidence and SDLC records. The retained executable
SHA-256 is `9afb2b0d2fbdd4d56e77b27cb9d1471c5d42949d7f5b659e4796e95125e5993d`; report SHA-256 is
`655fed0a9dc094d43778e512ac36d6dcd4097ed77f05a08836d2d6a3c59cc753`.
This is not a qualified portable release bundle. Required consumers retain the shared
Cargo target; no cache cleanup is claimed. Independent current review and exact parent/current
CI remain pre-merge gates. No merge, live provider/device, deployment, issue closure or
seven-day shadow qualification is authorized. The final as-built diagram must pin committed
implemented source; an earlier proposed diagram is explicitly design evidence only.

## Existing process-launcher compatibility

Before the first push, a complete Python launcher review found three existing verification
assets intentionally started bare/partial operational main: `tools/smoke.py`,
`deploy/local/stack.py`, and `tests/integration/test_observability.py`. Root Required
E1-ROOT-001 records this compatibility gap. The first existing smoke invocation was
rejected by the new guard (exit1); it is a harness NOTPASS, separate from the original
old-runtime Red. Paths were amended before edits. These isolated health/logging checks
now supply an explicit closed-loopback legacy origin; no runtime bypass or new mode.
The foundation smoke expects the already existing gateway-enabled12second connection
lifetime, while HTTP-only process signal drain remains5seconds. Existing full-native
coverage and no-origin rejection tests remain unchanged. Runtime/test Rust and retained
release bytes did not change for this harness correction.
