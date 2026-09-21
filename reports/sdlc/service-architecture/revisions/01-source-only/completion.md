# Local completion

All requested local deliverables are complete and independently verified at candidate `sha256:316b77b3a5ca92a6f115f396d61bd577b422e768b276bbb5bf105b498f0790cb`.

| Criterion | Outcome |
| --- | --- |
| AC1 | Source-linked service overview covers components, runtime modes, persistence, platforms and historical deployment evidence. |
| AC2 | Collection document covers UTC timing, LIFO/direct dispatch, KMA request/parse/save versions, scrape/auxiliary products, DSF/AQI cache fill and legacy boundaries. |
| AC3 | Mobile document traces exact paths/query/retries/cache, KMA/DSF response middleware and parsing, external gateway gap and widget differences. |
| AC4 | Three Archify JSON+HTML views pass 27 showcase checks, all four required desktop sizes per view, light/dark captures and perceptual review. Canonical AGENTS.md and @AGENTS.md Claude adapter pass resolution, six navigation journeys and independent decision evaluation. |

Start at docs/architecture/README.md. Standalone diagrams: service-overview.html, weather-collection.html, mobile-weather-request.html in docs/architecture/diagrams. Source/artifact SHA-256 and per-view evidence are indexed by diagram-handoff.json; exact primary files by candidate.json. Self-verification and independent-verification.md are distinct records. All 128 local document links pass. Independent review findings are resolved.

Product source and runtime configuration are unchanged. The original README body is preserved with one navigation insertion. No commit, push, PR, merge, deployment, provider call or database operation was performed. Historical product integration tests and mobile builds were not run. Isolated VM assertions use mocked clocks/HTTP and are not live integration tests. Claude adapter resolution is verified locally, not through a separate Claude runtime launch or cross-provider review.

The public /weather and /geocode gateway implementation, release configuration, live topology and current provider availability remain explicitly unknown. These are limitations of available source evidence, not omitted promised implementation.
