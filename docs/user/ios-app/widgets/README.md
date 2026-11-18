# Home Screen widgets

[Widget guide (Korean PDF)](manual.pdf) · [Editable steps](manual.json)

The screenshots show the WidgetKit gallery, widget settings and Home Screen on an isolated iPhone 16 simulator running iOS 26.5 in Korean. They were captured for issue #3043 on 18 November 2026. The gallery and Home Screen rendered the extension's actual SwiftUI views, configuration intent and timeline provider. A capture host supplied synthetic places, weather and app activation dates to the shared store. The refresh adapter used only the seeded weather. The expiry screenshot used an activation time 120 hours in the past. Tapping the widget opened the host and the next Home Screen capture showed the restored forecast.

Changing the medium widget to hourly displayed the six seeded hours from 09:00 to 14:00. Selecting Busan and returning to daily displayed the Busan title and the daily row on the Home Screen.

Screenshots of the Home Screen are cropped to the widget; the gallery screenshots retain the size selector and Add Widget control. To regenerate the PDF, use the screenshot-manual builder and rendering procedure in the [iOS user manual](../README.md#rebuild-and-verify) with this directory's JSON and PDF.
