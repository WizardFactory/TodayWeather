# Specification

Read intent/issue-2635.md and reports/sdlc/issue-2635/investigation.md. Introduce code EWEATHERUNAVAILABLE with an absolute millisecond retryAt. Provider marker uses expireAt. Budget uses the queried usage day's next UTC midnight; recheck if that day has rolled over during asynchronous lookup. Delay = max(1, min(3600, floor((retryAt-now)/1000))); fractional final second rounds to one because Retry-After requires a positive integer.

The shared DSF controller recognizes only this code, returns 503 JSON {code, retryAt}, Retry-After and Cache-Control:no-store. Gateway recognizes only a valid typed backend 503 with finite positive retryAt, skips immediate retry, recomputes delay, and returns generic text Service Unavailable. Existing overload 503 retains Retry-After:5. Other backend failures, deadline behavior, 400/404/501 mappings and CORS mounting stay unchanged. No provider/cache credentials or raw error messages enter the public 503.

Stored current/fallback data still wins and returns success. DB and usage schema unchanged. Extend offline tests across controller, real loopback, versions, fallback, reset and deadline boundaries. Native source compatibility recorded on the issue before edits; no native execution claim. Rollback is reverting task commits; deployment is human-owned.
