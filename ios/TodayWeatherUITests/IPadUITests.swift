import XCTest

/// IN-18 AC4 (#2967) on the iPad simulator itself: the app launched as a user opens it, at the largest decided text
/// size (`xxxLarge`, Dynamic Type as decided on #2948), walked through every screen and the main dialogs with real taps,
/// and the device turned between portrait and landscape on each (`XCUIDevice.orientation`, the rotation `IPadFitTests`
/// cannot do in the test host). In each state and orientation every element with an identifier that shows in the app's
/// window lies inside it across its width (the rows that scroll sideways excepted, as in `IPadFitTests`) and from its
/// top, and dialogs whole; a screenshot of each is attached.
///
/// Run by ios/tools/ipad/run-ipad-check.sh, which builds the app ad hoc signed with the local fixture server
/// (tools/ipad/fixture_server.py: weather, geocode, nation and warnings from the captured answers), installs it fresh,
/// answers the tracking question in the simulator's settings and passes `TEST_RUNNER_TW_IPAD_UI=1`; without it (CI, the
/// scheme's own test action) the test skips.
@MainActor
final class IPadUITests: XCTestCase {
    let enabled = ProcessInfo.processInfo.environment["TW_IPAD_UI"] == "1"
    var app: XCUIApplication!
    var checked: [String] = []

    static let sideways = ["air-code-", "air-station-", "nation-tab-"]
    static let dialogs = ["popup", "picker"]

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    func tap(_ identifier: String, _ seconds: TimeInterval = 30) {
        let e = element(identifier)
        XCTAssertTrue(e.waitForExistence(timeout: seconds), "\(identifier)")
        e.tap()
        Thread.sleep(forTimeInterval: 0.8)
    }

    func wait(_ identifier: String, _ seconds: TimeInterval = 30) {
        XCTAssertTrue(element(identifier).waitForExistence(timeout: seconds), "\(identifier)")
        Thread.sleep(forTimeInterval: 0.8)
    }

    /// The state checked in portrait, then turned to landscape, checked, and turned back.
    func check(_ state: String) throws {
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft, .portrait] {
            if XCUIDevice.shared.orientation != orientation {
                XCUIDevice.shared.orientation = orientation
                Thread.sleep(forTimeInterval: 1.5)
            }
            let name = "\(state)-\(orientation == .portrait ? "portrait" : "landscape")"
            try inside(name)
            if !checked.contains(name) { checked.append(name) }
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
    }

    /// Every element with an identifier that shows in the window is inside it (see the class's note).
    func inside(_ name: String) throws {
        let snapshot = try app.snapshot()
        let window = app.windows.firstMatch.frame
        var seen = 0
        var queue = [snapshot]
        while let node = queue.popLast() {
            queue += node.children
            let id = node.identifier, frame = node.frame
            guard !id.isEmpty, frame.width > 0, frame.height > 0, frame.intersects(window) else { continue }
            seen += 1
            if !Self.sideways.contains(where: id.hasPrefix) {
                XCTAssertTrue(frame.minX >= window.minX - 0.5 && frame.maxX <= window.maxX + 0.5,
                              "\(name): \(id) \(frame) across the window \(window)")
            }
            XCTAssertTrue(frame.minY >= window.minY - 0.5, "\(name): \(id) \(frame) below the window's top \(window)")
            if Self.dialogs.contains(where: { id == $0 || id.hasPrefix($0 + "-") }) {
                XCTAssertTrue(frame.maxY <= window.maxY + 0.5, "\(name): \(id) \(frame) above the window's bottom \(window)")
            }
        }
        XCTAssertGreaterThan(seen, 0, "\(name): elements")
    }

    /// UMP's IDFA explainer and the system's tracking prompt, when they show over the first tab (the simulator's
    /// tracking answer is not always taken from its settings): Continue, then "Ask App Not to Track".
    func dismissConsent() {
        let next = app.buttons["Continue"]
        guard next.waitForExistence(timeout: 8) else { return }
        next.tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let ask = springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Not to Track' OR label CONTAINS '추적 금지'")).firstMatch
        if ask.waitForExistence(timeout: 10) { ask.tap() }
        Thread.sleep(forTimeInterval: 1.5)
    }

    /// A popup's button: a tap while the popup still settles can be lost, so it is tapped again (at most three times)
    /// until the popup has closed.
    func tapPopup(_ index: Int) {
        let popup = element("popup")
        XCTAssertTrue(popup.waitForExistence(timeout: 30), "popup")
        Thread.sleep(forTimeInterval: 0.8)
        for _ in 0..<3 where popup.exists {
            let button = element("popup-button-\(index)")
            if button.exists { button.tap() }
            Thread.sleep(forTimeInterval: 1.5)
        }
        XCTAssertFalse(popup.exists, "popup closed by its button \(index)")
    }

    /// Taps `identifier` until `done` holds (at most three taps): a tap while a popup still animates in can be lost.
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

    func openMenu() {
        tap("shell-menu-button", until: { element("shell-menu-back").exists && element("shell-menu-units").exists })
        Thread.sleep(forTimeInterval: 0.6)
    }

    func testEveryScreenTurnsAtTheLargestTextSize() throws {
        try XCTSkipUnless(enabled, "run by ios/tools/ipad/run-ipad-check.sh")
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "an iPad simulator")
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXXXL",
                                "-AppleLanguages", "(ko-KR)", "-AppleLocale", "ko_KR"]
        app.launch()
        // O01 over S01, S01, then a shortcut to Hourly.
        wait("popup-button-0", 120)
        try check("O01")
        tapPopup(0)
        try check("S01")
        tap("start-shortcut-0")
        wait("forecast-header", 60)
        dismissConsent()
        try check("S03")
        tap("shell-tab-dailyforecast")
        wait("forecast-header")
        try check("S04")
        tap("shell-tab-air")
        wait("air-header")
        try check("S05")
        tap("shell-tab-search")
        wait("places-list")
        try check("S02")
        tap("places-mode")
        try check("S02-edit")
        tap("places-mode")
        // S09 from Hourly's bell, O14 on the add row, O12 for the unsaved defaults, then Save.
        tap("shell-tab-forecast")
        tap("forecast-bell")
        wait("alarms-page")
        try check("S09")
        tap("alarms-add", until: { element("picker").exists })
        try check("O14")
        tap("picker-close", until: { !element("picker").exists })
        tap("alarms-back", until: { element("popup").exists })
        try check("O12")
        tapPopup(1)
        XCTAssertFalse(element("alarms-page").exists, "S09 saved and gone back")
        // The menu, S07, S08, About.
        openMenu()
        try check("S06")
        tap("shell-menu-units")
        wait("settings-row-temperatureUnit")
        try check("S07")
        tap("settings-row-temperatureUnit")
        try check("S08")
        tap("settings-back")
        tap("settings-back")
        openMenu()
        tap("shell-menu-about", until: { element("popup").exists })
        try check("O10")
        tapPopup(0)
        // S10, S11 and S12 (region KR).
        for (row, state) in [("nationalWeather", "S10"), ("nationalAir", "S11"), ("specialWeather", "S12")] {
            openMenu()
            tap("shell-menu-\(row)")
            wait("nation-back")
            let loading = element("nation-loading")
            let end = Date().addingTimeInterval(30)
            while loading.exists && Date() < end { Thread.sleep(forTimeInterval: 0.5) }
            try check(state)
            tap("nation-back")
        }
        XCTAssertEqual(checked.count, 17 * 2, "\(checked)")
    }
}
