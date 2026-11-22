# Korean landing layout review

Run `npm run generate:tokens` at the repository root, then open
[the Korean page](ko/index.html) in a browser. The page uses the public token
stylesheet and the WebApp's local Pretendard font. The draft runs without
JavaScript, analytics or weather requests. Distribution routing, language
negotiation and translated content are covered by the [release plan](../plans/landing.md).

## Product captures

| Landing asset | Source | Visible evidence |
| --- | --- | --- |
| Hourly chart | [iOS current location](../docs/user/ios-app/screenshots/03-current-location.png) | Crop at (0, 742), 720 × 492. Midnight, the two series and the legend remain visible. The location, temperature and comparison above the crop come from the same capture. |
| Daily chart | [Android daily forecast](../docs/user/android-app/screenshots/09-daily.png) | Crop at (0, 746), 720 × 530. The current dot, both temperature bounds and adjacent days remain visible. |
| iOS widget | [Temperature Curve on the iPhone simulator](../docs/user/ios-app/widgets/screenshots/curve-hourly-comparison.png) | Hourly forecast and previous-day comparison from the November 19 style update. |
| Android widget | [City clocks on Galaxy S21+](../docs/user/android-app/widgets/screenshots/place-clocks.png) | New York Blue Hour widget from the November 20 guide update. Crop at (0, 530), 967 × 518. |

The storefront [review synthesis](../docs/evidence/research/landing-store-voice-2026-11-21.md)
explains the choice of the outfit, hourly comparison and daily range examples.
The first layout uses the shared display weight and size as the basis for a
locally scaled heading. Check reuse across the remaining languages before
adding a shared marketing typography role. Country, unit and formatting rules
belong to the product locale contract in the [landing spec](../specs/landing.md).

The hero and Seoul forecast links use the [public link contract](../specs/deeplink.md). Native handoff and rollout verification are tracked in [#3098](https://github.com/WizardFactory/TodayWeather/issues/3098).
