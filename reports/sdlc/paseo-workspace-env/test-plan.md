# Test plan
Synthetic fixture source/target only; no actual credential bytes. Expected Red: target server/.env absent after old setup.
Verify exact synthetic bytes, permission 0600, Git exclusion despite existing !.env, repeated invocation preserves target, missing source skips, server and ignore-file symlinks refused, destination .env symlinks preserved, paths with spaces handled, AWS setup prefix unchanged. Missing PASEO_SOURCE_CHECKOUT_PATH still fails.
Functional smoke uses installed Paseo parser/seed/setup functions and an isolated real Git worktree; check missing-target config seeding and existing-config precedence, verify copied bytes/mode/ignore, remove scratch worktree. No registered workspace, server, providers or real secrets involved.
