Task: issue-2614-bounded-shadow; owner: Codex /root; base: 9b3a362e8b84a8f555fc6e475bed41d508f42462; endpoint: pre-merge.

Authority: AK approved seven-day/6000GET-HEAD/35USD AWS+5USD providers/onehost and HOTL; Nov13 explicitly waived prior shared-headroom proof and asked moderate shared-key use. No production deployment/device sends.

Collect reviewable paired responses across the approved native read inventory without unbounded request loops or lost budget after interruption. The operator owns provider acquisition, cloud lifetime/cost/cleanup and source/catalog preservation separately; this sampler neither launches nor stops server2 and must not be used as the whole seven-day supervisor.

- BOUND: dry plan makes no network calls; execution admits only fixed public read routes, literal-loopback candidate and the approved production HTTPS origin. GET/HEAD only, no redirects/proxies/retries. At most 6000 attempts per origin, 168 hours, one request in flight, >=1 second spacing and bounded bodies/deadlines.
- RECOVERY: reserve each network attempt durably before sending; retain its slot on failure or interruption. Existing run state is never overwritten. Resume requires identical manifest/endpoints and does not replay uncertain requests or catch up missed rounds in a burst. Concurrent ownership fails before requests.
- EVIDENCE: retain raw response bytes and status/selected cache/publication headers with digest/timing per attempt. Authentication/quota responses stop capture; no success/parity qualification inferred from capture completion. Preserve incomplete pairs and terminal reason.
- PLACEMENT: all implementation and tests stay under declared server2 paths; only named docs outside; no dependencies on legacy assets.
