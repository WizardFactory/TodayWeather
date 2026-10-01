# Specification
Consumes intent/issue-2633.md and reports/sdlc/issue-2633/investigation.md.

When history cannot fit the local daily cap, a location without fresh current may fetch the existing forecast-only range if its 1-record cost fits. Existing fresh current is returned without network work. All locations share this behavior; no country/coordinate special case. Local budget errors receive a private machine-readable code; only this code authorizes range degradation. Provider-down, missing key, malformed data, exhausted budget and requester failures retain existing handling. Counters use actual returned cost and no cap is raised. Budget remains the existing approximate read/check/write mechanism under concurrent workers.

No public schema or storage migration. Missing history remains omitted/sentinel according to existing response builders; do not invent observations or write a no-yesterday marker for an unrequested history range. Re-evaluate history on future requests and after UTC budget reset. Existing fresh/stale cache windows and post-lock re-read remain intact.

Tests: reported 976/1000 with both Brasília coordinates and another zone; full/empty budget boundaries; fresh cache avoids repeat calls; reset resumes history; provider-down cannot downgrade; stale fallback at exhaustion. Functional smoke uses real local HTTP gateway -> full overseas route middleware and synthetic provider/persistence dependencies, explicitly not live-provider acceptance. Production AC requires later deployment.

Security: no new external endpoints/credentials, no raw-provider logging, no expanded budget. Alternative quota increase rejected because it changes operating cost and does not fix range selection. A partial recent-history step rejected in favor of prioritizing forecast capacity for more cold locations.
