# Investigation

Source baseline: d14da457515407873fba28c9b0291bb23ce955a3.

- client/www/js/service.push.js builds v000902 push URLs; Firebase token callback calls PUT with newToken and previous fcmToken. Default old token is null; local token changes immediately after request submission, without awaiting HTTP success. First-token missing-old-token rejection is a code-supported possibility, not a proven cause of observed 403s.
- POST /push-list uploads settings; it is not GET/list retrieval. The app reads settings from pushData2 in TwStorage. Request body is an array with category alarm/alert. Handler dispatches writes to push and AlertPush models. Per-item database errors are logged then passed to async.map as success, so HTTP 200 does not prove all writes persisted.
- PUT /push requires both truthy newToken+oldToken or newRegId+oldRegId; else 403 invalid body. It updates both collections in parallel. DELETE selects token plus optional cityIndex/id/category.
- v000902 and v000903 mount reused v000705 push handlers. Legacy POST /push handles a single alarm record.
- CloudFront push behaviors select service EC2 directly; no API Gateway/Lambda on this branch. Current selected control-plane evidence is aws-routing.json. Service-host 2026-09-20 evidence observes service mode, not the push worker deployment.
- SERVER_MODE=push starts ControllerPush and AlertPush loops; no worker starts in service mode. Alarm polls every 60 seconds for UTC pushTime, enabled and local weekday. Alert polls every 60 seconds but runs at UTC minutes 7/17/35/50; enabled time window, recent-send gates, precipitation/air state and forecast thresholds apply.
- Workers fetch SERVICE_SERVER /v000902/kma or /v000902/dsf weather. Alert state is persisted asynchronously before the provider send; not transactional delivery acknowledgement.
- fcmToken selects Firebase Admin send (todayWeather/todayAir); else iOS registrationId uses APNs, Android uses legacy GCM. Invalid FCM registration disables the affected record set. APNs callback is optimistic; provider acceptance or API success is not proof of device display.
- App notification tap selects cityIndex and emits reloadEvent; foreground emits notificationEvent.
- Monthly evidence: PUT v000902/push 18,872 requests; 16,337 HTTP 403, 1,834 HTTP 502, 694 HTTP 200, 7 disconnects. HTTP failure 96.29%. Root cause and provider delivery unverified.
