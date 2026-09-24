# Investigation
Baseline: 87b8855f308611a07897cd3a39c45fefb3088d77. Inspected actual requester, manager, current/short persistence controllers, logger and weather consumers.
Requester uses old host/paths, requires 0000, assumes response envelope and logs URL on recvFail plus key in requestData metadata. parseFloat accepts prefixes and can produce NaN; shortest RN1 assignment needs strict finite/nonnegative parsing while preserving zero.
Current upstream manager nonnegative checks, Kakao initialization/API, logger protection and existing-current merge must remain unchanged. No need for optional policy profile.
Short persistence stores values without period conversion. controllerTown24h.adjustShortR06S06 divides legacy amounts across adjacent records; controllerTown uses t3h in summaries/interpolation and RSS merge. These are period assumptions, not proof of migrated equivalence. Characterize them without changing their algorithms.
Isolated VM loader can execute real CommonJS exports with explicit dependency whitelist, synthetic HTTP and model adapters, real xml2js/async and forbidden timers. No server startup needed.
