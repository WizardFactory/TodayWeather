# Intent: RSS wind conversion and safe fallback
Owner: /root; source: issue #2554 and AK's request to proceed; endpoint: local.
Correct collector English wind direction and prevent RSS fallback from losing valid client wind fields.
- AC1: Test-first regression, wdEn maps all eight English compass labels to existing stored codes; wfEn remains weather text code.
- AC2: ws maps to wsd; numeric wd 0..7 maps to 0..315 degrees; invalid/missing data preserves base values.
- AC3: Every selected RSS overwrite validates source; absent wav/uuu/vvv must not erase base values; field-specific sentinels respected.
- AC4: Preserve newer/equal/older publication policy, future-only matching, first slot and midnight/timezone boundaries.
- AC5: Both DB projections, three synthetic grids, and downstream response/units verified in isolation; distinguish RSS, current, shortest publication timestamps.
- AC6: Update architecture and generated diagram; independent verification; honest local/production limitations.
No DB migration/backfill, provider/auth changes, Jeju unrelated diagnosis, production writes/restart/deploy or remote publishing. Origin/CDN checks are deferred until a separately approved deployment.
