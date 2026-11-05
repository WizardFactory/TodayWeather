# Plan for one bound on a KMA request

Task declaration: `server2/config/tasks/KMA-REQUEST-BOUND.json`. Follows `plans/issue-2614-kma-stored-reads.md`.

1. Offer the zone state from the collector through the warning store, and let the service answer from it.
2. End the request's wait for a warning cycle at the offer, under the observed source only.
3. Stop waiting for image acquisitions under the observed source.
4. Bound the observed wait at 2.5 s, with the guard for a missing `shortest` so a late forecast keeps the client format.
5. Measure on EC2 with the CI binary, then update the documents.
6. Open a draft PR and take it through CI and cross-provider review. AK decides on the merge.
