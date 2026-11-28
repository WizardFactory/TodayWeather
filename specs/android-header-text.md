# Android header layout requirements

| Criterion | Observable result |
| --- | --- |
| AC1 | An outlined photo-theme title and a fixed-scale icon each lay out their visible string once. Repeated reference measurements reuse the activity's text measurer for matching text, style, font resolver, density and layout direction. |
| AC2 | The four rounded half-dp offsets keep their drawing order and layout-direction behavior. Weather and air headers keep platform line breaking, inline content, baselines, visual bounds, first-card height and text semantics. Summary and grade use their paragraph layout without per-line text layout or width subcomposition. |
| AC3 | Existing screenshot, text and fit tests pass at their original tolerances. Phone, tablet, foldable and split-screen checks retain navigation bounds and fit at the supported font scales. |
| AC4 | Regenerate both checked-in baseline profile files using the project's Android baseline-profile journey. |
| AC5 | On the Galaxy S21+, compare the default and photo themes with master using the documented tab-switch journey. Report raw p90 and worst tab-entry frame times for each variant. The target is a non-increasing p90 and lower worst entry frames. |

A reader with a saved place can open Daily, Air, Locations and Hourly in succession. The same content and inline air-grade face remain visible when the window narrows or fonts are enlarged. Long labels must retain the existing wrap or ellipsis behavior. Text semantics remain available to the fit tests. The ranked summary retains its existing accessibility label.
