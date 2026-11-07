# First answer after a restart: providers when the restore is late

AK requires that a request waits at most 3 s and answers from what is ready, and defined on 2026-11-07 that client validation means the client receives all the data it gets today, except parts left out because their provider is slow. A part that S3 holds but a restarted process has not restored yet is not such an exception. The EC2 restart comparison of 2026-11-07 (master, #2866, #2866+#2872, three restarts each) found every first answer without yesterday values, past days and the history mapping, most without current observations, and some without UV or the forecast narrative; the answer seconds later had them. The restores ran behind each other (ASOS waited for the stations, acquisitions waited for reads, the narrative read waited for the assembly) and behind CPU work.

On 2026-11-07 AK chose plan A ("권고대로"):

1. When a source's stored restore has not finished about 0.7 s into the request, its provider acquisition starts alongside, as on an empty S3, and the answer uses whatever is ready first. About 300 data.go.kr calls per restart and a second stored copy are accepted.
2. ASOS history picks its station from the default station list first instead of waiting for the station restore.
3. Of the 8-day hourly observation window only today and yesterday come from providers; older days come from S3 (the #2872 day product).
4. #2866 and #2872 stay. Reads that no request waits for use the bulk lane, and the gate that keeps acquisitions waiting for the observation reads goes.

## Outcomes

- **RACE:** for the station pages, ASOS history, life indices, the forecast narrative and warnings, a restore that is not done at the head start (700 ms after the KMA request starts) no longer delays the provider acquisition of what memory lacks; the first answer carries what either delivers by the request bound.
- **FAST:** a restore that finishes before the head start makes no provider call that a running process would not make.
- **FILL:** after a restart only the hours of today and yesterday that neither S3 nor memory holds are acquired; D-2 to D-7 come only from S3; a newer page is never replaced by an older one.
- **ASOS:** history takes its station from the current fold or, before any fold, from the default station list.
- **LANES:** reads that no request waits for (the rest of the restart read, expansion, products, image production, the KASI pass) use the bulk lane; reads a request waits for (including the request's warning zone state) use the request lane.
- **NEEDED-FIRST:** the life read restores the slots the answer needs (today's UV, pollen and food poisoning) before the rest of its window.
- **NARRATIVE:** the narrative read starts with the request, is not cancelled by a waiter's timeout and does not block the next answer.
- **DOCUMENTS:** the architecture documents and the data design diagram describe the race.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions by the coordinator (implementation level, from the design draft)

- Grid forecasts (SHRT/VSRT/ODAM, RSS, mid) are not raced: they are already read per request and were complete in every restart; racing them would cost up to 29 grid calls per cell.
- UV cannot come from its provider within the bound (5.5-7 s for four slots); the restored slot must arrive first, so the life read orders the answer's slots first.
- A restore CPU admission (the 4-thread blocking pool) is not part of this change; the next EC2 measurement decides whether it is needed.

## Exclusions

No deployment, no production mutation and no change to the grid forecast reads. The response differences against production that a full restore also shows (for example past forecast probabilities) belong to the response parity task.
