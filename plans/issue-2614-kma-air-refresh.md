# Plan for the AirKorea refresh

Task declaration: `server2/config/tasks/KMA-AIR-REFRESH.json`. Follows `plans/issue-2614-kma-restart-reads.md` (independent change).

1. `observation_fold`: from the newest stored dataset of the current hour, mark the hour as lagging when a station is one hour behind; clear the mark when none is.
2. Capture loop: an hour already stored but lagging is acquired again, with one key per capture interval so the per-key retry throttle keeps the 10-minute cadence.
3. Test: a stub mode with one station an hour behind once, and a station out of service; the capture refreshes once and then stops.
4. Update the architecture document (the capture rule).
5. Draft PR, CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user in Daejeon | Current air of this hour | AirKorea updated 둔산동 after the hour's dataset | Open the weather 10-20 minutes later | The current hour's air | Refresh failed: the next check retries | REFRESH |
| Operator | No needless calls | Every live station current; one out of service | Requests continue | No further nationwide calls in the hour | - | STOP |
| App user | Answers as before | Stored data | Open the weather | No new wait | - | UNCHANGED |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | Undeclared path fails | PLACEMENT |
