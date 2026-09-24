# Build
Owner/builder: /root (OpenAI Codex). Endpoint: local. Identity: candidate.json, based on ff7acf39.

Changed production components:
- RSS parser: assign upstream English wind direction through the existing label-code mapping; absence remains sentinel; weather English code preserved.
- ControllerTown RSS merge: finite numeric source validation, ws→wsd, integral wd 0..7→degrees, retain optional base fields; equal/newer/older policy unchanged. Include index zero in future scan. At 15:00 validate tmx itself, rather than tmn.

No schema, stored field names, providers, route ordering, units implementation or deployment configuration changed. No vector-component derivation or historical database backfill.

42 pre-edit cases: 38 intended failures and 4 passes. Same production bytes passed all 42 after minimal fix. Added publication-boundary assertions afterwards; final 43-case suite passed under UTC and America/Los_Angeles. No production refactoring after initial green; final post-refactor check confirms unchanged implementation.

Documentation updates explain exact numeric/label mapping, source guards, freshness, old collector timezone limitation and deployment boundary. Existing collection Archify JSON and generated HTML refreshed, artifact/browser/visual checks passed separately. New offline test documentation makes dependencies and mocks explicit.

Independent smoke discovered a pre-existing calculateTime() host-timezone dependency; source is unchanged by this patch. Full XML path validation explicitly uses UTC. Follow-up required before deploying collector on non-UTC hosts. No production state was inspected or mutated to establish host timezone.
