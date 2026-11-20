import XCTest

/// Fixture-only observer timings. XCTest synchronizes with the app, so these intervals include
/// automation overhead. Use separate device traces to qualify first motion and displayed frames.
@MainActor
final class ResponsivenessUITests: XCTestCase {
    private let app = XCUIApplication()

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func timed(_ action: String, batch: Int, run: Int, perform: () -> Void, ready: () -> Bool) {
        let start = ProcessInfo.processInfo.systemUptime
        perform()
        let success = ready()
        let ms = (ProcessInfo.processInfo.systemUptime - start) * 1000
        print("TW_SAMPLE,\(batch),\(run),\(action),\(ms),\(success)")
        XCTAssertTrue(success, action)
    }

    private func openHourly(extraArguments: [String] = []) throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TW_PROFILE_FIXTURE"] == "1",
                          "Requires the isolated Release fixture build.")
        continueAfterFailure = false
        app.launchArguments = ["-AppleLanguages", "(ko-KR)", "-AppleLocale", "ko_KR"] + extraArguments
        if ProcessInfo.processInfo.environment["TW_PROFILE_TEXT"] == "large" {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXXXL"]
        }
        app.launch()
        if element("popup-button-0").exists {
            element("popup-button-0").tap()
        }
        if element("start-shortcut-0").exists {
            element("start-shortcut-0").tap()
        }
        XCTAssertTrue(element("forecast-header").waitForExistence(timeout: 30))
    }

    func testDrawerUnitsAndReturn() throws {
        try openHourly()
        let menu = element("shell-menu-button")
        let units = element("shell-menu-units")
        let temperature = element("settings-row-temperatureUnit")
        let back = element("settings-back")
        for batch in 0...2 {
            for run in 1...(batch == 0 ? 1 : 10) {
                XCTAssertTrue(menu.isHittable)
                timed("open-drawer", batch: batch, run: run, perform: { menu.tap() }) {
                    units.isHittable
                }
                timed("show-units", batch: batch, run: run, perform: { units.tap() }) {
                    temperature.isHittable && back.isHittable
                }
                timed("return-hourly", batch: batch, run: run, perform: { back.tap() }) {
                    menu.isHittable && self.element("forecast-header").exists && !back.exists
                }
            }
        }
    }

    func testNativeRelaunch() throws {
        try openHourly()
        let options = XCTMeasureOptions()
        options.iterationCount = 10
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
            app.terminate()
            app.launch()
            XCTAssertTrue(element("forecast-header").exists)
            XCTAssertTrue(element("shell-menu-button").isHittable)
        }
    }

    func testHourlyScroll() throws {
        try openHourly()
        let header = element("forecast-header")
        let initial = header.frame.midY
        let options = XCTMeasureOptions()
        options.iterationCount = 10
        measure(metrics: [XCTOSSignpostMetric.scrollDraggingMetric, XCTOSSignpostMetric.scrollDecelerationMetric],
                options: options) {
            let lower = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
            let upper = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
            lower.press(forDuration: 0.05, thenDragTo: upper, withVelocity: .fast, thenHoldForDuration: 0)
            let displaced = header.frame.midY
            XCTAssertLessThan(displaced, initial - 10)
            upper.press(forDuration: 0.05, thenDragTo: lower, withVelocity: .fast, thenHoldForDuration: 0)
            XCTAssertTrue(header.isHittable)
            XCTAssertGreaterThan(header.frame.midY, displaced + 10)
        }
    }

    func testSearchColdAndWarm() throws {
        try openHourly()
        let input = element("places-input")
        let result = element("places-town-0")
        for batch in 0...2 {
            for run in 1...(batch == 0 ? 1 : 10) {
                app.terminate()
                app.launch()
                element("shell-tab-search").tap()
                for mode in ["cold-search", "warm-search"] {
                    input.tap()
                    XCTAssertFalse(result.exists)
                    timed(mode, batch: batch, run: run, perform: { input.typeText("부산") }) {
                        input.value as? String == "부산" && result.label.contains("부산")
                    }
                    element("places-mode").tap()
                    XCTAssertFalse(result.exists)
                }
            }
        }
    }

    func testNationalPagesAndSettings() throws {
        try openHourly()
        let routes = [
            ("nationalWeather", "nation-page-nation", "nation-label-서울", "nation-back"),
            ("nationalAir", "nation-tab-pm2.5", "nation-label-서울", "nation-back"),
            ("specialWeather", "nation-warnings", "nation-card-0", "nation-back"),
            ("startupPage", "settings-list-startupPage", "settings-row-0", "settings-back"),
            ("refreshInterval", "settings-list-refreshInterval", "settings-row-0", "settings-back"),
            ("theme", "settings-list-theme", "settings-row-dark", "settings-back")
        ]
        for (row, destination, content, back) in routes {
            for batch in 0...2 {
                for run in 1...(batch == 0 ? 1 : 10) {
                    element("shell-menu-button").tap()
                    timed(row, batch: batch, run: run, perform: { element("shell-menu-" + row).tap() }) {
                        self.element(destination).exists && self.element(content).waitForExistence(timeout: 5)
                            && self.element(back).isHittable
                    }
                    timed(row + "-back", batch: batch, run: run, perform: { element(back).tap() }) {
                        !self.element(destination).exists && self.element("shell-menu-button").isHittable
                    }
                }
            }
        }
    }
}

