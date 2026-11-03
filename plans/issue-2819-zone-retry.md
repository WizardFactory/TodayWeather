# D1 implementation plan

Owner: OpenAI /root. Canonical execution notebook: `.planning/2026-10-13-server2-next-sequence-after-s10` in the coordinating workspace. Base is B3 head f3883e25; this slice stacks on B3 and is not main-qualified. Exact paths are declared in `server2/config/tasks/ZoneRetry2819.json` before code edits. State/evidence: ignored `reports/sdlc/issue-2819-zone-retry/`.

1. Pin source behavior, acceptance and the small existing-owner design; render/check the proposed retry flow.
2. Add focused private source tests. Use test-only memo expiry and short completed-flight retention to avoid five-minute CI sleeps; keep production clocks/configuration unchanged. Confirm intended counter mismatch before runtime edits.
3. Share the success flag with the async owner, claim existing five-minute admission inside owned creation, and latch only after readable publication. Keep cache invalidation ordered before success.
4. Run focused checks, affected source/format/history/runtime/owned regressions, fmt/clippy and declaration/artifact checks. Preserve whole-target failures separately from passing scoped rows.
5. Run an additional executable using actual source/acquirer/catalog publication against owned peers. First fail, wait a real five-minute memo, then recover and read zone data. Retain executable/source/report hashes and child cleanup. No live credentials or providers.
6. Update docs/diagram/evidence, commit/push a stacked PR, required native independent review and correction, exact CI and pre-merge receipt. Keep merge disabled and #2819/#2704/#2705 open.

Risk: an early success marker prevents recovery or hides publication failure. Proof: failure matrix plus actual S3 publication/readback. Rejected: an independent retry timer (new lifecycle/traffic), immediate unbounded retry (funding risk), or clearing the old flag only on one error branch (misses panic/None). A small single-owner sketch is sufficient; no design panel is claimed. Rollback restores code, never rewinds state; no production action authorized.

User scenario: a weather caller arrives after zone acquisition failed. Prerequisites are enabled owned forecast acquisition and retained S3 authority. Requests during the five-minute bound serve stored data; a later request admits one refresh; after publication a new request sees recovered zones. Failure remains bounded/partial and demand-driven. Verification operator scenario: run isolated peers, observe first failure then recovery, assert no extra HTTP and retire all children.
