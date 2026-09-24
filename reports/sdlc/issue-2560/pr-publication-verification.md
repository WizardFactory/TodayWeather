# PR publication preparation: independent verification

Bounded verification pass 4, 2026-09-24 09:30 UTC. **Verdict: PASS.** No unresolved mandatory finding. This is local same-provider independent verification of the CI/test portability changes, not a cross-provider PR review or a remote CI result. No source edit, remote mutation, commit, deployment or further delegation was performed.

## Reviewed changes

- `.github/workflows/gather-offline.yml` adds pinned `mongoose@5.1.2`, `sprintf@0.1.5` and `express@4.13.4` to the isolated dependency installation and runs `daily-response-smoke.js` with `TZ=UTC` and the same isolated `NODE_PATH`. Existing checkout/setup actions, read-only workflow permissions, triggers, Node version, timeout, `--ignore-scripts` and credential settings are unchanged. The additional command runs isolated in-memory middleware, not the application server or collection endpoints.
- `reports/sdlc/issue-2560/independent-checks.js` derives the repository root from `path.resolve(__dirname, '../../..')`. For its committed location this resolves to the repository root independently of the caller's working directory.

Dependency inspection confirms the two workflow commands use the declared packages: Mocha for the legacy suite, xml2js/async for parsing and composition, Mongoose for actual schema casts in the daily harness, sprintf for the real controllers, and Express for the in-memory route smoke. Other external production collaborators are replaced by the offline harness. Read the original `ci-red.log`: it records `Cannot find module 'mongoose'` with the old minimal dependency set, establishing the concrete CI setup gap.

## Executed verification

From working directory `/tmp`:

```sh
NODE_PATH=/tmp/issue-2560-offline/node_modules node --test /root/.paseo/worktrees/08mqediz/humorous-lionfish/reports/sdlc/issue-2560/independent-checks.js
```

Result: exit 0, **5/5 passed**. Running outside the checkout confirms the path change works without depending on the process working directory. Node is `v22.22.2`. Resolved dependency versions match every workflow pin exactly: Mocha 2.5.3, xml2js 0.4.23, async 2.6.4, Mongoose 5.1.2, sprintf 0.1.5 and Express 4.13.4.

A separate SHA-256 comparison of all 11 application source files against the final candidate table in `independent-verification.md` passed: application behavior is unchanged from the independently verified candidate. `git diff --check` on the two scoped files passed. The original application/regression/smoke evidence remains reusable; main owns the current workflow-equivalent execution and actual GitHub checks. No remote CI success is inferred from local dependency availability.

## Candidate identity

| File | SHA-256 |
| --- | --- |
| `.github/workflows/gather-offline.yml` | `26e65982da056767d1255adb52ea994da3c33eabbc7a0ae864c5b3923c1c647d` |
| `reports/sdlc/issue-2560/independent-checks.js` | `e34685c681c859dc2deee94e264c54d6bbe3feaa6b49815c1b0254fbf916e257` |

The user-authorized next endpoint is PR publication; merge and deployment remain outside this verification and authorization.
