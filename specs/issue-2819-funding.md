# Selected-key geocoder funding behavior

- Cache and stored-address hits retain existing behavior and require no new provider funding. A shared lookup owner drives one provider sequence, independently of waiter cancellation.
- Provider/key selection keeps existing geography/language and fallback rules. Complete Korean Kakao data does not depend on Google budget. Google supplementation occurs only when existing assembly requires it; an outer Kakao failure remains terminal for coordinate lookup. Address lookup retains Google-first/Kakao-fallback and foreign coordinates use Google.
- Before each eligible HTTP attempt, request one logical unit for that exact provider/key index through existing Quota/S08 ownership. No HTTP or HTTP-attempt counter before funding. A locally unavailable key may be skipped for the next configured key within the existing ring and whole-operation deadline. No new retry or deadline extension. Recompute remaining time after quota IO.
- The quota interface, UTC-day/per-key policy, built-in allowance values, durable range ownership, failure/unknown handling and no-refund rule do not change. A selected reservation may remain spent if cancellation/deadline intervenes before send; this correction is not an exact-wire accounting or refund promise. Unused providers/keys are not proactively requested.
- When no key can be funded, fail closed with no provider work. Successful wire fields, KMA projections and bounded cache behavior remain. No new runtime mode, env setting, legacy read or forwarding.

AC1–4 are defined in intent. Existing TownGeocoder already uses selected-key single-demand funding, so reuse the existing interface rather than add a quota layer. B2/B3, actual quota headroom and production eligibility remain outside this PR.
