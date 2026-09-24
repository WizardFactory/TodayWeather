# Intent: automate isolated RSS validation
Source: PR #2556 review recommendation 2; AK explicitly says proceed. AK confirms server uses UTC (user-provided operational fact, not a new agent host inspection).
CI1: Run existing 43 regressions and all 36 response smoke cases on pushes/pull requests using supported Node and UTC.
CI2: Job failures fail the check; only minimal temporary smoke dependencies, no production credentials, database/provider services or deployment. Preserve legacy npm test/Travis.
CI3: Document execution, validate locally and independently, publish to existing PR and observe actual GitHub check outcomes. No merge, auto-merge, deployment, repository permission changes or assumed formal review approval.
