# S18c notices backend

Task issue-2703-s18c; owner /root/s18_conditional_alerts; base f32386cb; implementation/pre-merge. Sources: AK approval of S18c under #2703 and #2623, root delegated 2026-10-16. This adopts #2623's version-independent contract directly in server2; SQLite and client/web popup work are excluded.

Operators need durable service notices and a read-only API. Server2 stores operator-authored notices in S3, publishes through a CLI and serves the latest active notice in a supported language. Publish-time translation fills missing languages; failure does not prevent a notice from being stored. No translation runs during an API request.

- N1: latest active selection, seven-language fallback, fields and HTTP cache contract are observable over real isolated HTTP.
- N2: validated CLI-only mutations preserve acknowledged durable state under concurrent writers, failed/unknown writes, restart and malformed input. Missing state yields null, cold unreadable/corrupt state503; transient failures preserve a verified copy.
- N3: configured publish-time Responses requests fill only missing translations with provenance; failures are reported without blocking publication or changing valid supplied texts. No actual paid API call is used for verification.
- N4: exact declaration/placement and no runtime legacy dependency; tests/smoke, operator manual screenshot+PDF, diagram, eligible independent review and currentCI at premerge.

Authorization permits code/tests/sanitized evidence among configured builder codex/OpenAI and separate authenticated reviewer accounts grok/xAI or existing fallback; no secrets/new accounts/permission changes. Commits/push/PR/CI are authorized, but merge/auto-merge/queue/deploy/AWS/prodDB writes are not. Root integrates. S20 mounts the exported router and deploys the CLI; this task does not claim service startup wiring or an existing client popup.
