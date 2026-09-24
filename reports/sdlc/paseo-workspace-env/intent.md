# Intent
AC1: native Paseo worktree.setup copies source server/.env into the same relative target path.
AC2: existing destinations preserved; new copies 0600; missing source skipped; no secret contents in output; copied file Git-ignored even on older target branches.
AC3: existing AWS setup and other configuration preserved; base checkout activated with source environment ignored; no plugin or daemon restart needed.
AC4: synthetic regression, installed Paseo parser/seed/setup smoke and independent local verification pass.
Only local setup changes are authorized; do not start server/gather or contact providers. Target branches already carrying their own paseo.json retain Paseo's own configuration precedence.
