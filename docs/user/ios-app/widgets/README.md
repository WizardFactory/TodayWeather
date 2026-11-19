# Home Screen widgets

Classic Color, Morning Sky and Temperature Curve are available in small and medium sizes. For Temperature Curve, a medium widget plots the daily high and low separately. Long-press the widget, choose **Edit Widget**, and enable **Hourly forecast** to see the forecast in amber and the previous day at the same local hours in dashed lavender. The [hourly comparison screenshot](screenshots/curve-hourly-comparison.png) shows both temperatures at each hour. Gaps indicate missing comparison values. Small shows the current temperature within today's range.

The [three medium widgets](screenshots/styles-medium.png) and the [small widgets with the hourly curve](screenshots/styles-hourly.png) were captured on the iPhone 16 simulator Home Screen on 19 November 2026 using the native app, its embedded WidgetKit extension and synthetic weather for Seoul. The colored weather icons are adapted from the legacy TodayWeather widget.

## Original widget walkthrough

[Widget guide (Korean PDF)](manual.pdf) · [Editable steps](manual.json)

The screenshots show the WidgetKit gallery, widget settings and Home Screen on an isolated iPhone 16 simulator running iOS 26.5 in Korean. They were captured for issue #3043 on 18 November 2026. The gallery and Home Screen rendered the extension's actual SwiftUI views, configuration intent and timeline provider. A capture host supplied synthetic places, weather and app activation dates to the shared store. The refresh adapter used only the seeded weather. The expiry screenshot used an activation time 120 hours in the past. Tapping the widget opened the host and the next Home Screen capture showed the restored forecast.

Changing the medium widget to hourly displayed the six seeded hours from 09:00 to 14:00. Selecting Busan and returning to daily displayed the Busan title and the daily row on the Home Screen.

Screenshots of the Home Screen are cropped to the widget; the gallery screenshots retain the size selector and Add Widget control. To regenerate the PDF, use the screenshot-manual builder and rendering procedure in the [iOS user manual](../README.md#rebuild-and-verify) with this directory's JSON and PDF.
