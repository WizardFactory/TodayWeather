# TodayWeather for iOS: ad tracking permission

[Read the 5-page PDF](manual.pdf). The [editable source](manual.json) holds the same steps. The [screenshots](screenshots/) are actual captures from an iPhone, with their [provenance](screenshots/provenance.json).

The manual covers the App Tracking Transparency flow added in #2945 (pull request #2949): the explanation, the iOS prompt, the app after declining, and the setting to change the answer. The rest of the app is described in the [Android manual of the same Cordova app](../cordova-app/README.md).

| Page | User task |
| --- | --- |
| 1 | Read the explanation |
| 2 | Answer the iOS prompt |
| 3 | Use the app after declining |
| 4-5 | Find the setting and turn tracking off or on |

## Not shown

- A first launch after a new install. The captures start from an update over 1.1.1.
- The consent message for European regulations, which comes before the prompt where it applies.
- An ad. With tracking allowed the banner showed a third-party ad, which is left out.

## Reproduce

1. Build the iOS app from `client/` with the release configuration and sign it for the device (see the [release runbook](../../operations/cordova-store-release.md)). The AdMob IDFA explainer message must be published.
2. Install it on an iPhone whose tracking choice for TodayWeather is still open, launch it and capture the explanation and the prompt. The choice can be set only once per install; afterwards use Settings > TodayWeather > 추적 허용.
3. Downscale the captures to 720 px width with a 256-color palette.
4. Build the PDF with the installed screenshot-manual skill, whose requirements (`reportlab`, `pypdf`, `pypdfium2`, `Pillow`) must be installed: `python3 <screenshot-manual>/scripts/build_manual.py docs/user/cordova-ios/manual.json /tmp/manual.pdf --font "/Library/Fonts/Arial Unicode.ttf"`, then render and inspect every page.
