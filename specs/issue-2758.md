# AirKorea observation repair specification

Input: approved intent and actual 2026-10-16 diagnostics for #2758.

Identity validation stays mandatory. A station is explicitly unobserved only when its identity and network are nonblank strings, its timestamp is exactly null, and all nine supported value fields are present and exactly null. Skip that row, report its station identity as unavailable, and never invent a date or write it. Undefined/empty/malformed timestamps and a null timestamp with any missing/non-null value remain invalid. A valid-time row with no valid concentration keeps the existing unavailable behavior. Duplicate rows, province mismatches and all-unavailable batches remain failures. Province averages use only accepted latest urban-monitoring rows, with each pollutant's valid-value denominator.

Only station and city-statistics operations may recover a zero totalCount that accompanies nonempty items. Require valid numeric total, requested page/size echoes and at most pageSize items. Traverse zero-total pages until an explicitly empty terminal page. A nonempty page after a short page is incomplete; changing totals, duplicate observations, oversized pages, wrong page/size, exhausted page/row/time budget or failed terminal request reject the entire fetch. An empty first page remains EMPTY_ITEMS. Positive totals retain the current exact count contract. Auxiliary operations retain strict total checks.

Rejection metadata uses allowlisted reason, field and row-index or bounded numeric page/count fields. It contains no observation values, names, timestamps, URLs, keys or provider body. Pass it through failure outcome logs safely. Error codes and retry/key behavior remain compatible.

No schema migration, dependency change, fallback change or production operation. Verify with recorded fixtures and real loopback HTTP/disposable Mongo through the collector, direct average reader and nation route with external fallback disabled. The deployed direct-reader behavior is tested separately from the repository fallback wrapper.
