import XCTest

/// The notification path of IN-14 (#2963) on a simulator, without any push server: ios/tools/push/run-notification-check.sh
/// builds the app ad hoc signed with a dummy Firebase configuration (a project that does not exist, so the push plugin runs
/// and no token or registration can exist) and its server pointing at a local fixture server, and passes a handshake
/// directory in `TEST_RUNNER_TW_NOTIFY_DIR`. At each step this test writes `<step>.ready` there; the script then delivers a
/// notification shaped like the production FCM/APNs one (`aps.alert` title and body, `cityIndex` a string) with
/// `xcrun simctl push` and writes `<step>.pushed`. Without the directory (CI, the scheme's own test action) it skips.
///
/// 1. 서울 from S01 and 부산 from S02; S02's bell for 서울 opens S09, which asks for the notification permission as the
///    Cordova iOS app does (`Push.grantPermission`): the system alert is answered Allow; Save stores the defaults.
/// 2. `foreground`: a message while the app shows is O07 (날씨, its title and body, OK) and changes no place.
/// 3. `warm`: the app in the background, the banner tapped: the app resumes on 부산광역시 (`cityIndex` "2").
/// 4. `cold`: the app ended, the notification tapped: the app starts on 서울 (`cityIndex` "1").
@MainActor
final class NotificationUITests: XCTestCase {
    let directory = ProcessInfo.processInfo.environment["TW_NOTIFY_DIR"]
    var app: XCUIApplication!
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    var title: String {
        let bar = element("shell-title")
        guard bar.exists else { return "" }
        let texts = bar.staticTexts.allElementsBoundByIndex.map { $0.label }.filter { !$0.isEmpty }
        return texts.first ?? bar.label
    }

    func waitForTitle(_ expected: String, _ seconds: TimeInterval = 60) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if element("shell-title").exists && title == expected { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    func tap(_ identifier: String, _ seconds: TimeInterval = 60) {
        let e = element(identifier)
        XCTAssertTrue(e.waitForExistence(timeout: seconds), "\(identifier)")
        e.tap()
    }

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

    /// Asks the script to deliver the step's notification and waits until it did.
    func deliver(_ step: String) throws {
        let dir = URL(fileURLWithPath: try XCTUnwrap(directory))
        try Data().write(to: dir.appendingPathComponent("\(step).ready"))
        let pushed = dir.appendingPathComponent("\(step).pushed")
        let end = Date().addingTimeInterval(120)
        while !FileManager.default.fileExists(atPath: pushed.path) && Date() < end { Thread.sleep(forTimeInterval: 0.3) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: pushed.path), "the script delivered \(step)")
    }

    /// The delivered notification on the home screen or the lock screen, by its title.
    func notification(_ text: String) -> XCUIElement {
        springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Taps the delivered notification: its banner while it shows, else its entry in Notification Center (swiped down
    /// from the top of the screen).
    func tapNotification(_ text: String, _ name: String) {
        let banner = notification(text)
        if banner.waitForExistence(timeout: 10) && banner.isHittable {
            shot("\(name)-banner")
            banner.tap()
            return
        }
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.005))
        top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.75)))
        let entry = notification(text)
        let end = Date().addingTimeInterval(20)
        while !(entry.exists && entry.isHittable) && Date() < end { Thread.sleep(forTimeInterval: 0.5) }
        shot("\(name)-notification-center")
        XCTAssertTrue(entry.isHittable, "\(text) in Notification Center")
        entry.tap()
    }

    func testPermissionForegroundMessageAndTaps() throws {
        try XCTSkipUnless(directory != nil, "run by ios/tools/push/run-notification-check.sh")
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        tap("popup-button-0", 120)                     // O01 over S01
        tap("start-shortcut-0")                        // 서울
        XCTAssertTrue(waitForTitle("서울"), "Hourly for 서울: \(title)")
        tap("shell-tab-search")
        let input = element("places-input")
        XCTAssertTrue(input.waitForExistence(timeout: 30))
        input.tap()
        input.typeText("부산")
        tapResult("places-town-0")
        XCTAssertTrue(waitForTitle("부산광역시"), "Hourly for 부산광역시: \(title)")

        // S09 from S02's bell for 서울: the permission request where the Cordova iOS app makes it.
        tap("shell-tab-search")
        tap("places-bell-1")
        XCTAssertTrue(element("alarms-page").waitForExistence(timeout: 30), "S09")
        let alert = springboard.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 30), "the system's notification permission request")
        shot("permission-request")
        let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["허용", "Allow"])).firstMatch
        XCTAssertTrue(allow.exists, "Allow in \(alert.buttons.allElementsBoundByIndex.map(\.label))")
        allow.tap()
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(element("popup").exists, "no O11 after the grant")
        shot("alarms-after-grant")
        tap("alarms-save")
        XCTAssertTrue(element("places-bell-1").waitForExistence(timeout: 30), "back on S02")
        XCTAssertEqual(element("places-bell-1").label, "alarm on")
        tap("shell-tab-forecast")
        XCTAssertTrue(waitForTitle("서울"), "Hourly for 서울 (selected by S09): \(title)")

        // A message while the app shows: O07, no place change.
        try deliver("foreground")
        let popup = element("popup")
        XCTAssertTrue(popup.waitForExistence(timeout: 30), "O07")
        shot("foreground-message")
        // The popup's Korean lines carry zero-width spaces between syllables (WebKit's break opportunities).
        let texts = popup.staticTexts.allElementsBoundByIndex.map { $0.label.replacingOccurrences(of: "\u{200B}", with: "") }
        XCTAssertTrue(texts.contains("날씨"), "O07's title: \(texts)")
        XCTAssertTrue(texts.contains { $0.contains("부산 맑음") }, "O07's lines: \(texts)")
        tap("popup-button-0")
        XCTAssertEqual(title, "서울", "a message does not change the place")

        // Warm start: the banner tapped while the app is in the background.
        XCUIDevice.shared.press(.home)
        try deliver("warm")
        tapNotification("부산 맑음", "warm")
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        XCTAssertTrue(waitForTitle("부산광역시"), "the tap selected 부산광역시: \(title)")
        shot("warm-opened")

        // Cold start: the app ended, the notification tapped.
        app.terminate()
        try deliver("cold")
        tapNotification("서울 맑음", "cold")
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60))
        XCTAssertTrue(waitForTitle("서울", 90), "the tap selected 서울: \(title)")
        shot("cold-opened")
    }
}
