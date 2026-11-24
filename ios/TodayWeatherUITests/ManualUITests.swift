import XCTest

/// The screenshots of the native user manual (IN-18 part 3, #2967; `docs/user/ios-app/`): the app launched as a user
/// opens it on a fresh install, in Korean, and walked through the journeys of the Cordova manual with real taps,
/// typing and swipes, a named screenshot at each step (`NN-name`). Run by ios/tools/manual/run-manual-capture.sh, which
/// builds the app ad hoc signed with the private server URL and Places key (read-only weather, geocode, nationwide and
/// warning GETs; no Firebase configuration, so no push token and no push request), grants location while in use at
/// Seoul City Hall, answers the tracking question and passes `TEST_RUNNER_TW_MANUAL_UI=1`; without it the test skips.
/// `TEST_RUNNER_TW_MANUAL_ADS=off` marks a build without ad units (the script's `--no-ads`).
/// The journey edits alarms only to discard them, and returns units and theme to °C and light.
@MainActor
final class ManualUITests: XCTestCase {
    let enabled = ProcessInfo.processInfo.environment["TW_MANUAL_UI"] == "1"
    /// An ad-free capture (`--no-ads`, #3122): the app was built without ad units, so no screenshot may show an ad.
    let adsOff = ProcessInfo.processInfo.environment["TW_MANUAL_ADS"] == "off"
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
        // Not over the system share sheet (querying the app's tree under it stalls the run) or on the Home Screen.
        if adsOff && !name.contains("share") && !name.contains("widgets") {
            let ad = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'native-ad-'"))
            XCTAssertFalse(ad.firstMatch.exists, "\(name): an ad-free capture shows no native ad")
        }
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

