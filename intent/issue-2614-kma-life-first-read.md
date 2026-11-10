# Life index: no provider race during a process's first life read

An EC2 re-measurement of #2927 (KMA-LIFE-DISTINCT) on 2026-11-10 (reported on PR #2927; local evidence `reports/kma-ec2-20261110e/`, not tracked) found that every restart still called the UV provider: one flight of four pages, about 5.4 s, after which the publication check restored the stored twin and published nothing. The process's first life read took about 2.7 s (8 partition LISTs and 7 restores under the restart's S3 contention), longer than the 0.7 s head start. So `life()` raced it and decided from a fold that had never been read, which holds no UV, although S3 held the current slot. The acquisition could not help the first answer: four provider pages take about 5 s and the first answer waits 2.5 s. Each restart cost 4 redundant UV provider calls and about 5.4 s of owned work, plus the check; in season the pollen kinds behave the same way.

AK decided on 2026-11-10 ("권고대로 진행") to proceed with the follow-up recommended after the re-measurement. The design (`reports/sdlc/issue-2614-kma-life-first-read/design.md`, not tracked, revision 2) was approved after two design reviews.

## Outcomes

- **GATE (I1, D2):** while the process's first owned life read runs, no request starts a UV or pollen acquisition, raced or not: on the head-start path (`load_by`) and on the path without one (`load`). The request waits for the read to its bound, as a raced request does, and answers from the fold it holds then.
- **END (D1, I2):** a monotonic flag, apart from `refreshed`, is set by a guard that the first owned read's owned task holds. Completion, an error, the owner deadline, cancellation and a panic end the rule. A pending or cancelled waiter, a Busy join and NEEDED-FIRST's interim fold do not.
- **AFTER (D3):** once the first read has ended, requests decide as before; a later read that misses the head start, including a second attempt after a failed first one, races as before.
- **BOUND (D4):** no timer and no budget; the rule ends at the latest at the first owned read's creation plus `READ_FOR` (120 s), and acquisitions resume at the next request's decision.
- **UNCHANGED (I3):** MFDS (its own race), KASI, the KMA-LIFE-DISTINCT read and publication check, the memo and the overlay.
- **PLACEMENT:** the placement gate and the artifact policy pass.

## Notes for AK

- Stated difference: with a provider faster than the first answer's wait, a slow first read's race used to put UV or pollen into the first answer; it no longer does. On EC2 the UV provider's four pages took 4.6 to 5.5 s, so every measured first answer lacked UV and the measured first answers do not change.
- A restart whose S3 lacks the slot gets UV or pollen later, by up to the first read's duration plus the gap to the next request. During an S3 outage at start the provider path waits until the first owned read ends, at most 120 s after it began.
- The restart effect (no UV or pollen call when S3 holds the slot) is shown locally, not measured on EC2.

## Exclusions

Not in this change: MFDS (no per-start duplicate was observed), ending the rule at NEEDED-FIRST's interim fold, a timer or budget, other per-start kinds, and an EC2 re-measurement.
