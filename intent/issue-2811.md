# Correct legacy iOS widget daily display

[Issue2811](https://github.com/WizardFactory/TodayWeather/issues/2811) follows AK's retained widget decision and authorized parallel plan. DISPLAY: raw WW six-day dates/extrema/icons must render in C/F without losing normalized coordinate or Korean daily behavior. BUILD: standalone widget links without unused Cordova; app Cordova linkage stays intact. SAFETY: original request/server contracts, private configuration, unrelated source and external side effects remain protected.

Continue implementation/tests/manual/review/PR/main integration within the standing reviewed-main authority. No production actions or WidgetKit/AppStore modernization are authorized. Use a new correction ledger with maximum3widget-related compiles, preserving the prior baseline's3attempts; exhausted failure switches to app-only checks with honest unmet criteria. This fixes existing legacy Today UI, not actual activation on iOS18+ (Apple removed Today extensions).
