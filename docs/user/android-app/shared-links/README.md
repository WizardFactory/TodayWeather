# TodayWeather Android: shared links

[Read the PDF](manual.pdf) · [Editable source](manual.json) · [Capture provenance](provenance.json)

A `link.todayweather.ai` link opens the native app on its place and tab (#3096). A place
that is not among your saved places shows without being saved, with 즐겨찾기 추가
(Add to favorites) above the tab bar. The behavior is specified in
[specs/deeplink.md §6.2](../../../../specs/deeplink.md#62-navigation-overlay-cleanup-and-ephemeral-preview).

## Capture

Both screens are the native Compose screens rendered by `DeepLinkManualCaptureTest`
(Robolectric SDK 34, native graphics, Korean, 384×832 dp at xhdpi, light theme) with the
Seoul weather fixture (`core-domain/src/test/resources/corpus/inputs/kma-seoul.json`) for the
linked place 분당구, captured on 23 November 2026. They are not device captures:
App Link verification and opening from another app are checked on devices in #3098.

## Rebuild

```sh
cd android && ./gradlew :app:testDebugUnitTest --tests '*DeepLinkManualCaptureTest*'
cp app/build/deeplink-manual/{shared-place,added-place}.png ../docs/user/android-app/shared-links/
cd .. && "$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/build_manual.py" \
  docs/user/android-app/shared-links/manual.json docs/user/android-app/shared-links/manual.pdf \
  --font "$MANUAL_FONT"
"$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/render_pages.py" \
  docs/user/android-app/shared-links/manual.pdf /tmp/tw-shared-links-pages
"$MANUAL_PYTHON" android/tools/manual/verify.py docs/user/android-app/shared-links
```

`verify.py` checks the images, the PDF's text and embedded screenshots, and the capture sources against
`provenance.json`; update its hashes when the screens or their sources change.

This edition used WenQuanYi Zen Hei (`wqy-zenhei.ttc`) for Korean; the font is not
distributed here. Render and inspect every page before replacing the PDF.
