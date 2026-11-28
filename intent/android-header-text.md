# Android header text rendering

[Issue #3236](https://github.com/WizardFactory/TodayWeather/issues/3236) follows the chart preparation change in #3239. The Android tab-switch profile attributed 11–13% of main-thread samples to text layout. Photo-theme titles built five text nodes per string to draw their outlines. The weather summary and air grade also laid out individual rows after measuring the full paragraph.

Reuse layout work while preserving what readers see and what accessibility services can inspect. The intended gain is in switching tabs, particularly when photo outlines are active. The affected surfaces include the shell title, icon glyphs, forecast and air headers, and callers that share the shell text renderer. [Tab-switch measurements](../docs/evidence/android/tab-switch-2026-11-27.md)
