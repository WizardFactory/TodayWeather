# Execution plan
Owner /root; notebook .planning/issue-2563. Local scope only.
1. Add dependency-light tests with temporary layouts and intercepted New Relic initialization; retain intended baseline failure.
2. Add bootstrap module, first app import, pinned runtime dependency, offline runner/CI dependency wiring, ignore rules, sanitized example and documentation.
3. Place upload privately and byte-for-byte; never record its bytes or digest in public artifacts.
4. Run focused regressions and existing offline suite, then a separate real dotenv/config smoke using the uploaded file in an isolated process; emit only pass metadata. Verify Git protection.
5. Complete Archify browser/visual checks. Delegate a fresh-context independent read-only verifier. Retain receipts and final limitations.
Rollback: revert tracked bootstrap/dependency/docs changes and remove the local .env if reverting the runtime configuration is desired. No deployment/restart authorized.
