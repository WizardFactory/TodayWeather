# Plan
1. Evaluate absence before adding config.
2. Add self-contained paseo.json to both checkouts and credentials ignore rules. Update EC2 guide.
3. Execute synthetic normal, repeat, missing-file and symlink cases; validate with installed parser.
4. Use installed Paseo seed/setup implementation as functional smoke, then independent read-only verification.
Risk: secret overwrite or accidental staging; mitigated by preserve-existing checks and nested ignore rule. Reject separate setup script because older base branches may lack it. Rollback: remove config; existing secret copies remain local. Preserve unrelated edits.
