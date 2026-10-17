# Forecast narratives in existing weather responses (#2798)

Owner: AK; builder: Codex /root (OpenAI). On2026-10-17 AK amended the scope: extend existing nationwide and regional weather responses, with no new endpoint and no narrative in the warning screen. Existing pre-merge authority persists; no merge, auto-merge, queue, deployment/restart, production writes, new accounts or permission changes.

Problem: structured weather responses omit KMA's explanatory short-term forecast narrative. Nationwide weather needs the nationwide publication; ordinary domestic weather needs the publication for its forecast office region, e.g. Seoul/Incheon/Gyeonggi all receive that region's bulletin. These are provider-authored regional bulletins, not extracted portions of national prose.

AC1: bounded scheduled collection for nationwide and all9regional getWthrSituation offices, idempotent station/publication storage, auth/quota rotation and credential-safe failure handling. Existing warning/zone/push behavior remains intact.
AC2: additive forecastNarrative object in existing nationwide weather and domestic regional weather responses, selected by national/matching regional office. Preserve every existing weather field and /kma/special types1–4. Missing, invalid, expired or failed optional data cannot break weather, cross regions or appear freshly published. Preserve original multiline Korean plain text and true UTC publication/expiry metadata.
AC3: focused credential-free regressions and separate real HTTP/persistence smoke, accurate API/manual/architecture/rollback and issue updates, current-candidate CI and independent review. Live acquisition/rollout/readback stays separately operator-approved; issue remains open until that verification.

Scope: legacy server implementation/tests plus maintained docs and issue updates. No separate API, server2 work, client parser/rendering, translations, marine/land product expansion or new push sends. Mobile display requires a later app update to consume the new field (#2803). Provider text remains untrusted plain text; no HTML rendering contract is introduced.