extension ResponsivenessUITests {
    func testPrivacyAndAbout() throws {
        try openHourly()
        element("shell-menu-button").tap()
        app.swipeUp(velocity: .slow)
        let close = element("popup-button-0")
        for row in ["about", "analytics", "adPrivacy"] {
            let button = element("shell-menu-" + row)
            for batch in 0...2 {
                for run in 1...(batch == 0 ? 1 : 10) {
                    timed(row, batch: batch, run: run, perform: { button.tap() }) {
                        close.isHittable && self.element("popup").exists
                    }
                    timed(row + "-back", batch: batch, run: run, perform: { close.tap() }) {
                        !self.element("popup").exists && button.isHittable
                    }
                }
            }
        }
        let version = element("shell-menu-version")
        XCTAssertTrue(version.label.contains("2.0.0"))
        version.tap()
        XCTAssertTrue(element("shell-menu-back").isHittable)
    }

    func testAlarmPickerAndDiscard() throws {
        try openHourly()
        let bell = element("forecast-bell")
        let add = element("alarms-add")
        let close = element("picker-close")
        let value = element("picker-value-1")
        for batch in 0...2 {
            for run in 1...(batch == 0 ? 1 : 10) {
                timed("alarms", batch: batch, run: run, perform: { bell.tap() }) { add.isHittable }
                timed("picker", batch: batch, run: run, perform: { add.tap() }) { close.isHittable }
                let before = value.label
                timed("minute-step", batch: batch, run: run, perform: { element("picker-up-1").tap() }) {
                    value.label != before
                }
                timed("picker-close", batch: batch, run: run, perform: { close.tap() }) {
                    !close.exists && add.isHittable
                }
                element("alarms-back").tap()
                if element("popup-button-0").exists {
                    timed("discard", batch: batch, run: run, perform: { element("popup-button-0").tap() }) {
                        !self.element("popup").exists && bell.isHittable
                    }
                }
                XCTAssertTrue(bell.isHittable)
            }
        }
    }

    func testTabsAndShare() throws {
        try openHourly()
        let share = element("forecast-share")
        for batch in 0...2 {
            for run in 1...(batch == 0 ? 1 : 10) {
                for (tab, destination) in [("dailyforecast", "forecast-header"), ("air", "air-header"),
                                           ("search", "places-mode"), ("forecast", "forecast-header")] {
                    timed("tab-" + tab, batch: batch, run: run,
                          perform: { element("shell-tab-" + tab).tap() }) {
                        self.element("shell-tab-" + tab).isSelected && self.element(destination).exists
                    }
                }
                let sheet = element("ActivityListView")
                timed("share", batch: batch, run: run, perform: { share.tap() }) {
                    let shown = sheet.waitForExistence(timeout: 5)
                    return shown
                }
                let outside = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.94))
                XCTAssertFalse(sheet.frame.contains(outside.screenPoint), "the dismiss tap must fall outside the popover")
                timed("dismiss-share", batch: batch, run: run, perform: { outside.tap() }) {
                    sheet.waitForNonExistence(timeout: 3) && share.isHittable
                }
            }
        }
    }
}

