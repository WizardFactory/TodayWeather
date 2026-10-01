# Production PWA adoption contract — issue2649

Reviewed 2026-10-01. [Shared spec](design-system.md) owns token values and chart rules. This adds production integration and maps the issue's18completion criteria. [Intent](../intent/pwa-design-adoption.md), [plan](../plans/pwa-design-adoption.md).

## Behavior

Display key `tw.web.v1.display`: version1, appearance(system/light/dark), heroStyle(sky/plain/classic), textScale(.9/1/1.15/1.3), chartExpanded(boolean), motion(boolean defaultfalse). Validate each field independently. Migration maps light→light/plain, dark→dark/plain, photo→light/sky, classic→light/classic; no saved legacy value defaults system/sky. Separate key wins over legacy settings rewrites. Settings changes dual-write legacy theme with current resolved appearance (sky→photo, classic→classic, plain→light/dark), including OS changes for system. Storage unavailable retains in-memory preferences and reports persistence failure. Clear removes both keys; export/import includes validated display data while accepting old backups. External-tab changes update both state systems.

Root font size scales browser default with textScale and retains inherited browser text preferences; information roles keep13px-equivalent floors at.9, micro12. Responsive tokens select mobile(width<768, or coarse andheight<540), tablet(coarse/nohover,width≥768,height≥540), desktop(fine,width≥768). Layout breakpoints768/1024/1440/1600 do not select input tiers. Hero resolves approved clamp before application scale; preferred viewport dimension also scales. Font is self-hosted Vite-hashed Pretendard Variable withOFL; no runtime external font request. Generated CSS/TS/contrast JSON under ignored web/src/generated; hooks beforerootdev/typecheck/test/build and webdev/build.

Weather route preserves tabs/navigation but main weather routes always show hero→hourly→daily→air→details in DOM/mobile order. Tabs use valid selected semantics and keyboard support. Air view remains separate. Hours: all normalized hourly rows, chronological source-wall-time coordinates, previous day matched by date+time minus24hours, no index-based shift. Current point replaces/inserts observation only within hourly extent, ydomain includes both lines+observation, null segments restart. Preserve13+px values, avoid close yesterday collisions, legend inheader. Defaultscroll to column preceding now; no pageoverflow. Daytitle→hour→icon→probability/amount→plot; persisted wind/humidity expander shows numeric vec-derived arrow and text. Tables share model/units/rainbasis.

Daily: all dates APIreturns, sorted/deduplicated, pastprobability hidden, oneiconwhenAM/PMequal; separateAM/PMlabelswhenunequal. Shared min/max scale includes current observation; coolbottom→warmtop gradient with border. Missingrange no bar. Current marker todaywithinplottedrange; domain extends to observed value. Initiallytodaythird visible column when overflow, allcolumnsfromfirstwhenfit. Keyboard arrows/Home/End and live readout; table has identicaldates/extrema/rainunits/currentdata.

Use semantic/component color, spacing/radius/elevation/layer tokens; no product hex literals or pxfonts. Preserve sixgrade legacyhues withtokenizededge/text. Sky derives fromcondition/daynight; fog/dusticons explicit. Skycontrasttext≥4.5atbothstops. Motiondefaultoff and disabledunderreducedmotion. Native dialog replacesconfirm withfocuscontainment/Escape/restore; skeletonsstatus, air charttable, radiogroupssemantic. Delete nameddeadselectors. Missinglifeindicesomitted; no issue2650backendchanges.

## Acceptance mapping

| ID | Observable check |
|---|---|
| AC1 | Clean lockfile install, typecheck/test/build, deterministic generator twice |
| AC2 | Existing token requiredroles/tiers/floors/contrast suite stays passing |
| AC3 | Source lint no hex or px font in productCSS/TSX outsidegenerated |
| AC4 | Chromium/WebKit7languages light/dark root1/1.5/2layout matrix |
| AC5 | Computed body17mobile/18tablet/16desktop atissueinputviewports |
| AC6 | Chart labels/legend/scroll/current/sharedtables at320/402width |
| AC7 | Actual responsefixtures alignyesterday/currentdomain/past/rainpriority |
| AC8 | Legacydisplaymigration and separate-keyrollbackroundtrip |
| AC9 | Built hashed woff2+CSSreference |
| AC10 | Axe no serious/critical weather/air/settings bothappearances |
| AC11 | Selectedko/de3sizes light/dark weather/air/settingsbaselines |
| AC12 | 130%rootfactor,persistence/reload |
| AC13 | iOS physical Cordova/PWA 1.0 and nearest approved 135.3% system step; Android retry then AK-authorized isolated Android emulator Cordova/PWA 1.0/1.3 fallback, with distinct provenance |
| AC14 | DailyverticalD8gradientcoolminimum→warmmaximum |
| AC15 | Allhourlyrows andvecdirectionarrow |
| AC16 | MobileDOMhero/hourly/daily/air/details |
| AC17 | Nowindow.confirm and nameddeadCSSselectors |
| AC18 | Firstpaintsystemattributes/metacolor+maintaineddocuments |

Browser root enlargement is text simulation, not OS Dynamic Type or actual pinch zoom. AC13 uses physical iOS evidence and the explicitly authorized Android emulator fallback after failed physical reconnection; retain the failed physical attempt and do not infer physical Android behavior. Public API/unit/provider behavior stays unchanged; query normalization revision renews to avoid old normalized snapshots. Deployment is separately authorized.
