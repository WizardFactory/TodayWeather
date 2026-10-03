# Specification: unified data.go.kr keys

[Intent](../intent/issue-2618.md) governs scope. Keep DONGNAE_SECRET_KEYS and its
existing serialized config field for compatibility. Add a shared parser that
accepts an array or JSON string, removes empty/default/duplicate entries and
rejects malformed list shape without exposing values. Config defaults to [];
legacy env presence emits one sanitized startup warning and never supplies keys.

UV/pollen setServiceKey takes the list and replaces earlier state. KASI and
warnings read only that list. Forecast-zone accepts a list, classifies JSON/XML
and HTTP auth/quota through dataGoKrRejection, rotates once through the list and
retains bounded transient retries without logging credentials. Forecast Manager
keeps its existing per-service cycle ownership. Routes pass list-derived keys;
forecast-zone database reads need no credential. Empty lists fail before HTTP.

UV and pollen use shared rejection classification for HTTP 401/403/429 and
provider 20/22/30/31/32, stop after exhaustion without falling back to older
issuances. Existing conversion, publication, persistence and pagination contracts
remain unchanged. Warning quota now rotates to another key, never retries the
same exhausted key in one request. KASI preserves allKeysRejected retry stopping.

Document approvals including UV V5, pollen V3, KASI, forecast/mid/warnings and
forecast-zone. AirKorea approvals are optional for the separately configured
AirKorea list. ASOS subscription remains outside the migration. Reject dual
legacy fallback because it defeats the sole-source acceptance criterion.
