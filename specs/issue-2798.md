# Specification (#2798)

Consumes intent/issue-2798.md. Official service: https://www.data.go.kr/data/15058629/openapi.do (read 2026-10-17). GET HTTPS VilageFcstMsgService/getWthrSituation with stnId=108, JSON, pageNo=1, numOfRows=10; no historical time filter. Latest publication within 24 hours. wfSv1 is optional; wn/wr are not used.

Add narrative acquisition last in the existing 3-minute warning cycle so it cannot prevent earlier warning processing. Reuse consolidated data.go.kr key parsing and auth/quota classifications, one attempt per configured key and 30-second per-request timeout. No immediate non-key retry or pagination; reject redirects and non-200 responses. Redact transport/provider messages, including nested error fields.

Use separate type 5. Validate every item before writes: nationwide station, 12-digit real KST calendar publication, non-future and age <24h, nonempty string wfSv1. Pick latest eligible publication. Persist by type/publication using the legacy KST-wall-clock announcement convention, preserve exact text except CRLF normalization. No situationList, zone or push state from narrative. Upsert same publication without updating announcement; no provider failure creates/re-dates content.

Read type 5 after legacy [4,1,2,3], preserve relative order. Korean fixed name 종합예보 pending localization follow-up. Convert announcement by -9h once. Require 0<=age<24h at response time; omit invalid/expired/empty rows. Escape &,<,>,quotes at server response boundary and retain line breaks without legacy bullet insertion. Optional narrative query errors/empty data omit it; legacy reader errors retain existing semantics.

Storage identity follows existing publication upserts; same-process overlap guarded for narrative. No runtime dependency changes. Rollback restores prior selective overlay files and, only with operator approval, restarts affected workers; retained type 5 rows are ignored by old reader. No production actions in this task.
