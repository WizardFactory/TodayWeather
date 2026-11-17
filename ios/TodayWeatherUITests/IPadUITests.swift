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
    /// States that show over the open side menu (S06 and About over it); in every other state the menu is closed.
    static let menuOpenStates: Set<String> = ["S06", "O10"]

    func check(_ state: String) throws {
        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft, .portrait] {
            if XCUIDevice.shared.orientation != orientation {
                XCUIDevice.shared.orientation = orientation
                Thread.sleep(forTimeInterval: 1.5)
            }
            let name = "\(state)-\(orientation == .portrait ? "portrait" : "landscape")"
            try inside(name, menuOpen: Self.menuOpenStates.contains(state))
            if !checked.contains(name) { checked.append(name) }
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
    }

    /// The oracle for one identified element in `window` (as `IPadFitTests.problems`, CODEX-IN18P1-1 and -5): whether it
    /// counts as content shown in the window, and what is wrong with it.
    static func problems(id: String, frame: CGRect, window: CGRect, menuOpen: Bool) -> (checked: Bool, problems: [String]) {
        if drawer(id) && !menuOpen {
            return (false, frame.maxX <= window.minX + 0.5 ? [] : ["not closed left of the window"])
        }
        let dialog = dialogs.contains(where: { id == $0 || id.hasPrefix($0 + "-") })
        if !dialog && (frame.maxY <= window.minY || frame.minY >= window.maxY) { return (false, []) }
        var found: [String] = []
        if !sideways.contains(where: id.hasPrefix) && !(frame.minX >= window.minX - 0.5 && frame.maxX <= window.maxX + 0.5) {
            found.append("across the window")
        }
        if frame.minY < window.minY - 0.5 { found.append("below the window's top") }
        if dialog && frame.maxY > window.maxY + 0.5 { found.append("above the window's bottom") }
        return (true, found)
    }

    /// The oracle without the app (runs with the UI tests): the header's menu button beside the window fails; the menu
    /// in its closed position fails where it must be open (S06, O10) and passes where it must be closed; a drawer
    /// element showing in a closed state fails; a popup beside the window fails; scrolled-out content does not.
    func testTheOracleCatchesAMisplacedMenu() {
        let window = CGRect(x: 0, y: 0, width: 1032, height: 1376)
        let closed = CGRect(x: -1027, y: 37, width: 34, height: 34), open = CGRect(x: 5, y: 37, width: 34, height: 34)
        XCTAssertFalse(Self.problems(id: "shell-menu-button", frame: CGRect(x: -40, y: 37, width: 34, height: 34), window: window, menuOpen: false).problems.isEmpty)
        XCTAssertFalse(Self.problems(id: "shell-menu-back", frame: closed, window: window, menuOpen: true).problems.isEmpty,
                       "S06 with the menu closed")
        XCTAssertTrue(Self.problems(id: "shell-menu-back", frame: closed, window: window, menuOpen: false).problems.isEmpty)
        XCTAssertFalse(Self.problems(id: "shell-menu-back", frame: open, window: window, menuOpen: false).problems.isEmpty,
                       "the menu showing where it must be closed")
        XCTAssertTrue(Self.problems(id: "shell-menu-back", frame: open, window: window, menuOpen: true).problems.isEmpty)
        XCTAssertFalse(Self.problems(id: "popup", frame: CGRect(x: 1100, y: 500, width: 270, height: 200), window: window, menuOpen: false).problems.isEmpty)
        XCTAssertTrue(Self.problems(id: "places-row-9", frame: CGRect(x: 0, y: 1400, width: 1032, height: 60), window: window, menuOpen: false).problems.isEmpty)
    }

    /// The side menu's own elements (the drawer); the header's `shell-menu-button` is page content.
    static func drawer(_ id: String) -> Bool { id.hasPrefix("shell-menu") && id != "shell-menu-button" }

    /// Every element with an identifier that shows in the window is inside it (see the class's note). `menuOpen` says
    /// which state the side menu must be in: open, its elements are checked as content; closed, they must all wait in
    /// the closed position wholly left of the window (`offset(x: -width)`; XCUITest lists them although they are hidden
    /// from VoiceOver), and nothing else is exempt (CODEX-IN18P1-5).
    func inside(_ name: String, menuOpen: Bool) throws {
        let snapshot = try app.snapshot()
        var nodes: [XCUIElementSnapshot] = []
        var queue = [snapshot]
        while let node = queue.popLast() {
            queue += node.children
            if !node.identifier.isEmpty, node.frame.width > 0, node.frame.height > 0 { nodes.append(node) }
        }
        // The window the checked content is in: the one holding the most identified elements (CODEX-IN18P1-6;
        // `windows.firstMatch` was once a 516×688 window while the page was 1032 pt wide).
        let windows = app.windows.allElementsBoundByIndex.map(\.frame).filter { $0.width > 0 && $0.height > 0 }
        let window = windows.max { a, b in
            let ca = nodes.filter { a.intersects($0.frame) }.count, cb = nodes.filter { b.intersects($0.frame) }.count
            return ca != cb ? ca < cb : a.width * a.height < b.width * b.height
        } ?? app.windows.firstMatch.frame
        var seen = 0, drawerSeen = 0
        for node in nodes {
            let (checked, problems) = Self.problems(id: node.identifier, frame: node.frame, window: window, menuOpen: menuOpen)
            if Self.drawer(node.identifier) { drawerSeen += 1 }
            if checked { seen += 1 }
            for problem in problems { XCTFail("\(name): \(node.identifier) \(node.frame) \(problem) \(window)") }
        }
        XCTAssertGreaterThan(seen, 0, "\(name): elements")
        if menuOpen { XCTAssertGreaterThan(drawerSeen, 0, "\(name): the open menu's elements") }
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
        tap("shell-menu-button", until: { element("shell-menu-back").isHittable })
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
            // A row tapped while the menu settles can be lost (S12 once stayed on the open menu): tap until the page shows.
            tap("shell-menu-\(row)", until: { element("nation-back").exists })
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
