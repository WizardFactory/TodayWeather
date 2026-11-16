import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// S09 and its popups against the Cordova iOS build (#2963 AC4): the states of the Cordova manual's pages 21–23 (S09
/// with the defaults, the time picker O14 on the add row and on an alarm, the save confirmation O12), the switch off, the
/// equal-hours message O13, the permission dialog O11, and over the tabs the weather-alert introduction O06 and a message
/// while the app shows (O07), captured at 393x852 pt and scale 3 by ios/tools/push-reference
/// (`AlarmsReference/alarms-<lang>-<state>.png`) in Korean and English. S09 is rendered with `ImageRenderer` at the
/// capture's size and scale and compared by the AN-05 metric within `AlarmsReference/alarms-tolerances.json` from the top
/// to 20 pt under Cancel / Save (the rest is the page's background, checked by samples); O06 and O07 are compared in the
/// popup's box (the Hourly page under the backdrop is IN-08's). Renders and differences go to `<tmp>/chart-compare/`.
@MainActor
struct AlarmsScreenshotTests {
    static let scale: CGFloat = 3
    /// The WebView's insets on the 393x852 iPhone: the status bar above it, `env(safe-area-inset-top)` 5 pt in the header
    /// bar, the home indicator's 34 pt at the bottom.
    static let insets = ShellInsets(statusBar: 0, top: 5, bottom: 34, leading: 0, trailing: 0)
    nonisolated static let languages = ["ko-KR", "en-US"]
    nonisolated static let pageStates = ["settings", "picker", "picker-alarm", "confirm", "alert-off", "equal", "permission"]

    /// The page of a captured state: 서울 with the defaults of a place without records (07–22 on, Mon–Fri, 7:40 and
    /// 20:20), the switch off, or the equal state's stored alert 9–9 with one alarm at 7:40.
    static func content(_ state: String) -> AlarmsContent {
        let weekdays = AlarmSettings.weekdays
        if state == "equal" {
            return AlarmsContent(title: "서울", alertOn: true, barShown: true, from: 9, to: 9, days: weekdays,
                                 rows: [.init(index: 0, text: "7:40")], canAdd: true, addIndex: 1)
        }
        let on = state != "alert-off"
        return AlarmsContent(title: "서울", alertOn: on, barShown: on, from: 7, to: 22, days: weekdays,
                             rows: [.init(index: 0, text: "7:40"), .init(index: 1, text: "20:20")], canAdd: true, addIndex: 2)
    }

    static func popup(_ state: String, catalog: Catalog) -> Popup? {
        switch state {
        case "picker", "picker-alarm":
            let time = TimePicker.of(state == "picker" ? 8 * 3600 : 7 * 3600 + 40 * 60)
            return Popup(title: "", lines: [], buttons: [], custom: AnyView(TimePickerView(time: time, catalog: catalog)))
        case "confirm": return AlarmsScreens.standardPopup(.saveChanges, catalog: catalog) { _ in }
        case "equal": return AlarmsScreens.standardPopup(.equalHours, catalog: catalog) { _ in }
        case "permission": return AlarmsScreens.standardPopup(.permission, catalog: catalog) { _ in }
        default: return nil
        }
    }

