# Independent-review corrections

QA1-F1: submission now matches the current submitted search text against the public catalog and resolves that exact text when live geocoding is available; it never selects an old debounce result. New actual-browser immediate-Enter regression failed before the fix.

QA1-F2: delayed selection now reads the latest shared state through a stable ref, updates that ref synchronously, and merges favorites with the current preferences. The regression holds geolocation, adds Busan, changes temperature to F, then releases the Seoul callback and requires both retained Busan and F. The old production bundle fails it.

QA1-F3: offline reads require finite receipt time within 24 hours (with at most one minute clock skew), a bounded fetch timestamp, exact query identity/units, and a complete nested normalized Weather shape. Invalid records are deleted and the regular recoverable error view remains available. IndexedDB exceptions are best effort; snapshot pruning tolerates concurrent shorter result sets. Browser corruption regressions for missing timestamp and null hourly data fail against the old bundle; a domain-level table covers additional timestamp/nested shape failures.

Main finding N1: nationwide weather preserves cityName before regionName, keeping Chuncheon/Gangneung and Mokpo/Yeosu distinct. Yeosu and Andong were added to the public catalog and schematic map. A same-province distinct-city regression fails against the old adapter.

No architecture topology, upstream route, native application or collector behavior changes in this correction. Existing Archify evidence remains applicable. Review findings are pending reviewer confirmation on the new candidate.