extension ResponsivenessUITests {
    func testFixtureFailuresAndRecovery() throws {
        let env = ProcessInfo.processInfo.environment
        try XCTSkipUnless(env["TW_PROFILE_FIXTURE"] == "1" && env["TW_PROFILE_DATA"] != nil, "local fixture control required")
        let dir = try XCTUnwrap(env["TW_PROFILE_DATA"].map { URL(fileURLWithPath: $0) })
        let controls = dir.appendingPathComponent("controls.json")
        let ledger = dir.appendingPathComponent("requests.jsonl")
        func set(_ config: [String: Any]) throws {
            try JSONSerialization.data(withJSONObject: config).write(to: controls, options: .atomic)
        }
        func requests(_ route: String) throws -> [[String: Any]] {
            try String(contentsOf: ledger, encoding: .utf8).split(separator: "\n").compactMap { line in
                let entry = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
                return entry?["route"] as? String == route ? entry : nil
            }
        }
        try set([:])
        defer { try? set([:]) }
        try openHourly()
        for mode in ["normal", "failed", "empty"] {
            try set(["special": mode, "delay_ms": 750])
            let count = try requests("special").count
            element("shell-menu-button").tap()
            element("shell-menu-specialWeather").tap()
            XCTAssertTrue(element("nation-warnings").exists)
            let deadline = Date().addingTimeInterval(5)
            while try requests("special").count == count && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.02)
            }
            let seen = try requests("special")
            XCTAssertEqual(seen.count, count + 1)
            XCTAssertEqual(seen.last?["status"] as? Int, mode == "failed" ? 503 : 200)
            if mode == "normal" { XCTAssertTrue(element("nation-card-0").waitForExistence(timeout: 3)) }
            else { XCTAssertFalse(element("nation-card-0").exists) }
            element("nation-back").tap()
            XCTAssertTrue(element("shell-menu-button").isHittable)
        }
        for mode in ["failed", "disconnect"] {
            try set(["weather": mode])
            let before = try requests("weather").count
            element("shell-tab-forecast").tap()
            let retry = element("popup-button-1")
            XCTAssertTrue(retry.waitForExistence(timeout: 30))
            let failed = try requests("weather")
            XCTAssertGreaterThan(failed.count, before)
            XCTAssertEqual(failed.last?["status"] as? Int, mode == "failed" ? 503 : 0)
            try set([:])
            retry.tap()
            let deadline = Date().addingTimeInterval(10)
            while try requests("weather").count == failed.count && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.02)
            }
            let recovered = try requests("weather")
            XCTAssertEqual(recovered.count, failed.count + 1)
            XCTAssertEqual(recovered.last?["status"] as? Int, 200)
            XCTAssertFalse(element("popup").exists)
            XCTAssertTrue(element("forecast-header").isHittable)
        }
    }
}

extension ResponsivenessUITests {
    /// Matched swipes for the supplemental CADisplayLink capture. Route names and the runner's
    /// uptime align input windows with the app's UITouch timestamps.
    func testScrollSurfaces() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TW_SCROLL_MATRIX"] == "1",
                          "Requires a saved-list and density seed")
        try openHourly()
        func gesture(_ name: String, _ action: () -> Void) {
            let start = ProcessInfo.processInfo.systemUptime
            action()
            print("TW_GESTURE,\(name),\(start),\(ProcessInfo.processInfo.systemUptime)")
        }
        func vertical(_ name: String, bottom: CGFloat = 0.77, top: CGFloat = 0.43) {
            let low = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: bottom))
            let high = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: top))
            gesture(name + "-up") {
                low.press(forDuration: 0.1, thenDragTo: high, withVelocity: .fast, thenHoldForDuration: 0)
            }
            gesture(name + "-reverse") {
                high.press(forDuration: 0.1, thenDragTo: low, withVelocity: .fast, thenHoldForDuration: 0)
            }
        }
        for tab in ["forecast", "dailyforecast"] {
            element("shell-tab-" + tab).tap()
            XCTAssertTrue(element("shell-tab-" + tab).isSelected)
            vertical(tab)
            let chart = element("forecast-chart")
            if !chart.exists && ProcessInfo.processInfo.environment["TW_PROFILE_SIZE"] == "sparse" {
                print("TW_UNAVAILABLE,\(tab)-chart,no chart rendered for sparse forecast")
                continue
            }
            if !chart.isHittable { app.swipeUp(velocity: .slow) }
            XCTAssertTrue(chart.isHittable)
            let title = element("shell-title").label
            gesture(tab + "-chart-left") { chart.swipeLeft() }
            gesture(tab + "-chart-right") { chart.swipeRight() }
            XCTAssertEqual(element("shell-title").label, title)
        }
        element("shell-tab-air").tap()
        XCTAssertTrue(element("air-header").exists)
        vertical("air")
        let cell = element("air-station-0")
        for _ in 0..<7 where !cell.isHittable { app.swipeUp() }
        XCTAssertTrue(cell.isHittable)
        let y = cell.frame.midY / app.frame.height
        let left = app.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: y))
        let right = app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: y))
        gesture("stations-left") {
            right.press(forDuration: 0.08, thenDragTo: left, withVelocity: .fast, thenHoldForDuration: 0)
        }
        gesture("stations-right") {
            left.press(forDuration: 0.08, thenDragTo: right, withVelocity: .fast, thenHoldForDuration: 0)
        }

        element("shell-tab-search").tap()
        XCTAssertTrue(element("places-list").exists)
        vertical("cities")
        element("places-input").tap()
        element("places-input").typeText("부산")
        XCTAssertTrue(element("places-town-0").label.contains("부산"))
        let keyboard = app.keyboards.firstMatch
        let bottom = keyboard.exists ? min(0.77, (keyboard.frame.minY - 20) / app.frame.height) : 0.77
        vertical("search-results", bottom: bottom, top: 0.31)
        element("places-mode").tap()
        XCTAssertFalse(element("places-town-0").exists)
        element("shell-menu-button").tap()
        element("shell-menu-specialWeather").tap()
        XCTAssertTrue(element("nation-card-0").waitForExistence(timeout: 5))
        vertical("warnings")
        element("nation-back").tap()
        XCTAssertTrue(element("places-mode").isHittable)
    }
}

