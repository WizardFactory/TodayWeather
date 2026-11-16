import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// S01 against the Cordova iOS build (#2959 AC3): the states of the Cordova manual's pages 1 and 2 (the access notice
/// O01 over S01, and S01 after it closed) and S01 with a typed word and three predictions, in Korean and English,
/// captured at 393x852 pt and scale 3 by ios/tools/start-reference (`StartReference/start-<lang>-<state>.png`). Each is
/// rendered with `ImageRenderer` at the WebView's size (393x798) and scale 3 and compared by the AN-05 metric within
/// `StartReference/start-tolerances.json`; renders and differences go to `<tmp>/chart-compare/`. The shortcuts' boxes
/// are also checked against the captured rects.
@MainActor
struct StartScreenshotTests {
    static let scale: CGFloat = 3
    nonisolated static let cases: [(String, String)] = [
        ("access", "ko-KR"), ("start", "ko-KR"), ("search", "ko-KR"), ("access", "en-US"), ("start", "en-US"), ("search", "en-US"),
    ]
    /// The fallback fonts of the captured WebView: Korean (Apple SD Gothic Neo) on the Korean system; on the English-only
    /// system WebKit drew Han ideographs in PingFang SC (東京 measured 29.78 pt bold, PingFang SC's width; CoreText's
    /// cascade for "en" on a host with other languages picks Apple SD Gothic Neo, 25.95 pt).
    nonisolated static func fallback(_ language: String) -> String { language == "ko-KR" ? "ko" : "zh-Hans" }

    static let predictions = [Prediction(fullText: "London, UK", firstMatch: 0), Prediction(fullText: "London, ON, Canada", firstMatch: 0),
                              Prediction(fullText: "Londonderry, UK", firstMatch: 0)]

    /// The page of a state: O01 open (access), closed (start), or "Lon" typed with the predictions shown (search).
    static func page(_ state: String, language: String) async throws -> StartFixture {
        let f = try StartFixture(location: TestLocation(system: .notDetermined), search: TestPlaceSearch(["Lon": predictions]),
                                 languages: [language])
        f.page.predictionDelay = .zero
        f.page.opened()
        if state != "access" { f.shell.tapPopupButton(0) }
        if state == "search" {
            f.page.change("Lon")
            #expect(await HostedShellTests.AirLiveTests.wait(5) { f.page.results != nil }, "the predictions")
        }
        return f
    }

    @Test func theStartPageMatchesTheCordovaPage() async throws {
        let tolerances = try References.json("start-tolerances.json")
        var report: [String] = []
        for (state, language) in Self.cases {
            let f = try await Self.page(state, language: language)
            let view = StartFrame(page: f.page, insets: .zero, screenHeight: 852, scrolls: false)
                .frame(width: 393, height: 798)
                .environment(\.cssFallbackLanguage, Self.fallback(language))
            let name = "\(language)-\(state)"
            let renderer = ImageRenderer(content: view.environment(\.sizeCategory, .large))
            renderer.scale = Self.scale
            let native = Bitmap(try #require(renderer.cgImage, "render"))
            let reference = try References.image("start-\(name).png")
            // Compared from the top to 40 pt under the page's last box; the rest is checked as white (or the backdrop).
            let height = Int(((state == "search" ? 420 : 590) as Double) * Self.scale)
            let diff = ImageDiff(native: native.top(height), reference: reference.top(height))
            try diff.write("start-\(name)")
            report.append("\(name): strong \(diff.strong) mean \(diff.mean) height \(diff.heightDifference)")
            if let limit = tolerances["cases"]?[name] {
                let margin = tolerances["margin"]
                func n(_ v: JSONValue?) -> Double { v?.numberValue?.double ?? .nan }
                #expect(native.width == reference.width, "\(name) width")
                #expect(diff.strong <= n(limit["strong"]) + n(margin?["strong"]), "\(name) strong \(diff.strong)")
                #expect(diff.mean <= n(limit["mean"]) + n(margin?["mean"]), "\(name) mean \(diff.mean)")
            } else {
                Issue.record("no tolerance for \(name): strong \(diff.strong) mean \(diff.mean)")
            }
            // Below the compared part: white, or the backdrop over it.
            for y in [reference.height - 100, reference.height - 600] {
                let captured = reference.rgb(x: 600, y: y), drawn = native.rgb(x: 600, y: y)
                #expect(zip(captured, drawn).allSatisfy { abs($0 - $1) <= 2 }, "\(name) below the page at \(y): \(captured) vs \(drawn)")
            }
            // The status bar above the WebView: `applyIOSStatusBar('light', 'start')`, white.
            #expect(try References.image("start-\(name)-statusbar.png").rgb(x: 600, y: 20) == [255, 255, 255], "\(name) status bar")
        }
        print("START-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// Each shortcut as WebKit sized and flowed it: the captured box of every button within half a point.
    @Test(arguments: ["ko-KR", "en-US"])
    func theShortcutsAreSizedAndFlowedAsCaptured(language: String) throws {
        let record = try References.json("start-\(language)-start.json")
        let buttons = (record["elements"]?.arrayValue ?? []).filter {
            $0["tag"]?.stringValue == "button" && $0["className"]?.stringValue?.contains("item-center") == false
        }
        let names = CityShortcuts.forScreenHeight(852).map(\.name)
        #expect(record["shortcuts"]?.arrayValue?.compactMap(\.stringValue) == names, "the Cordova favoriteCityList at 852 pt")
        try #require(buttons.count == names.count)
        // The flow of `ShortcutFlow`: from the item's content box at x 19 and y 195 (10 + 1 border + 8 padding; 140 + 47
        // - 1 + 1 + 8).
        var x: CGFloat = 0, y: CGFloat = 0
        for (button, name) in zip(buttons, names) {
            let width = StartMetrics.buttonWidth(name, language: Self.fallback(language))
            if x > 0 && x + width + 8 > 355.01 { x = 0; y += 55 }
            let rect = button["rect"]
            func n(_ key: String) -> CGFloat { CGFloat(rect?[key]?.numberValue?.double ?? .nan) }
            #expect(button["text"]?.stringValue == name)
            #expect(abs(n("w") - width) <= 0.75, "\(language) \(name) width \(width) vs \(n("w"))")
            #expect(abs(n("x") - (19 + x + 4)) <= 1.5, "\(language) \(name) x \(19 + x + 4) vs \(n("x"))")
            #expect(abs(n("y") - (195 + y + 4)) <= 0.01, "\(language) \(name) y \(195 + y + 4) vs \(n("y"))")
            x += width + 8
        }
    }
}
