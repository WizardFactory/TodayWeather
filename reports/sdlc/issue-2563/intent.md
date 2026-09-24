# Intent
Use dotenv to apply the supplied file as server/.env at startup. Keep secret values local.
AC1: load before New Relic/config regardless of cwd, including direct app import.
AC2: existing process values win; missing file allowed; other read failures stop with a sanitized error; use documented dotenv syntax semantics.
AC3: uploaded file copied byte-for-byte with mode 0600 and ignored by Git; examples contain placeholders only.
AC4: Node 10-compatible dependency; document missing keys, unused variables and loading flow; regenerate existing architecture artifact.
AC5: offline test-first regression, additional real config smoke and independent verification pass.
Authority: user explicitly chose dotenv; local endpoint. Do not start collectors or contact production services.
