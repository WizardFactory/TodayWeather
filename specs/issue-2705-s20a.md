# S20a runtime services specification
Input: [intent](../intent/issue-2705-s20a.md), #2789 and current 20cd322 source (bdb investigation is historical).

RuntimeServices::from_vars_at constructs one optional bounded HttpS3 transport, reused by all selected services and native dependencies. push selection builds KMA v000902, DSF v000902 and a native geocoder without selecting public routes. It starts only the existing durable registration writer, never delivery loops. notice selection constructs NoticeStore; Translator remains CLI-only.

Gateway construction accepts optional explicit legacy URL. Without it, unselected/unsupported paths terminate. Selected native Forward is terminal even when legacy exists. NativeFetch holds actual backend/geocoder handles; fixed logical origin http://server2.internal permits existing worker URL builders, with no network use. Only exact generated KMA/DSF v000902 and geocode v000903 targets are admitted; query units and Accept-Language use existing parsers. Each call is bounded by 3s and native handler acquisition rules. Unsupported origins/routes/missing dependencies return sanitized errors.

One WarningStore and WarningFeed are installed in LiveForecast's WarningCollector before Arc and in the KMA read service. Existing collector ordering guarantees durable zone publication before feed and existing feed partial-failure retry semantics. No startup gather. Native-without-legacy gets existing 12s lifetime, never <=9s gateway deadline.

Composition has one fallback: selected push dispatch first, gateway next; notice contributes an explicit route. Foundation health/admission/CORS and private metrics remain. Reuse push methods, body-parser limits, errors, headers and 9s registration wait; notice GET/HEAD remains read-only with no translation. No data migration or new persistence keys beyond existing modules. Rollback removes selected family and restarts with explicit coexistence URL if desired.
