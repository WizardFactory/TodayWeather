# Korean landing page

Run `npm run generate:tokens` at the repository root, then open
[the Korean page](ko/index.html) in a browser. The page uses the public token
stylesheet and a subset of the WebApp's Pretendard font. It runs without
JavaScript, analytics or weather requests. Distribution routing, language
negotiation and translated content are covered by the [release plan](../plans/landing.md).

`npm run test:landing` generates the tokens, reads the subset font's character
map and checks it against the page text, and checks that every referenced file
exists.

The Korean page is published at `https://todayweather.ai/` until the locale
routes ship, so its canonical link, `og:url` and the sitemap name the root.
Release packaging rewrites only the relative asset paths.

## Font

`assets/landing-sans.woff2` holds only the characters the pages render, about
80 KB against 2 MB for the full variable font. After editing page copy, run
`python3 scripts/landing-font-subset.py` (needs `fonttools` and `brotli`; the
committed font was built with fonttools 4.60.2). Pretendard reserves its name
under the SIL OFL 1.1, so the subset is named TW Landing Sans. The script
copies the license to `assets/landing-sans-OFL.txt`, which is published beside
the font. Image alternative text is not part of the subset: it shows only when
an image fails and then uses the fallback fonts.

## Root files

`root/` holds files served from the site root: `robots.txt`, `sitemap.xml`,
`favicon.ico`, `apple-touch-icon.png` and the share image `og/ko-<hash>.png`
(1200 × 630, rendered from the hero copy and hourly capture). The page's
Open Graph and icon tags point at these production URLs. The share image name carries the first eight hex digits of its SHA-256, because messengers such as KakaoTalk cache link previews by image URL; a changed image needs a new name, and the landing check enforces it.

## Icons and store QR

The page icon, `favicon.ico` (16, 32 and 48 px) and the share image use the
store app icon, [`icon-1024.png`](../ios/TodayWeather/Assets.xcassets/AppIcon.appiconset/icon-1024.png),
masked to rounded corners (22.37 % radius). `apple-touch-icon.png` stays square
because iOS applies its own mask. `assets/store-qr.svg` is the WebApp's desktop
QR ([`AppQrCode.tsx`](../web/src/AppQrCode.tsx)) for
`https://link.todayweather.ai/open?fallback=store`; the landing check fails if
the two drift apart. It is shown only on wide windows with a mouse or trackpad.

## Product captures

| Landing asset | Source | Visible evidence |
| --- | --- | --- |
| Hourly chart | [iOS current location](../docs/user/ios-app/screenshots/03-current-location.png) | Crop at (0, 742), 720 × 492. Midnight, the two series and the legend remain visible. The location, temperature and comparison above the crop come from the same capture. |
| Daily chart | [Android daily forecast](../docs/user/android-app/screenshots/09-daily.png) | Crop at (0, 746), 720 × 530. The current dot, both temperature bounds and adjacent days remain visible. |
| iOS widget | [Temperature Curve on the iPhone simulator](../docs/user/ios-app/widgets/screenshots/curve-hourly-comparison.png) | Hourly forecast and previous-day comparison from the November 19 style update. Lossy WebP at quality 90. |
| Android widget | [City clocks on Galaxy S21+](../docs/user/android-app/widgets/screenshots/place-clocks.png) | New York Blue Hour widget from the November 20 guide update. Crop at (0, 530), 967 × 518. |
| WebApp, desktop | `https://app.todayweather.ai/weather/seoul/hourly` on November 24, 2026 | 1360 × 1250 viewport at 2×, scrolled to the hourly card, cropped to 1222 px and scaled to 2040 × 1833. Live Seoul data. The hourly forecast, the previous-day series and the 18-day range chart are visible together. Captured in light and dark themes. |
| WebApp, phone | Same address at a 390 × 844 viewport at 2× | Top 1102 px (780 × 2204): current conditions, the comparison with yesterday and the hourly card. Shown below 640 px. Captured in light and dark themes. |

The native chart captures exist only in the light theme. In dark mode the page
dims them and fades only the icon rows at the scrolled edges of the hourly
chart, leaving the legend and the temperature lines untouched.

The storefront [review synthesis](../docs/evidence/research/landing-store-voice-2026-11-21.md)
explains the choice of the outfit, hourly comparison and daily range examples
and lists the review excerpts quoted in the reviews section. Each excerpt is
verbatim, unattributed to a person, and labelled with its store only.
The first layout uses the shared display weight and size as the basis for a
locally scaled heading. Check reuse across the remaining languages before
adding a shared marketing typography role. Country, unit and formatting rules
belong to the product locale contract in the [landing spec](../specs/landing.md).

The hero and Seoul forecast links use the [public link contract](../specs/deeplink.md). Native handoff and rollout verification are tracked in [#3098](https://github.com/WizardFactory/TodayWeather/issues/3098).
