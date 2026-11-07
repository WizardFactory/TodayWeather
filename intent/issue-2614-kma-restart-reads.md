# Warning work does not starve request reads after a restart

The EC2 verification of 2026-11-07 (01:19-03:15 KST) restarted server2 13 times on a stored bucket. Every first request took 2.9 to 4.3 s and most lacked the minute observations and the past six days: those reads did not finish within the observed source's 2.5 s bound. Debug logs and S3 server access logs name the cause. The process shares one 12-request S3 admission, and the first request after a restart starts the warning acquisition (the request-driven collector of #2819). That acquisition reloads its zone progress and replays the stored warning records, then publishes zone days and the push warning feed. In the restart measured after 1 h 40 min of operation it made 859 S3 requests over 9 s (53 s of summed S3 time), while the request's own reads waited for permits. The cost grows with the stored warning records. AK approved the fix on 2026-11-07 ("진행").

## Outcomes

- **LANE:** the shared S3 admission has a bulk lane: bulk work holds at most a third of the permits (4 of 12), so request reads always keep the rest. Bulk work still counts toward the shared limit.
- **WARNINGS:** the process warning store and the persisted warning feed (collector, zone replay, publications and warning reads) use the bulk lane in both production wirings.
- **RESTART:** on EC2, the first request after a restart on stored data with accumulated warnings answers within the request bound with a body that passes the client validation (`server2/tools/verification/kma_client_eval.py`); parts not ready by then (minute observations, past days, warnings) come on later requests. AK chose this criterion on 2026-11-07 (option 2, "응답 기준을 client validation") after the EC2 comparisons showed that the first request after a restart restores every source from S3 (1,100 to 1,300 S3 calls) and that neither this change nor #2872 completes it.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions for AK

- After a restart, warnings can reach answers a few seconds later than now, because the warning work gets 4 permits instead of competing for all 12. The first answers lack warnings today as well.

## Exclusions

Not in this change: the request's own repeated catalog lookups, the KASI restore (two reads once the fold exists), the warning record format and replay window, and fixes 2-4.
