# Linux native verification bundle

Source: [#2813](https://github.com/WizardFactory/TodayWeather/issues/2813), parents [S19](https://github.com/WizardFactory/TodayWeather/issues/2704) and [S20](https://github.com/WizardFactory/TodayWeather/issues/2705). AK approved proceeding with the verification plan on the selected isolated Spot host.

The two-binary Linux CI export cannot run the existing native family, widget and forecast-narrative checks. Export their release executables, frozen tracked server2 source/fixtures and identities using the existing CI upload. Keep host compilation unnecessary. This is one reviewed main-integration unit; all actual production actions, provider requests, device sends, traffic mirroring, final-state copies and #2724 quota measurement remain excluded.

Acceptance: AC1 complete source-bound static Linux bundle and fail-closed validation; AC2 actual owned-host native/widget/narrative execution with unchanged scope limits; AC3 exact placement and usable operator documentation. A tooling-only increment does not create an eligible previous full backend release. The previous bf3f532a lacks narrative and remains blocked. No product source, Cargo dependency or runtime behavior change is intended.
