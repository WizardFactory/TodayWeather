# Plan for the nation deadline

Task declaration: `server2/config/tasks/KMA-NATION-DEADLINE.json`. Independent of #2866, #2867 and the minute page change.

1. `nation::NATION_DEADLINE` = 8 s for the composition (legacy 9 s per child, within the 9-second gateway deadline).
2. Tests with a paused clock: slow cities compose; a stuck city is the legacy error at 8 s.
3. Update the architecture document (S17c).
4. Draft PR, CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user on the nation map | The nation weather | Fifteen cities assembled in about 3-4 s | Open the nation view | All fifteen cities | A stuck city: the legacy error page at 8 s | SLOW, STUCK |
| Maintainer | Legacy parity | Nation fixtures | Run the suites | Unchanged answers | Any difference fails | UNCHANGED |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | Undeclared path fails | PLACEMENT |
