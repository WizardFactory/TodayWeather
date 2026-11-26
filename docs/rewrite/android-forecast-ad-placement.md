# Android forecast advertising screen specification

Release design for [#3041](https://github.com/WizardFactory/TodayWeather/issues/3041).

## Goal

Ship one Android release default for TodayWeather. Replace the fixed bottom banner with an AdMob native card on Hourly, Daily, Saved Places and Air. Give Hourly and Daily independent first-visit protection and share one daily interstitial allowance across both. Use #2654 for measurement and #2871 for serving history. No A/B assignment.

## Screen specification

| Vertical scroll order | S03 · Hourly | S04 · Daily |
| --- | --- | --- |
| 1 | Current conditions and the complete hourly chart, including expanded rows | Current conditions and the complete multi-day chart |
| 2 | Hourly air-quality forecast, when available | Daily air-quality outlook, when available, then the entire horizontally scrolling detailed-weather row |
| **3** | **One native ad card** | **One native ad card** |
| 4 | Current air readings, detailed weather and air cards as available, then attribution | Weather data attribution |
| Fixed navigation | Existing tabs | Existing tabs |

Insert the card in the outer vertical scroll, outside every horizontal gesture area. On Hourly without the air forecast, insert immediately after the chart. On Daily without day details, insert after the daily air outlook, or after the chart if both are absent. Require a rendered forecast chart. Keep startup, alerts, search, errors and loading placeholders free of ads. With an unavailable ad omit the slot and its margins. Decide when the reader reaches the slot's insertion point, that is, when it is at or above the bottom edge of the scroll viewport, as iOS does. An ad that is ready before then is shown in that visit. If no ad is ready when the slot is reached, skip the card for that visit and keep the pending load for a future visit (#3212). The SDK measures an impression on the Android view, which the Compose scroll clip does not hide. The card's view therefore stays invisible, with its size kept, while no part of it is inside the scroll viewport. A card under the tab bar records no impression. Each tab can reuse its own registered card for 55 minutes from load. Keep one unused creative ready for eligible tabs that have no assigned card. After a failed request, retry on demand after at least a minute. Clear cached creatives when ad serving is disabled.

[Hourly screen](https://github.com/WizardFactory/TodayWeather/blob/4afc6d2a9ef4eae9e94c5b3a4f74ced5aa5ae2da/docs/user/android-app/screenshots/05-hourly.png) · [Daily screen](https://github.com/WizardFactory/TodayWeather/blob/4afc6d2a9ef4eae9e94c5b3a4f74ced5aa5ae2da/docs/user/android-app/screenshots/09-daily.png) · [Android layout and card order](https://github.com/WizardFactory/TodayWeather/blob/4afc6d2a9ef4eae9e94c5b3a4f74ced5aa5ae2da/android/app/src/main/java/net/wizardfactory/todayweather/ui/forecast/WeatherPage.kt#L147-L185)

### Native card layout

```text
       12 dp outside the card on each side
  ┌────────────────────────────────────┐
  │ 광고 / Ad                 AdChoices │
  │ Headline                            │
  │ Media supplied by the SDK           │
  │ Advertiser / body       [SDK CTA]   │
  └────────────────────────────────────┘
```

Saved Places uses the stacked card above with 12 dp inner padding and vertical separation. Hourly, Daily and Air use a compact card targeting approximately half the stacked height at the default phone size. Below the attribution, a 120 × 120 dp MediaView sits beside the icon, headline, advertiser, body and CTA. Use 8 dp inner padding and 6 dp outer vertical spacing. The card grows as needed for larger fonts, long copy and narrow displays. Match text contrast to the active theme. Keep attribution and the SDK overlay visible at large font sizes. Wrap text and move the CTA to its own row on narrow displays. Render required assets for the served format and omit absent optional assets. Register the creative views with the SDK and leave surrounding space inert. Preserve scroll position on rotation. [Android native ad rendering](https://developers.google.com/admob/android/native/advanced)

### Saved Places and Air

| Screen | Placement | Eligibility |
| --- | --- | --- |
| S02 Saved Places | Below the final visible saved location in the list | At least one visible place. Hide while searching, editing, displaying search results or handling an empty list. |
| S05 Air | Below the current air grade, health guidance and hourly AQI graph, before the detailed pollutant tiles | Render only with air content. Leave the existing navigation and air information accessible. |

## Repeat-visit interstitial

- Track visits on device by local calendar date, app-wide across cities. Record the first visible visit to Hourly and Daily independently, including initial launch into either screen. The first visit to each always opens immediately. After the user has scrolled beyond the source forecast chart into its details, an intentional foreground transition from one forecast tab back to an already visited Hourly or Daily screen is a candidate. Reselect-to-refresh, chart gestures, city changes, resume, recreation, back, notifications, widgets, alerts and deep links never draw.
- Initial probability: **10% per eligible transition**, a conservative product default, not a measured optimum. Draw once per distinct navigation action. Three eligible transitions give a 27.1% chance and five give 41.0%, assuming independent draws and a ready ad. A miss opens the forecast immediately.
- Only present a ready ad at an expected break between sections. The first forecast and emergency information must remain immediately accessible. If the transition would surprise the user before the requested content, pass through. Never wait for an ad or display a late callback over a forecast. Resume the selected destination once on dismissal or show failure. Frequency controls do not by themselves establish placement compliance. [Play ad policy](https://support.google.com/googleplay/android-developer/answer/9857753) · [AdMob interstitial guidance](https://support.google.com/admob/answer/6201362)
- Persist both seen flags and one shared cap per installation across process death. Serialize rapid taps. Durably reserve today's allowance before calling show, consume it on display, release only on a confirmed failure before display. Keep an ambiguous reservation spent after a crash. Reset on advancing to a new local date, never reopen an earlier date on clock rollback. The cap applies to full-screen displays only. Honor ad consent and separate remote off controls for native and interstitial formats.

## Completion criteria

- [ ] Device screenshots with test ads across the four eligible screens match the positions above, including missing AQI, narrow width and large text. Chart gestures and tab hit targets work. No fixed banner, blank no-fill gap or late content shift.
- [ ] Deterministic navigation checks cover Hourly first → Daily first → Hourly repeat, both random outcomes, the reverse starting tab, no fill, double taps, restart and local midnight. Each first visit is protected and total full-screen displays across both tabs never exceed one per day. Device checks cover a missed opportunity, display/dismissal and notifications.
- [ ] Publish through the normal Android release process, record store version and rollout status, and monitor actual impressions and estimated revenue by format, revenue per active user, retention and crash health. Compare by version with consent coverage and traffic mix noted.

Historical context: #189 proposed a city-switch interstitial. #366 dropped a launch ad for latency. The daily repeat-visit rule above is the current product decision. [Developer discussion of daily caps](https://www.reddit.com/r/admob/comments/1fv7cpj/)
