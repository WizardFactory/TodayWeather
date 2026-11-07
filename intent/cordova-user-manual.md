# Intent: user manual for the current Cordova TodayWeather app

## Source and authority

AK, 2026-11-07, `/sdlc`: "기능명세를 참고하면서 스크린샷을 포함한 기존 cordova앱 사용자 메뉴얼 pdf를 제작하여 pre merge까지 우선 진행" (create a user manual PDF for the existing Cordova app, with screenshots, using the feature specification as reference, and proceed to pre-merge).

Mode: implementation, change kind non-executable (documentation). Endpoint: **pre-merge**. Authorized: scoped documentation and capture work, local builds and emulator runs, commits, push to a task branch, PR creation and updates, CI reads, independent PR review and corrections, and one progress comment on #2877. Excluded: merge, auto-merge, merge queue, store or production actions, production writes, secrets in Git, new accounts and permission changes.

## Problem

The shipped Cordova app (1.1.1, `client/`) has no user manual. The only app-wide description is the reverse-engineered `docs/rewrite/` package, which is a specification at the older baseline `bd6640f2`, not a guide for users. The Android-native rewrite (#2877) needs a readable, current picture of how the app behaves for users.

## Desired outcome

A maintained, screenshot-based user manual of the current Cordova app on Android, in `docs/user/`, with editable source, actual screenshots and a visually checked PDF.

## Acceptance criteria

- **AC1 — Coverage.** The manual explains the user tasks of the current app: first launch and location, hourly weather and its comparison with yesterday, daily weather, air quality, saved locations (search, add, edit, delete, current location), menu pages (nationwide weather and air, weather warnings, guide), settings (units, startup page, refresh, theme), city notifications, sharing and exiting, and privacy choices.
- **AC2 — Actual screenshots.** Every screenshot comes from a debug build of the PR's base revision running on an Android emulator against the production API. Push writes are intercepted, so the capture run writes nothing to production. Provenance records the revision, device, screen size, locale, capture time and harness run. Each image is inspected for private content.
- **AC3 — Consistent with the specification.** Each manual section maps to a `docs/rewrite/` screen or overlay ID and agrees with the current source. Differences from the older specification baseline are noted rather than copied.
- **AC4 — Verified PDF.** The PDF is built with the screenshot-manual skill from the editable JSON. Its text and page count are checked, and every page is rendered and visually inspected for cropping, overlap, missing glyphs and caption mismatches.
- **AC5 — Delivery.** Repository documentation links to the manual. The artifact-policy checker passes on staged and outgoing commits, CI passes, an independent reviewer from another provider returns PASS, and a merge-ready record exists with `merge_authorized: false`.

## Scope

In scope: TodayWeather on Android (Cordova 1.1.1 source at the base revision), Korean UI screenshots, English text that names the Korean UI labels, a manual entry page, capture provenance and links from existing documentation.

Out of scope: iOS screenshots, TodayAir, widgets and purchases (not in the current app), app or server code changes, real ad units, push delivery, store listings and translations of the manual.

## Constraints and assumptions

- Repository content is English (AGENTS.md); the screenshots use the Korean UI because most users see it. Labels appear as "Korean label (English meaning)".
- Live data changes; a screenshot shows the production response at capture time, not a fixed fixture.
- The native harness pre-grants permissions and cannot tap native system dialogs, so system permission prompts and the share sheet are described, not necessarily shown.
- Debug builds show Google test ads instead of real ads.

## Risks and open questions

- A scenario may fail under the Korean locale or with missing live data (for example pollen out of season). Mitigation: capture what the live service shows and state the condition in the manual.
- Private-data exposure in screenshots: the device uses only a synthetic Seoul location; no account or token appears in the UI.

## Consumers

Spec (`specs/cordova-user-manual.md`), plan (`plans/cordova-user-manual.md`), builder, PR reviewer, and #2877.
