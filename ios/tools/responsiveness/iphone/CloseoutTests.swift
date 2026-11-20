import XCTest

@MainActor
final class CloseoutTests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "net.wizardfactory.todayweather.profile3029")
    func el(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    func now() -> Double { ProcessInfo.processInfo.systemUptime }
    func openFixture() {
        continueAfterFailure = false
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        if el("popup-button-0").exists { el("popup-button-0").tap() }
        if el("start-shortcut-0").exists { el("start-shortcut-0").tap() }
        XCTAssertTrue(el("forecast-header").waitForExistence(timeout: 20))
    }
    func testKey() {
        openFixture()
        el("shell-tab-search").tap()
        let field = el("places-input")
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        guard let key = ["s", "S", "ㄴ"].map({ keyboard.keys[$0] }).first(where: { $0.exists }) else {
            XCTFail("Expected an S or Korean nieun key on the system keyboard. " + keyboard.debugDescription); return
        }
        let glyph = key.label
        let rect = field.frame
        print("FIELD,\(rect),KEY,\(key.frame),\(glyph)")
        for i in 0...10 {
            let t = now()
            let epoch = Date().timeIntervalSince1970
            key.tap()
            let shot = field.screenshot()
            let end = now()
            XCTAssertEqual((field.value as? String)?.lowercased(),glyph.lowercased())
            let a = XCTAttachment(screenshot: shot); a.name = "echo-\(i)"; a.lifetime = .keepAlways; add(a)
            print("SAMPLE,key,\(i),\(t),\(end),\(epoch)")
            let delete = keyboard.keys["delete"]
            if delete.exists { delete.tap() } else { field.typeText(XCUIKeyboardKey.delete.rawValue) }
            XCTAssertNotEqual((field.value as? String)?.lowercased(),glyph.lowercased())
        }
    }
    func testAlarm() {
        openFixture()
        let bell = el("forecast-bell"), bar = el("alarms-hours")
        bell.tap()
        if !bar.exists { el("alarms-alert").tap() }
        XCTAssertTrue(bar.isHittable)
        for i in 0...10 {
            let v = (bar.value as? String ?? "").split(separator:"-").compactMap { Int($0) }
            XCTAssertEqual(v.count,2)
            let to = v[1]
            let endHour = v[0] == 2 ? min(10,to-1) : 2
            XCTAssertLessThan(endHour,to)
            func coord(_ hour: Int) -> XCUICoordinate {
                let width = bar.frame.width
                return bar.coordinate(withNormalizedOffset: CGVector(dx: (8+(width-16)*CGFloat(hour)/24)/width,dy:0.50))
            }
            let start = coord(v[0]), finish = coord(endHour)
            let t = now()
            start.press(forDuration: 0.10, thenDragTo: finish, withVelocity: .slow, thenHoldForDuration: 0)
            let after = now()
            let expected = "\(endHour)-\(to)"
            XCTAssertEqual(bar.value as? String,expected)
            print("SAMPLE,drag,\(i),\(t),\(after),\(expected)")
            let save = el("alarms-save")
            if !save.isHittable { app.swipeUp() }
            XCTAssertTrue(save.isHittable)
            let s = now()
            save.tap()
            XCTAssertTrue(bar.waitForNonExistence(timeout: 5))
            let returnedBell = app.buttons.matching(identifier: "forecast-bell").allElementsBoundByIndex.first { $0.isHittable }
            let frame = el("forecast-header").frame
            XCTAssertFalse(frame.isEmpty)
            let touch = returnedBell?.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                ?? app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: bell.frame.midX, dy: bell.frame.midY))
            let e = now()
            print("SAMPLE,save,\(i),\(s),\(e),\(expected)")
            touch.tap()
            XCTAssertTrue(bar.waitForExistence(timeout: 5))
            XCTAssertEqual(bar.value as? String,expected)
        }
    }
}
