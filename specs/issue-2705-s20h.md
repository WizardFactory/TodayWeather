# S20h behavior specification

Source: [issue #2817](https://github.com/WizardFactory/TodayWeather/issues/2817), accepted S12 serving contract and AK's S19/S20 continuation. Exact paths are declared in [S20h.json](../server2/config/tasks/S20h.json).

## Public warning binding

Native `kma` selects the v000903 warning API. RuntimeServices owns an optional WarningService over the existing shared WarningStore and dispatches its GET/HEAD requests before the broader direct-KMA mount. Preserve case-insensitive matching and one trailing slash.

Empty owned storage returns 501 with `data is empty`, HTML content type, ETag, no cache-control and public CORS. Populated records return the existing ordered JSON with a 300-second cache age. HEAD preserves the corresponding headers and omits the body; conditional GET retains 304 behavior. Push, notice and older-KMA-only selections retain 404 for this API even when internal warning storage exists. Construction starts no warning acquisition or delivery loop.

## Combined API and state coverage

Select geocode, dsf, kma, kma-v000901, kma-v000902, town, push and notice together, with all three world versions and no legacy URL. Map exactly the 19 historical method/path groups plus notice and WW supplements to concrete cases. Reject duplicate or unexercised inventory entries.

Cases distinguish invalid input, unavailable/empty dependencies and populated state. The real-clock/no-weather nationwide fixture may return native partial 200 or the established rendered-child 500; validate the specific body/header contract of either result. A 200 must contain 15 weather entries and the exact included national prose; a 500 must preserve the rendered child error and its ETag. No other response class is accepted. This bounded contract check is not frozen-input weather parity.

Real public POST/PUT/DELETE/OPTIONS push handlers exercise registration, token replacement and deletion. Drain the registration writer, reconstruct services on the same owned S3 peer, and verify acknowledged sequence/token/deletion, exact notice wire bytes and original canonical narrative text/metadata. Invalid JSON must not advance acknowledged state. Recorded warning publications must also survive fresh service construction and retain GET/HEAD/cache/conditional behavior.

All dependencies use synthetic settings and code-injected owned or unreachable loopback endpoints. Do not read account/dotenv files or start delivery/narrative loops.

## Evidence and limits

- AC1: Cover the declared combined inventory and reject drift; restore the selected public warning contract with a deterministic pre-fix 404 versus expected 501 regression.
- AC2: Retain acknowledged public state, notice, narrative and populated warning data after reconstruction without background delivery/acquisition activation.
- AC3: Pass focused checks and separate neighboring functional smoke on recorded source/binary identities, placement/artifact checks, affected architecture/diagram checks, independent review and current CI before authorized main integration.

Preserve all failed assertions and setup failures separately. Whole-process behavior, production parity, fixed shadow, actual quotas and a previous full release remain unqualified.
