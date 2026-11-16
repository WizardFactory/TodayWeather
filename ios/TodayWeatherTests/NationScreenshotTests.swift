import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The nationwide pages and the warnings against the Cordova iOS build (#2962 AC3): the states of the Cordova manual's
/// pages 32-35, captured at 393x852 pt and scale 3 by ios/tools/nation-reference (`NationReference/nation-<state>.png`):
/// S10 while loading and in its three modes (33, 34), S11 in its six tabs (35), S12 from its top to its end (32), the
/// failed and empty answers, and S10 and S12 in the dark theme. Each page is rendered with `ImageRenderer` at the
/// capture's size and scale from the answers the capture served (the corpus inputs nation.json and special.json) and
/// compared by the AN-05 metric within `NationReference/nation-tolerances.json`: S10 and S11 from the top to 20 pt under
/// the map, S12 whole. Renders and differences go to `<tmp>/chart-compare/`.
@MainActor
struct NationScreenshotTests {
    static let scale: CGFloat = 3
    /// The WebView's insets on the 393x852 iPhone: the status bar above it, `env(safe-area-inset-top)` 5 pt in the header
    /// bar, the home indicator's 34 pt at the bottom.
    static let insets = ShellInsets(statusBar: 0, top: 5, bottom: 34, leading: 0, trailing: 0)

    static func nation() throws -> NationResponse {
        NationResponse(json: try #require(try JSONValue.parse(NationFixtures.body("nation")).objectValue))
    }

    static func cards() throws -> [WarningCard] {
        let list = try JSONValue.parse(NationFixtures.body("special"))
        return WarningCards.cards(Warnings.parse(list, languageTag: "ko-KR", timeZoneId: "Asia/Seoul"))
    }

    /// The page, content, theme and loading flag of a captured state, from the answers the capture served.
    static func state(_ name: String) throws -> (NationPage, NationContent, Theme, Bool) {
        let catalog = Catalog(code: "ko")
        let units = UnitSettings.defaults(region: "KR")
        let theme: Theme = name.hasSuffix("-dark") ? .dark : .light
        let answered = !(name.hasSuffix("-failed") || name.hasSuffix("-empty") || name == "nation-loading")
        let empty = NationResponse(json: JSONObject([("nation", .string("KR")), ("weather", .array([])), ("air", .array([]))]))
        let response = answered ? try nation() : name.hasSuffix("-empty") ? empty : nil
        if name.hasPrefix("warnings") {
            return (.warnings, .warnings(answered ? try cards() : [], catalog: catalog), theme, false)
        }
        if name.hasPrefix("nation-air") {
            let type = Nationwide.airTypes.first { name == "nation-air-\($0)" } ?? "pm2.5"
            return (.nationAir, .air(response, type: type, units: units, region: "KR", catalog: catalog), theme, false)
        }
        let mode: Nationwide.Mode = name == "nation-rain" ? .rain : name == "nation-wind" ? .wind : .skyTemperature
        return (.nation, .weather(response, mode: mode, units: units, region: "KR", catalog: catalog), theme, name == "nation-loading")
    }

    @Test func pagesMatchTheCordovaPages() throws {
        let manifest = try References.json("nation-captures.json")
        let tolerances = try References.json("nation-tolerances.json")
        let states = try #require(manifest["states"]?.objectValue)
        #expect(states.count >= 21)
        var report: [String] = []
        for (name, entry) in states {
            let record = try References.json("nation-\(name).json")
            let (page, content, theme, loading) = try Self.state(name)
            let offset = CGFloat(entry["scrollTop"]?.numberValue?.double ?? 0)
            let view = NationPageFrame(page: page, content: content, theme: theme, insets: Self.insets, loading: loading,
                                       scrolls: false, offset: offset)
                .frame(width: 393, height: 798)
                .environment(\.cssFallbackLanguage, "ko")
            let reference = try References.image("nation-\(name).png")
            var height = reference.height
            if let map = record["map"]?["rect"] {
                let bottom = (map["y"]?.numberValue?.double ?? 0) + (map["h"]?.numberValue?.double ?? 0) + 20
                height = min(height, Int(bottom * Self.scale))
            }
            try compare(name, render(view).top(height), reference.top(height), tolerances, &report)
            // The status bar above the WebView: `applyIOSStatusBar(theme, '')`.
            let bar = try References.image("nation-\(name)-statusbar.png").rgb(x: 600, y: 20)
            let expected = ShellColors.menu(theme).statusBar
            #expect(bar == [expected.red, expected.green, expected.blue].map { Int(($0 * 255).rounded()) }, "\(name) status bar")
        }
        print("NATION-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    private func render<V: View>(_ view: V) -> Bitmap {
        let renderer = ImageRenderer(content: view.environment(\.sizeCategory, .large))
        renderer.scale = Self.scale
        return Bitmap(renderer.cgImage!)
    }

    private func compare(_ name: String, _ native: Bitmap, _ reference: Bitmap, _ tolerances: JSONValue,
                         _ report: inout [String]) throws {
        let diff = ImageDiff(native: native, reference: reference)
        try diff.write("nation-\(name)")
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
