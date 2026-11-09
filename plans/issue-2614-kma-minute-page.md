# Plan for the held minute page

Task declaration: `server2/config/tasks/KMA-MINUTE-PAGE.json`. Independent of #2866 and the AirKorea refresh.

1. `Observations::ensure_minute`: when the newest held page is within the readers' 20 minutes, start the owned acquisition detached and return nothing to wait for.
2. Test: a restarted process with a stored page and a slow provider answers at once with the held page; the next page is acquired.
3. Update the architecture document (the request-time acquisition table).
4. Draft PR, CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user | A quick answer with current observations | Minute page of the last 20 minutes held; next page due | Open the weather | The held page's observations without waiting | Acquisition fails: the held page answers until it is 20 minutes old | HELD |
| App user after a cold start | Observations at all | No page held | Open the weather | The request waits for the page as before | Provider slow: the answer omits the minute observations | COLD |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | Undeclared path fails | PLACEMENT |
