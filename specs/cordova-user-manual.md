# Specification: user manual for the current Cordova TodayWeather app

Consumes [intent](../intent/cordova-user-manual.md) (AC1–AC5). Reference specification: the [rewrite screen package](../docs/rewrite/README.md), checked against the current client source at the base revision.

## Outcome

A reader who has never used TodayWeather can follow the manual to set a location, read today's weather against yesterday, read daily and air information, manage saved locations, use the menu pages, change settings and set city notifications. #2877 can use the same manual as a readable parity reference.

## Deliverables

| Path | Content |
| --- | --- |
| `docs/user/cordova-app/manual.json` | Editable source in the screenshot-manual format: `title`, `scenario`, ordered `steps` with `title`, `instruction`, `screenshot`, `caption`, `expected` |
| `docs/user/cordova-app/screenshots/*.png` | Actual captures referenced by the source |
| `docs/user/cordova-app/manual.pdf` | One page per step, built from the source |
| `docs/user/cordova-app/README.md` | Entry page: scope, revision, section index with screen IDs, provenance, reproduction and limitations |
| `docs/user/cordova-app/screenshots/provenance.json` | Per image: file, SHA-256, harness capture name, screen ID; per run: revision, device, OS, screen size, locale, time zone, capture time and data source |

Existing documentation links to the entry page: `client/README.md` (mobile application) and the rewrite package README.

## Required coverage (AC1, AC3)

Each step names its screen or overlay ID from the rewrite package. Sections, in order:

| Section | User task | Spec IDs |
| --- | --- | --- |
| First launch | Read the location explanation; choose current location or search | O01, S01 |
| Hourly weather | Read the current value, the comparison with yesterday and the hourly chart; open the details | S03 |
| Daily weather | Read past and coming days | S04 |
| Air quality | Read the grade, switch pollutants, see the measuring station | S05 |
| Locations | Search and add a city, swipe between cities, edit and delete, overseas city | S02, S03 |
| Current location | Use the current position | S01, S02 |
| Menu | Open the side menu and its pages | S06 |
| Settings | Units, startup page, refresh interval, theme | S07, S08 |
| Nationwide | Nationwide weather modes and nationwide air | S10, S11 |
| Warnings and guide | Weather warnings; app guide | S12, S14 |
| Notifications | Set a daily alarm for a city | S09, O11–O14 |
| Share and exit | Share the weather; Android back to exit | O15, O16 |
| Privacy | Analytics choice and ad privacy options in the menu | S06 (added after the rewrite baseline) |

Where the current app differs from the rewrite baseline `bd6640f2`, the manual follows the current app: no purchase screen (S13 removed, #2641), no update popup (O05 removed in 1.1.0), privacy entries in the menu, Google test ads in debug builds. The entry page lists these differences.

## Content rules

- English instructions; Korean UI labels quoted with an English gloss, for example "일별날씨 (Daily)".
- Each step: one user action, the screenshot showing where to act or the result, and the expected result.
- Live data varies; the manual explains how to read values, not what the values were.
- Do not claim behavior the screenshots or source do not show. Note conditions, such as data that appears only in season.

## Capture requirements (AC2)

- Debug build of the base revision with the existing native harness (`scripts/verification/rewrite/native/`), Android emulator, Korean system locale, Asia/Seoul time zone, Seoul location.
- Production read APIs only. Push writes are answered locally by the harness; no production writes.
- Only the emulator is targeted; other connected devices are never used.
- Images are inspected for private data before inclusion. They contain only public weather, a synthetic location and test ads.

## Verification (AC4, AC5)

- The skill builder must accept the source, producing one page per step.
- pypdf text extraction confirms each step title and expected result and the page count.
- Every page is rendered and inspected for cropping, overlap, missing glyphs, unreadable labels and caption mismatch.
- Links resolve. The artifact-policy checker passes on staged content and outgoing commits. CI passes, and an independent PR review returns PASS.

## Exclusions and limits

iOS, widgets, real ad units, push delivery and native permission dialogs (the harness pre-grants permissions) are outside the captures. The manual describes system prompts in words where needed.