    /// The App Store screens (#3122) with Seoul saved from S01's shortcut, on the run's iPhone or iPad: hourly weather
    /// with yesterday's comparison, the expanded hourly details, daily forecasts, air quality and the Home Screen with
    /// the app's widgets. Run by
    /// `run-manual-capture.sh --no-ads --store`, which passes `TEST_RUNNER_TW_STORE_UI=1`; only ad-free.
    func testCaptureTheStoreScreens() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TW_STORE_UI"] == "1" && adsOff,
                          "run by ios/tools/manual/run-manual-capture.sh --no-ads --store")
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ko-KR)", "-AppleLocale", "ko_KR"]
        app.launch()
        wait("popup-button-0", 120)
        closePopup(0)
        let seoul = element("start-shortcut-0")
        XCTAssertTrue(seoul.waitForExistence(timeout: 30))
        XCTAssertEqual(seoul.label, "서울")
        seoul.tap()
        XCTAssertTrue(waitForTitle({ $0 == "서울" }, 90), "Hourly for Seoul")
        wait("forecast-chart")
        Thread.sleep(forTimeInterval: 3)
        shot("store-01-compare")
        tap("chart-expander")
        Thread.sleep(forTimeInterval: 1.5)
        shot("store-02-hourly")
        tap("chart-expander")
        tap("shell-tab-dailyforecast")
        wait("forecast-chart")
        shot("store-03-daily")
        tap("shell-tab-air")
        wait("air-header")
        Thread.sleep(forTimeInterval: 2)
        shot("store-04-air")

        // The Home Screen with two medium widgets (Temperature Curve over Classic Color), added through SpringBoard's
        // widget gallery as a user does after removing the simulator's default widgets from the first page; they show Seoul as the app has just loaded it. Home twice: the first press
        // returns to the page the app was opened from, the second to the first page.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 2)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 2)
        // Gallery pages: Classic Color, Morning Sky and Temperature Curve, each small then medium. A new widget goes
        // to the top of the page, so the one added last is uppermost.
        removeOtherWidgets(springboard)
        for page in [1, 5] { addWidget(springboard, galleryPage: page) }
        let done = springboard.buttons.matching(NSPredicate(format: "label == '완료' OR label == 'Done'")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 10), "Home Screen editing")
        done.tap()
        Thread.sleep(forTimeInterval: 5)
        shot("store-05-widgets")
    }

    /// Removes the other apps' widgets (the simulator's default Maps, Calendar, News and Reminders widgets) from the
    /// current Home Screen page through each widget's own menu, so the page shows the app's widgets and app icons.
    func removeOtherWidgets(_ springboard: XCUIApplication) {
        let others = springboard.icons.matching(NSPredicate(format: "value CONTAINS '위젯' OR value CONTAINS 'Widget'"))
        for _ in 0..<8 {
            guard let widget = others.allElementsBoundByIndex.first(where: { $0.frame.width > 0 && !$0.label.contains("TodayWeather") })
            else { return }
            widget.press(forDuration: 0.8)
            let remove = springboard.buttons.matching(NSPredicate(
                format: "label IN {'위젯 제거', '스택 제거', 'Remove Widget', 'Remove Stack'}")).firstMatch
            guard remove.waitForExistence(timeout: 5) else {
                let dump = XCTAttachment(string: springboard.debugDescription)
                dump.name = "springboard-no-remove"
                dump.lifetime = .keepAlways
                add(dump)
                XCTFail("no remove item for \(widget.label)")
                return
            }
            remove.tap()
            let confirm = springboard.buttons.matching(NSPredicate(format: "label == '제거' OR label == 'Remove'")).firstMatch
            if confirm.waitForExistence(timeout: 5) { confirm.tap() }
            Thread.sleep(forTimeInterval: 1.5)
        }
    }

    /// Adds the TodayWeather widget shown on `galleryPage` of SpringBoard's widget gallery to the current page.
    func addWidget(_ springboard: XCUIApplication, galleryPage: Int) {
        let edit = springboard.buttons.matching(NSPredicate(format: "label == '편집' OR label == 'Edit'")).firstMatch
        if !edit.exists {
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72)).press(forDuration: 1.6)
        }
        XCTAssertTrue(edit.waitForExistence(timeout: 10), "Home Screen editing")
        edit.tap()
        let add = springboard.buttons.matching(NSPredicate(format: "label == '위젯 추가' OR label == 'Add Widget'")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "the add-widget menu item")
        add.tap()
        // A first keyboard use may show the slide-to-type tip over the gallery.
        let tip = springboard.buttons.matching(NSPredicate(format: "label == '계속' OR label == 'Continue'")).firstMatch
        if tip.waitForExistence(timeout: 3) { tip.tap() }
        let search = springboard.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10), "the widget search field")
        search.tap()
        search.typeText("TodayWeather")
        let result = springboard.cells.matching(NSPredicate(format: "label CONTAINS 'TodayWeather'")).firstMatch
        if result.waitForExistence(timeout: 10) {
            result.tap()
        } else {
            springboard.staticTexts.matching(NSPredicate(format: "label == 'TodayWeather'")).element(boundBy: 0).tap()
        }
        Thread.sleep(forTimeInterval: 3)
        for _ in 0..<galleryPage {
            springboard.swipeLeft()
            Thread.sleep(forTimeInterval: 1.5)
        }
        let confirm = springboard.buttons.matching(NSPredicate(format: "label CONTAINS '위젯 추가' OR label CONTAINS 'Add Widget'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "the gallery's add button")
        confirm.tap()
        Thread.sleep(forTimeInterval: 3)
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

        // Saved places: search 부산 and save it with the star (#3180), switch, the same for London, edit and delete.
        tap("shell-tab-search")
        wait("places-list")
        shot("15-places")
        search("부산")
        shot("16-place-search")
        tapResult("places-prediction-0")
        XCTAssertTrue(waitForTitle { $0.contains("부산") }, "Hourly for 부산: \(title)")
        tap("forecast-star")
        wait("forecast-bell")
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
        tap("forecast-star")
        wait("forecast-bell")
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