    @Test(arguments: languages)
    func theAlarmPagesMatchTheCordovaPages(language: String) throws {
        let tolerances = try References.json("alarms-tolerances.json")
        let catalog = Catalog(code: language == "en-US" ? "en" : "ko")
        var report: [String] = []
        for state in Self.pageStates {
            let view = ZStack(alignment: .top) {
                AlarmsPageFrame(content: Self.content(state), theme: .light, catalog: catalog, insets: Self.insets, scrolls: false)
                if let popup = Self.popup(state, catalog: catalog) {
                    IonicPopupView(popup: popup, onTap: { _ in }, scrolls: false)
                }
            }
            .frame(width: 393, height: 798)
            let name = "\(language)-\(state)"
            let reference = try References.image("alarms-\(name).png")
            let native = render(view)
            let bottom = state == "alert-off" ? 550 : 633
            let height = Int(CGFloat(bottom) * Self.scale)
            try compare(name, native.top(height), reference.top(height), tolerances, &report)
            // The picker's 1 px #ddd lines (a whole-page metric barely sees them): the heading's top and bottom borders
            // and the hours box's top border, sampled inside each line.
            if state.hasPrefix("picker") {
                for (x, y) in [(200, 295 * 3 + 1), (200, 338 * 3 + 1), (115, 379 * 3 + 1)] {
                    let expected = reference.rgb(x: x * 3, y: y), drawn = native.rgb(x: x * 3, y: y)
                    #expect(zip(drawn, expected).allSatisfy { abs($0 - $1) <= 12 }, "\(name) line at \(y): \(drawn) vs \(expected)")
                }
            }
            // The page's background under Cancel / Save (dimmed by the backdrop under a popup).
            for y in [reference.height - 150, reference.height - 450] {
                let expected = reference.rgb(x: 600, y: y)
                #expect(zip(native.rgb(x: 600, y: y), expected).allSatisfy { abs($0 - $1) <= 2 }, "\(name) background at \(y)")
            }
            // The status bar above the WebView: `applyIOSStatusBar('light', 'push')`, white.
            #expect(try References.image("alarms-\(name)-statusbar.png").rgb(x: 600, y: 20) == [255, 255, 255], "\(name) status bar")
        }
        print("ALARMS-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// O06 and O07 over the Hourly tab: the popup's box, compared over the backdrop.
    @Test(arguments: languages)
    func theIntroductionAndAMessageMatchTheCordovaPopups(language: String) throws {
        let tolerances = try References.json("alarms-tolerances.json")
        let catalog = Catalog(code: language == "en-US" ? "en" : "ko")
        let shell = ShellFixture.shell(languages: [language])
        let screens = AlarmsScreens(shell: shell, makePage: { fatalError("no visit") }, postList: {})
        var report: [String] = []
        for state in ["intro", "foreground"] {
            let popup: Popup
            if state == "intro" {
                var s = ShellFixture.state()
                s.push.needsAlertIntro = true
                let intro = AlarmsScreens(shell: ShellFixture.shell(s, languages: [language]), makePage: { fatalError("no visit") },
                                          postList: {})
                intro.showIntroIfDue()
                popup = try #require(intro.shell.popups.first)
            } else {
                // The capture's message: the app's name and a line, as the iOS payload's `aps.alert` carries them.
                let title = language == "en-US" ? "TodayWeather" : "오늘날씨"
                screens.showMessage(JSONObject([("aps", .object(JSONObject([("alert", .object(JSONObject([
                    ("title", .string(title)), ("body", "Seoul 7:40 sunny")])))]))), ("cityIndex", "1")]))
                popup = try #require(screens.shell.popups.last)
            }
            // The Hourly page under the backdrop shows through the popup's 90 % white by a few levels: a light page stands in.
            let view = ZStack {
                CssColor(0xF5F5F5).color
                IonicPopupView(popup: popup, onTap: { _ in }, scrolls: false)
            }
            .frame(width: 393, height: 798)
            let name = "\(language)-\(state)"
            let record = try References.json("alarms-\(name).json")
            let box = try #require(record["popup"]?["popup"]?["rect"])
            let rect = CGRect(x: box["x"]!.numberValue!.double, y: box["y"]!.numberValue!.double,
                              width: box["w"]!.numberValue!.double, height: box["h"]!.numberValue!.double)
            let native = render(view).crop(rect, scale: Self.scale)
            let reference = try References.image("alarms-\(name).png").crop(rect, scale: Self.scale)
            try compare(name, native, reference, tolerances, &report)
        }
        print("ALARMS-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// The rows, cards and buttons at the captured rects (each within 1 pt), read from the rendered page's ink.
    @Test func theRowsAreWhereTheCordovaPagePutThem() throws {
        let record = try References.json("alarms-ko-KR-settings.json")
        let page = try #require(record["page"])
        func rect(_ v: JSONValue?) -> CGRect? {
            guard let r = v?["rect"] ?? v, let x = r["x"]?.numberValue?.double, let y = r["y"]?.numberValue?.double,
                  let w = r["w"]?.numberValue?.double, let h = r["h"]?.numberValue?.double else { return nil }
            return CGRect(x: x, y: y, width: w, height: h)
        }
        let cards = (page["cards"]?.arrayValue ?? []).compactMap { rect($0) }
        #expect(cards.count == 2)
        let days = (page["days"]?.arrayValue ?? []).compactMap { rect($0) }
        #expect(days.count == 7)
        let view = AlarmsPageFrame(content: Self.content("settings"), theme: .light, catalog: Catalog(code: "ko"), insets: Self.insets,
                                   scrolls: false).frame(width: 393, height: 798)
        let native = render(view)
        // The first and last row of each card's box: the card's white over the page's #f5f5f5 at x = 2.
        for card in cards {
            #expect(native.rgb(x: 6, y: Int((card.minY + 1) * Self.scale)) == [255, 255, 255], "card top \(card)")
            #expect(native.rgb(x: 6, y: Int((card.maxY - 1) * Self.scale)) == [255, 255, 255], "card bottom \(card)")
            #expect(native.rgb(x: 6, y: Int((card.maxY + 3) * Self.scale)) != [255, 255, 255], "under card \(card)")
        }
        // Each weekday button's border at its left edge and its middle row.
        for day in days {
            let y = Int(day.midY * Self.scale)
            let x = Int((day.minX + 0.4) * Self.scale)
            #expect(native.rgb(x: x, y: y) != [255, 255, 255], "day border at \(day)")
            #expect(native.rgb(x: Int((day.minX - 1.5) * Self.scale), y: y) == [255, 255, 255], "outside day \(day)")
        }
    }

    private func render<V: View>(_ view: V) -> Bitmap {
        // The references were captured with the simulator in Korean or English (CI's simulator is in English).
        let renderer = ImageRenderer(content: view.environment(\.sizeCategory, .large).environment(\.cssFallbackLanguage, "ko"))
        renderer.scale = Self.scale
        return Bitmap(renderer.cgImage!)
    }

    private func compare(_ name: String, _ native: Bitmap, _ reference: Bitmap, _ tolerances: JSONValue,
                         _ report: inout [String]) throws {
        let diff = ImageDiff(native: native, reference: reference)
        try diff.write("alarms-\(name)")
        report.append("\(name): strong \(diff.strong) mean \(diff.mean) height \(diff.heightDifference)")
        guard let limit = tolerances["cases"]?[name] else {
            Issue.record("no tolerance for \(name): strong \(diff.strong) mean \(diff.mean) height \(diff.heightDifference)")
            return
        }
        let margin = tolerances["margin"]
        func n(_ v: JSONValue?) -> Double { v?.numberValue?.double ?? .nan }
        #expect(native.width == reference.width, "\(name) width \(native.width) vs \(reference.width)")
        #expect(diff.strong <= n(limit["strong"]) + n(margin?["strong"]), "\(name) strong \(diff.strong)")
        #expect(diff.mean <= n(limit["mean"]) + n(margin?["mean"]), "\(name) mean \(diff.mean)")
        #expect(abs(Double(diff.heightDifference)) <= n(limit["heightDifference"]) + n(margin?["heightDifference"]),
                "\(name) height \(diff.heightDifference)")
    }
}

extension Bitmap {
    /// The pixels of `rect` (points at `scale`).
    func crop(_ rect: CGRect, scale: CGFloat) -> Bitmap {
        let r = CGRect(x: (rect.minX * scale).rounded(), y: (rect.minY * scale).rounded(), width: (rect.width * scale).rounded(),
                       height: (rect.height * scale).rounded())
        return Bitmap(image.cropping(to: r)!)
    }
}
