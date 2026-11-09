# Client validation for the KMA response

AK defined client validation on 2026-11-07: a response gives the client all the data the client receives today, except parts left out on purpose because their provider is slow, such as fine dust. `server2/tools/verification/kma_client_eval.py` does not check that. It checks the shape of what is present against a wire contract and a profile of the recorded legacy bodies, requires few fields and compares nothing with a body the client actually receives. On EC2 (2026-11-07) it passed all 36 restart bodies, while every first answer after a restart lacked yesterday values and past days and most lacked current observations.

On 2026-11-07 AK allowed reading the production API ("운영 API 읽기 허락") and chose the recommended rules ("권고대로"): the reference is the production answer for the same path at the same time, and only the slow-provider parts below are left out.

## Outcomes

- **CAPTURE:** one GET of the production API records the body the app receives for a path, with the request time and the cache headers. Nothing else is sent.
- **COMPARE:** a server2 body is judged against a reference body of the same publications, row by row and field by field. Every row and field the reference provides must be in the candidate, with a valid value wherever the reference has one. Each missing row, field and value is listed by path, and the exit status says pass, missing data or not comparable.
- **EXCLUDED:** only these reference parts are not judged: air quality (`current.arpltn`, `current.summaryAir`, `airInfoList`, `airInfo`, daily `dustForecast`), life indices (UV `ultrv*`, pollen `flower*` and `pollen*`, food poisoning `fsn*`) and the KASI extras other than `sunrise` and `sunset`. `forecastNarrative` exists only in server2 and is not judged. Missing excluded parts are still listed, separately.
- **DOCUMENTS:** documents that present a `kma_client_eval.py` pass as complete delivery say what that tool checks and point to this one.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions

- AK, 2026-11-07: the reference is the production answer, not the recorded legacy bodies of this repository, because those come from master legacy code and inputs that differ from the deployed service.
- AK, 2026-11-07: a stored part that is missing only because a restarted process has not restored it yet is not an exclusion. The separate list of missing excluded parts lets a restart check count them.
- Source attribution (`historyObservation`, `fieldObservations`) and the gap lists of `historyStatus` describe where values came from and which are absent; the values themselves are judged. A label or grade (`*Str`, `*Grade`, `*Approx`, `*Hours`, `*Icon`) is judged only when its value field is equal in both bodies, because its presence follows that value.
- `kma_client_eval.py` stays as the wire-shape check.

## Exclusions

No server2 runtime change and no production change (GET only). Measuring server2 against production and fixing what that finds belong to the following tasks.