extension ResponsivenessUITests {
    func testChartPans() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TW_SCROLL_MATRIX"] == "1", "requires dense forecast data")
        try openHourly()
        for tab in ["forecast", "dailyforecast"] {
            element("shell-tab-" + tab).tap()
            let chart = element("forecast-chart")
            XCTAssertTrue(chart.isHittable)
            let title = element("shell-title").label
            for batch in 0...2 {
                for run in 1...(batch == 0 ? 1 : 10) {
                    let initial = chart.screenshot().pngRepresentation
                    for direction in ["left", "right"] {
                        let start = ProcessInfo.processInfo.systemUptime
                        if direction == "left" { chart.swipeLeft() } else { chart.swipeRight() }
                        let end = ProcessInfo.processInfo.systemUptime
                        print("TW_GESTURE,\(tab)-\(direction)-\(batch)-\(run),\(start),\(end)")
                        XCTAssertEqual(element("shell-title").label, title)
                        if direction == "left" { XCTAssertNotEqual(chart.screenshot().pngRepresentation, initial) }
                    }
                }
            }
        }
    }
}

#if !targetEnvironment(simulator)
extension ResponsivenessUITests {
    private func deviceScroll(_ target: String, extraArguments: [String] = []) throws {
        try openHourly(extraArguments: extraArguments)
        let options = XCTMeasureOptions()
        options.iterationCount = 10
        let chart = element("forecast-chart")
        let header = element("forecast-header")
        let title = element("shell-title").label
        if target == "dailyforecast" { element("shell-tab-dailyforecast").tap() }
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            let start = Date().timeIntervalSince1970
            if target == "vertical" {
                let initial = header.frame.midY
                let lower = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
                let upper = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
                lower.press(forDuration: 0.05, thenDragTo: upper, withVelocity: .fast, thenHoldForDuration: 0)
                let moved = header.frame.midY
                XCTAssertLessThan(moved, initial - 10)
                upper.press(forDuration: 0.05, thenDragTo: lower, withVelocity: .fast, thenHoldForDuration: 0)
                XCTAssertGreaterThan(header.frame.midY, moved + 10)
            } else {
                XCTAssertTrue(chart.isHittable)
                let before = chart.screenshot().pngRepresentation
                chart.swipeLeft()
                let moved = chart.screenshot().pngRepresentation
                XCTAssertNotEqual(before, moved)
                chart.swipeRight()
                XCTAssertNotEqual(chart.screenshot().pngRepresentation, moved)
            }
            XCTAssertEqual(element("shell-title").label, title)
            print("TW_SCROLL_PAIR," + target + "," + String(start) + "," + String(Date().timeIntervalSince1970))
        }
    }
    func testInjectedHourlyChart() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TW_PROFILE_INJECTION_CONTROL"] == "1",
                          "Requires the isolated ProfileWindow build.")
        try deviceScroll("forecast", extraArguments: ["-TWInjectedHitch"])
    }

    func testDeviceHourlyChart() throws { try deviceScroll("forecast") }
    func testDeviceDailyChart() throws { try deviceScroll("dailyforecast") }
    func testDeviceVertical() throws { try deviceScroll("vertical") }
}
#endif
