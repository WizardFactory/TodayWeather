import XCTest

/// The screenshots of the native user manual (IN-18 part 3, #2967; `docs/user/ios-app/`): the app launched as a user
/// opens it on a fresh install, in Korean, and walked through the journeys of the Cordova manual with real taps,
/// typing and swipes, a named screenshot at each step (`NN-name`). Run by ios/tools/manual/run-manual-capture.sh, which
/// builds the app ad hoc signed with the private server URL and Places key (read-only weather, geocode, nationwide and
/// warning GETs; no Firebase configuration, so no push token and no push request), grants location while in use at
/// Seoul City Hall, answers the tracking question and passes `TEST_RUNNER_TW_MANUAL_UI=1`; without it the test skips.
/// The journey edits alarms only to discard them, and returns units and theme to °C and light.
@MainActor
final class ManualUITests: XCTestCase {
    let enabled = ProcessInfo.processInfo.environment["TW_MANUAL_UI"] == "1"
    var app: XCUIApplication!

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    func tap(_ identifier: String, _ seconds: TimeInterval = 30) {
        let e = element(identifier)
        XCTAssertTrue(e.waitForExistence(timeout: seconds), "\(identifier)")
        e.tap()
        Thread.sleep(forTimeInterval: 1)
    }

    func wait(_ identifier: String, _ seconds: TimeInterval = 60) {
        XCTAssertTrue(element(identifier).waitForExistence(timeout: seconds), "\(identifier)")
        Thread.sleep(forTimeInterval: 1.5)
    }

