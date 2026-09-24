# Plan
1. Add isolated regression for env copying, modes, preservation, missing source, symlink boundaries, paths with spaces and existing ignore negations; observe Red.
2. Append environment copy block without changing existing AWS setup; document behavior. No external package/plugin required.
3. Run regressions and existing AWS checks, then installed Paseo seed/setup on a temporary synthetic Git worktree as independent functional smoke.
4. Activate exact reviewed config in original checkout and protect its environment file, preserving concurrent modifications via expected-content guards.
5. Independent read-only verification and completion; no commit, deployment, agent session creation or daemon restart.
