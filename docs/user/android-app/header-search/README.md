# TodayWeather Android: search from the header and unsaved places

[Read the PDF](manual.pdf) · [Editable source](manual.json) · [Capture provenance](provenance.json)

The weather screens have a search button beside the place name (#3180). A chosen
result, like a shared `link.todayweather.ai` link (#3096), opens a place without saving
it; an outline star in the bell's position saves it. The behavior is specified in
[specs/deeplink.md §6.2](../../../../specs/deeplink.md#62-navigation-overlay-cleanup-and-unsaved-places).

## Capture

The four screens are the native Compose screens rendered by `DeepLinkManualCaptureTest`
(Robolectric SDK 34, native graphics, Korean, 384×832 dp at xhdpi, light theme) with the
Seoul weather fixture (`core-domain/src/test/resources/corpus/inputs/kma-seoul.json`),
captured on 24 November 2026. They are not device captures. The short "added" message
is a system toast and is not in the last image. App Link verification and opening from
another app are checked on devices in #3098.

The main manual's device captures were taken before this change and still show the
earlier header.

## Rebuild

```sh
cd android && ./gradlew :app:testDebugUnitTest --tests '*DeepLinkManualCaptureTest*'
cp app/build/deeplink-manual/{saved-place,search,unsaved-place,added-place}.png ../docs/user/android-app/header-search/
cd .. && "$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/build_manual.py" \
  docs/user/android-app/header-search/manual.json docs/user/android-app/header-search/manual.pdf \
  --font "$MANUAL_FONT" --overwrite
"$MANUAL_PYTHON" "$MANUAL_SKILL/scripts/render_pages.py" \
  docs/user/android-app/header-search/manual.pdf /tmp/tw-header-search-pages
"$MANUAL_PYTHON" android/tools/manual/verify.py docs/user/android-app/header-search
```

This edition was captured on macOS and used NanumGothic (the macOS system font asset
`NanumGothic.ttc`) for Korean; the font is not distributed here. Captures from another host
differ slightly in anti-aliasing. Render and inspect every page before replacing the PDF.
`verify.py` checks the images, the PDF's text and embedded screenshots, and the capture
sources against `provenance.json`; update its hashes when the screens or their sources change.
