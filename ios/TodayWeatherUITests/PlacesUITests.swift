import XCTest

/// UI tests of the saved places (IN-11, #2960) that need real touches: the app is launched as a user opens it and driven
/// through its accessibility elements with XCUITest's taps, typing, drags and swipes. They run from
/// ios/tools/places-ui/run-places-ui.sh, which builds the app ad hoc signed (its App Group entitlement is needed to finish
/// the start), installs it fresh, answers the tracking question in the simulator's settings (no UMP explainer over the
/// page) and passes the mode in `TEST_RUNNER_TW_PLACES_UI`; without it (CI, the scheme's own test action) they skip.
///
/// - `fixture` (#2960 AC3): a build whose server is the script's local fixture server (no Places key): 서울 from S01, 부산
///   from S02's town search; on Hourly a drag across the chart scrolls the chart and keeps the place, and a swipe on the
///   header block changes it.
/// - `production` (#2960 AC2): a build with the private server URL and Places key: 부산 and London searched with the
///   Places SDK and added, the header swiped between them, London deleted. No alarm is set, so no deletion reaches the
///   push server.
@MainActor
final class PlacesUITests: XCTestCase {
    let mode = ProcessInfo.processInfo.environment["TW_PLACES_UI"]
    var app: XCUIApplication!

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// The title of the header bar.
    var title: String {
        let bar = element("shell-title")
        guard bar.exists else { return "" }
        let texts = bar.staticTexts.allElementsBoundByIndex.map { $0.label }.filter { !$0.isEmpty }
        return texts.first ?? bar.label
    }

    func waitForTitle(_ matches: (String) -> Bool, _ seconds: TimeInterval = 60) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if element("shell-title").exists && matches(title) { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    func tap(_ identifier: String, _ seconds: TimeInterval = 60) {
        let e = element(identifier)
        XCTAssertTrue(e.waitForExistence(timeout: seconds), "\(identifier)")
        e.tap()
    }

    /// A result tapped as a user does: with the keyboard up the first tap only closes it (`OnSelectResult`), so the
    /// result is tapped again once the keyboard is gone.
    func tapResult(_ identifier: String) {
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            tap(identifier, 30)
            let end = Date().addingTimeInterval(5)
            while keyboard.exists && Date() < end { Thread.sleep(forTimeInterval: 0.2) }
        }
        tap(identifier, 30)
    }

    func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// O01 over S01 on a fresh install.
    func closeNotice() {
        tap("popup-button-0", 120)
    }

    /// S02: the word typed into the search field.
    func search(_ word: String) {
        tap("shell-tab-search")
        let input = element("places-input")
        XCTAssertTrue(input.waitForExistence(timeout: 30))
        input.tap()
        input.typeText(word)
    }

    // MARK: #2960 AC3

    func testDraggingAChartScrollsOnlyTheChart() throws {
        try XCTSkipUnless(mode == "fixture", "run by ios/tools/places-ui/run-places-ui.sh fixture")
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ko-KR)", "-AppleLocale", "ko_KR"]
        app.launch()
        closeNotice()
        tap("start-shortcut-0")
        XCTAssertTrue(waitForTitle { $0 == "서울" }, "Hourly for 서울: \(title)")
        search("부산")
        tapResult("places-town-0")
        XCTAssertTrue(waitForTitle { $0 == "부산광역시" }, "Hourly for 부산광역시: \(title)")
        let chart = element("forecast-chart")
        XCTAssertTrue(chart.waitForExistence(timeout: 30), "the hourly chart")
        Thread.sleep(forTimeInterval: 1.5)
        // Pull from the top of the active page. One new weather request and the same place in the
        // header distinguish refresh from both ordinary scrolling and a swipe to the next place.
        let counter = try XCTUnwrap(ProcessInfo.processInfo.environment["TW_FIXTURE_COUNTER"].flatMap(URL.init(string:)))
        func weatherRequests() throws -> Int {
            let data = try Data(contentsOf: counter)
            return try JSONDecoder().decode(Int.self, from: data)
        }
        let beforePull = try weatherRequests()
        let header = element("forecast-header")
        let start = header.coordinate(withNormalizedOffset: CGVector(dx: 0.26, dy: 0.45))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 420)),
                    withVelocity: .slow, thenHoldForDuration: 1)
        shot("pull-refresh-hourly")
        let afterPull = try weatherRequests()
        XCTAssertEqual(afterPull, beforePull + 1, "pulling started one weather request")
        XCTAssertEqual(title, "부산광역시", "a vertical pull keeps the selected place")

        shot("before-drag")
        let before = chart.screenshot().pngRepresentation

        // A slow drag across the chart, right to left: the chart scrolls, the place stays.
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: chart.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)),
                   withVelocity: .slow, thenHoldForDuration: 0.1)
        Thread.sleep(forTimeInterval: 1.5)
        shot("after-drag")
        XCTAssertEqual(title, "부산광역시", "a drag on the chart keeps the place")
        XCTAssertNotEqual(chart.screenshot().pngRepresentation, before, "the chart scrolled")
        // A fast swipe on the chart, both ways: still the same place.
        chart.swipeLeft()
        chart.swipeRight()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertEqual(title, "부산광역시", "a swipe on the chart keeps the place")

        // A swipe on the header block switches the place (`onSwipeLeft`: the next one, 서울 after the last).
        element("forecast-header").swipeLeft()
        XCTAssertTrue(waitForTitle({ $0 == "서울" }, 15), "the header's swipe: \(title)")
        shot("after-header-swipe")
    }

    // MARK: #2960 AC2

    func testSearchAddSwipeAndDeleteAgainstProduction() throws {
        try XCTSkipUnless(mode == "production", "run by ios/tools/places-ui/run-places-ui.sh production")
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        closeNotice()
        // 부산 from S01's search with the Places SDK.
        let start = element("start-input")
        XCTAssertTrue(start.waitForExistence(timeout: 30))
        start.tap()
        start.typeText("부산")
        tapResult("start-result-0")
        XCTAssertTrue(waitForTitle { $0.contains("부산") }, "Hourly for 부산: \(title)")
        let busan = title
        shot("busan-hourly")

        // London from S02's search with the Places SDK.
        search("London")
        tapResult("places-prediction-0")
        XCTAssertTrue(waitForTitle { $0 == "London" }, "Hourly for London: \(title)")
        shot("london-hourly")

        // The header block swiped between them.
        element("forecast-header").swipeRight()
        XCTAssertTrue(waitForTitle({ $0 == busan }, 30), "swiped back to \(busan): \(title)")
        shot("swiped-to-busan")
        element("forecast-header").swipeLeft()
        XCTAssertTrue(waitForTitle({ $0 == "London" }, 30), "swiped on to London: \(title)")

        // S02: no alarm on either place, so the delete sends nothing to the push server; London deleted in edit mode.
        tap("shell-tab-search")
        XCTAssertTrue(element("places-bell-1").waitForExistence(timeout: 30))
        XCTAssertEqual(element("places-bell-1").label, "alarm off")
        XCTAssertEqual(element("places-bell-2").label, "alarm off")
        shot("places-list")
        tap("places-mode")
        tap("places-delete-2")
        tap("places-mode")
        XCTAssertTrue(element("places-name-1").waitForExistence(timeout: 10))
        XCTAssertFalse(element("places-name-2").exists, "London is gone")
        XCTAssertEqual(element("places-name-1").label, busan)
        shot("after-delete")
    }
}