    func shot(_ name: String) {
        Thread.sleep(forTimeInterval: 0.8)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    var title: String {
        let bar = element("shell-title")
        guard bar.exists else { return "" }
        return bar.staticTexts.allElementsBoundByIndex.map(\.label).first { !$0.isEmpty } ?? bar.label
    }

    func waitForTitle(_ matches: (String) -> Bool, _ seconds: TimeInterval = 60) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if matches(title) { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    /// A result tapped as a user does: with the keyboard up the first tap only closes it.
    func tapResult(_ identifier: String) {
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            tap(identifier)
            let end = Date().addingTimeInterval(5)
            while keyboard.exists && Date() < end { Thread.sleep(forTimeInterval: 0.2) }
        }
        tap(identifier)
    }

    /// Scrolls the page up until `identifier` is hittable (at most 8 swipes).
    func reveal(_ identifier: String) {
        let e = element(identifier)
        XCTAssertTrue(e.waitForExistence(timeout: 30), identifier)
        for _ in 0..<8 where !e.isHittable { app.swipeUp(velocity: .slow) }
        Thread.sleep(forTimeInterval: 1)
    }

    /// UMP's IDFA explainer and the system's tracking prompt, when they show over the first tab (the simulator's
    /// tracking answer is not always taken from its settings): Continue, then "Ask App Not to Track".
    func dismissConsent() {
        let next = app.buttons.matching(identifier: "Continue").firstMatch
        guard next.waitForExistence(timeout: 8) else { return }
        next.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let ask = springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Not to Track' OR label CONTAINS '추적 금지'")).firstMatch
        if ask.waitForExistence(timeout: 10) { ask.tap() }
        Thread.sleep(forTimeInterval: 1.5)
    }

    /// Taps `identifier` until `done` holds (at most three taps): a tap while a popup still animates can be lost.
    func tap(_ identifier: String, until done: () -> Bool) {
        let e = element(identifier)
        XCTAssertTrue(e.waitForExistence(timeout: 30), "\(identifier)")
        Thread.sleep(forTimeInterval: 0.8)
        for _ in 0..<3 where !done() {
            if e.exists { e.tap() }
            Thread.sleep(forTimeInterval: 1.5)
        }
        XCTAssertTrue(done(), "after tapping \(identifier)")
    }

    func closePopup(_ index: Int) {
        tap("popup-button-\(index)", until: { !element("popup").exists })
    }

    /// Back from the settings pages to the tabs (S08, then S07 when it is under it).
    func settingsBack() {
        for _ in 0..<4 where element("settings-back").exists {
            if element("settings-back").isHittable { element("settings-back").tap() }
            Thread.sleep(forTimeInterval: 1.2)
        }
        XCTAssertFalse(element("settings-back").exists, "back to the tabs")
    }

    func openMenu() {
        tap("shell-menu-button", until: { element("shell-menu-back").isHittable })
        Thread.sleep(forTimeInterval: 0.5)
    }

    func search(_ word: String) {
        tap("shell-tab-search")
        let input = element("places-input")
        XCTAssertTrue(input.waitForExistence(timeout: 30))
        input.tap()
        input.typeText(word)
        Thread.sleep(forTimeInterval: 3)
        // The keyboard's Done closes it, so the results under it can be seen and tapped.
        input.typeText("\n")
        Thread.sleep(forTimeInterval: 1.5)
    }

    /// From the menu: the temperature unit's list, the choice, back to the tabs.
    func temperature(_ value: String, shoot: Bool) {
        openMenu()
        tap("shell-menu-units")
        if shoot { shot("27-units") }
        tap("settings-row-temperatureUnit")
        if shoot { shot("28-temperature") }
        tap("settings-row-\(value)")
        settingsBack()
    }

    func theme(_ value: String, shoot: Bool) {
        openMenu()
        tap("shell-menu-theme")
        if shoot { shot("32-theme") }
        tap("settings-row-\(value)")
        settingsBack()
    }

    func testCaptureTheManual() throws {
        try XCTSkipUnless(enabled, "run by ios/tools/manual/run-manual-capture.sh")
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ko-KR)", "-AppleLocale", "ko_KR"]
        app.launch()

        // First launch: O01, S01, the current position.
        wait("popup-button-0", 120)
        shot("01-access-notice")
        closePopup(0)
        shot("02-start")
        tap("start-location")
        XCTAssertTrue(waitForTitle({ !$0.isEmpty }, 90), "Hourly for the current position")
        dismissConsent()
        wait("forecast-chart")
        Thread.sleep(forTimeInterval: 3)
        shot("03-current-location")

        // Hourly and its chart.
        app.swipeUp(velocity: .slow)
        shot("04-hourly")
        // Back to the top, so the chart shows with its detail rows.
        app.swipeDown(velocity: .slow)
        app.swipeDown(velocity: .slow)
        Thread.sleep(forTimeInterval: 1)
        tap("chart-expander")
        shot("05-hourly-expanded")
        element("forecast-chart").swipeRight()
        Thread.sleep(forTimeInterval: 1.5)
        shot("06-hourly-past")
        element("forecast-chart").swipeLeft()
        element("forecast-chart").swipeLeft()
        Thread.sleep(forTimeInterval: 1.5)
        shot("07-hourly-future")
        tap("chart-expander")

        // Daily.
        tap("shell-tab-dailyforecast")
        wait("forecast-chart")
        shot("08-daily")
        element("forecast-chart").swipeRight()
        Thread.sleep(forTimeInterval: 1.5)
        shot("09-daily-past")
        element("forecast-chart").swipeLeft()
        element("forecast-chart").swipeLeft()
        Thread.sleep(forTimeInterval: 1.5)
        shot("10-daily-future")

        // Air: the summary, a pollutant, the stations.
        tap("shell-tab-air")
        wait("air-header")
        shot("11-air")
        reveal("air-code-pm25")
        tap("air-code-pm25")
        shot("12-air-pm25")
        reveal("air-stations")
        shot("13-stations")
        // A place near several stations: the second one's values.
        if element("air-station-1").exists {
            element("air-station-1").tap()
            shot("14-station-selected")
        }

        // Saved places: search and add 부산, switch, add London, edit and delete.
        tap("shell-tab-search")
        wait("places-list")
        shot("15-places")
        search("부산")
        shot("16-place-search")
        tapResult("places-prediction-0")
        XCTAssertTrue(waitForTitle { $0.contains("부산") }, "Hourly for 부산: \(title)")
        Thread.sleep(forTimeInterval: 3)
        shot("17-busan")
        let busan = title
        element("forecast-header").swipeRight()
        XCTAssertTrue(waitForTitle({ $0 != busan }, 30), "swiped to the current position")
        Thread.sleep(forTimeInterval: 2)
        shot("18-switch")
        search("London")
        tapResult("places-prediction-0")
        XCTAssertTrue(waitForTitle { $0 == "London" || $0 == "런던" }, "Hourly for London: \(title)")
        Thread.sleep(forTimeInterval: 3)
        shot("19-london")
        tap("shell-tab-search")
        wait("places-list")
        tap("places-mode")
        shot("20-edit-places")
        tap("places-delete-2")
        Thread.sleep(forTimeInterval: 1)
        shot("21-place-deleted")
        tap("places-mode")

        // Alarms of a place: S09, the picker, leaving without saving.
        tap("places-name-1")
        wait("forecast-bell")
        tap("forecast-bell")
        wait("alarms-page")
        shot("22-alarms")
        tap("alarms-row-0")
        wait("picker")
        shot("23-time-picker")
        tap("picker-close")
        tap("alarms-back")
        wait("popup")
        shot("24-alarm-confirmation")
        closePopup(0)
        if element("alarms-page").exists, element("alarms-back").exists { tap("alarms-back") }
        if element("popup-button-0").exists { tap("popup-button-0") }

        // Menu, units, start screen, refresh, theme.
        openMenu()
        shot("26-menu")
        tap("shell-menu-back")
        temperature("F", shoot: true)
        tap("shell-tab-forecast")
        wait("forecast-header")
        Thread.sleep(forTimeInterval: 3)
        shot("29-fahrenheit")
        temperature("C", shoot: false)
        openMenu()
        tap("shell-menu-startupPage")
        shot("30-startup-page")
        settingsBack()
        openMenu()
        tap("shell-menu-refreshInterval")
        shot("31-refresh")
        settingsBack()
        theme("dark", shoot: true)
        tap("shell-tab-forecast")
        Thread.sleep(forTimeInterval: 3)
        shot("33-dark-weather")
        theme("photo", shoot: false)
        tap("shell-tab-forecast")
        Thread.sleep(forTimeInterval: 4)
        shot("34-photo-theme")
        theme("light", shoot: false)

        // Nationwide pages and warnings.
        openMenu()
        tap("shell-menu-specialWeather")
        wait("nation-back")
        Thread.sleep(forTimeInterval: 3)
        shot("35-warnings")
        tap("nation-back")
        openMenu()
        tap("shell-menu-nationalWeather")
        wait("nation-back")
        let loading = element("nation-loading")
        var end = Date().addingTimeInterval(60)
        while loading.exists && Date() < end { Thread.sleep(forTimeInterval: 0.5) }
        shot("36-national-weather")
        tap("nation-mode-2")
        shot("37-national-wind")
        tap("nation-back")
        openMenu()
        tap("shell-menu-nationalAir")
        wait("nation-back")
        end = Date().addingTimeInterval(60)
        while loading.exists && Date() < end { Thread.sleep(forTimeInterval: 0.5) }
        shot("38-national-air")
        tap("nation-back")

        // About, usage statistics (declined), advertising privacy.
        openMenu()
        app.swipeUp(velocity: .slow)
        tap("shell-menu-about")
        wait("popup")
        shot("39-about")
        closePopup(0)
        openMenu()
        app.swipeUp(velocity: .slow)
        tap("shell-menu-analytics")
        wait("popup")
        shot("40-analytics")
        closePopup(0)
        tap("shell-menu-adPrivacy")
        Thread.sleep(forTimeInterval: 3)
        shot("41-ad-privacy")
        if element("popup-button-0").exists { tap("popup-button-0") }
        if element("shell-menu-back").exists { tap("shell-menu-back") }

        // Share from Hourly: the system share sheet, closed without sending.
        tap("shell-tab-forecast")
        wait("forecast-share")
        tap("forecast-share")
        Thread.sleep(forTimeInterval: 3)
        shot("42-share-sheet")
    }
}
