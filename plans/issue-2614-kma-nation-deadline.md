# Plan for the nation deadline

Task declaration: `server2/config/tasks/KMA-NATION-DEADLINE.json`. Independent of #2866, #2867 and the minute page change.

1. `nation::NATION_DEADLINE` = 8 s for the city answers (legacy 9 s per child); `NATION_INPUTS` = 3 s for air and the narrative; `KmaBackend::outcome_finishing` keeps the city inputs at the request budget and lets the CPU admission wait until the nation deadline.
2. Tests: on the KMA backend, cities queued for the CPU admission past 3 s answer; with a paused clock, slow cities compose, a stuck city is the legacy error at 8 s, and air keeps 3 s.
3. Update the architecture document (S17c), the nation operations document and the Archify sequence.
4. Draft PR, CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user on the nation map | The nation weather | Fifteen cities assembled in about 3-4 s | Open the nation view | All fifteen cities | A stuck city: the legacy error page at 8 s | QUEUE, SLOW, STUCK, INPUTS |
| Maintainer | Legacy parity | Nation fixtures | Run the suites | Unchanged answers | Any difference fails | UNCHANGED |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | Undeclared path fails | PLACEMENT |
