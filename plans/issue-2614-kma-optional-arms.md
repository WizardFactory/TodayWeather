# Plan for supplementary KMA inputs

Task declaration: `server2/config/tasks/KMA-OPTIONAL-ARMS.json`. Follows `plans/issue-2614-kma-image-production.md`.

1. `LifeInputs::held`: the life data held, without reading or waiting.
2. `S3Source::beside_life`: under the observed source, select between the required inputs and the life inputs; once the required are in, answer with the held life data. Used for found towns and towns outside the list.
3. `KmaSource::narrative_beside`: under the observed source the backend starts the narrative read after `prepare`, from the request's province, and inserts it after the assembly only if it has ended.
4. Tests: the life acquisition that does not end, and a ready and a never-ending narrative.
5. Update the architecture, data design and diagram documents.
6. Open a draft PR, CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a restart | A quick first answer | Stored forecast; UV not held yet | Open the weather | Forecast, observations, air and warnings, without waiting for UV | UV provider slow: UV appears on a later request | LIFE |
| App user | Narrative when it is available | Narrative published | Open the weather | Narrative in the answer when its read ends in time | Narrative read slow: the answer comes without it | NARRATIVE |
| Maintainer | Legacy parity | Legacy-path source | Run the parity suites | Unchanged answers | Any difference fails | LEGACY |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | Undeclared path fails | PLACEMENT |
