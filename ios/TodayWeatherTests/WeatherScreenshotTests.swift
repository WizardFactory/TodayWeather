import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
@testable import TodayWeather

/// The native weather pages against the Cordova iOS pages (#2957 AC3): every block of S03 and S04 for 회현동 (kma-seoul)
/// alone and 런던 (vc-london) added after it, and the hourly chart with its detail rows: the states of the Cordova manual's
/// pages 3 to 9 with fixed data, captured at 393x852 pt and scale 3 by ios/tools/forecast-reference
/// (`ForecastReference/<page>-<block>.png`). The scroll ends of both charts (pages 5, 6, 8 and 9) are the IN-05
/// comparisons (`ChartScreenshotTests`). Each block is rendered alone with `ImageRenderer` at 393 pt and scale 3 from the
/// same responses and compared by the AN-05 metric; each passes within the tolerance recorded in
/// `ForecastReference/forecast-tolerances.json`. The header block is compared with the shell's header bar over it, as
/// captured. Renders and difference images go to `<tmp>/chart-compare/forecast-*`.
@MainActor
struct WeatherScreenshotTests {
    nonisolated static let pages = ["kma-seoul-hourly", "kma-seoul-hourly-expanded", "kma-seoul-daily", "vc-london-hourly", "vc-london-daily"]

    @Test(arguments: pages)
    func pageBlocksMatchTheCordovaPages(page: String) throws {
        let manifest = try References.json("forecast-captures.json")
        let tolerances = try References.json("forecast-tolerances.json")
        let entry = try #require(manifest["pages"]?[page], "\(page) in forecast-captures.json")
        let scale = try #require(manifest["devicePixelRatio"]?.numberValue?.double)
        let content = try Self.content(page)
        var report: [String] = []
        for block in entry["blocks"]?.arrayValue ?? [] {
            let index = Int(block["index"]?.numberValue?.double ?? -1)
            let name = "\(page)-\(index)"
            let kind = content.blocks[index]
            let view = Self.blockView(kind, content: content, page: page)
            let native = try render(view, width: 393, scale: scale)
            let reference = try References.image(try #require(block["file"]?.stringValue))
            let diff = ImageDiff(native: native, reference: reference)
            try diff.write("forecast-\(name)")
            // A block that ends under the tab bar was captured without its last points (`hidden`).
            let hidden = Int((block["hidden"]?.numberValue?.double ?? 0) * scale)
            let height = diff.heightDifference - hidden
            report.append("\(name) (\(kind)): strong \(diff.strong) mean \(diff.mean) height \(height)")
            let limit = try #require(tolerances["cases"]?[name], "tolerance for \(name)")
            let margin = tolerances["margin"]
            #expect(native.width == reference.width, "\(name) width")
            #expect(diff.strong <= number(limit["strong"]) + number(margin?["strong"]), "\(name) strong \(diff.strong)")
            #expect(diff.mean <= number(limit["mean"]) + number(margin?["mean"]), "\(name) mean \(diff.mean)")
            #expect(Double(abs(height)) <= number(limit["heightDifference"]) + number(margin?["heightDifference"]),
                    "\(name) height \(height)")
        }
        print("FORECAST-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// The page model of a captured page: the served response converted, with the place's own fields, applied as the
    /// Cordova visit did (London as the second of two places).
    static func content(_ page: String) throws -> WeatherPageContent {
        let manifest = try References.json("forecast-captures.json")
        let fixture = page.hasPrefix("vc-london") ? "vc-london" : "kma-seoul"
        let place = try #require(manifest["places"]?[fixture]?.objectValue)
        let converted = try #require(try WeatherConverter.convert(References.json("forecast-\(fixture).input.json")))
        var record = JSONObject()
        for field in WeatherRepository.weatherFields { if let v = converted[field], Js.truthy(v) { record[field] = v } }
        for key in ["name", "address", "country", "location"] { record[key] = place[key] }
        record["currentPosition"] = .bool(false)
        var scope = ForecastScope(type: page.contains("daily") ? .mid : .short, metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852),
                                  fahrenheit: false, photoTheme: false,
                                  yesterday: YesterdayText(same: Catalog(code: "ko")("LOC_SAME_AS_YESTERDAY"),
                                                           than: Catalog(code: "ko")("LOC_THAN_YESTERDAY")),
                                  expandShortChart: page.hasSuffix("expanded"))
        scope.open(record, enabledCount: Int(place["cityCount"]?.numberValue?.double ?? 1), hasPush: false)
        let units = PageUnits(temperature: "C", windSpeed: "m/s", pressure: "hPa", distance: "km", precipitation: "mm", air: "airkorea")
        return WeatherPageContent(scope: scope, units: units, texts: WeatherScreens.texts(Catalog(code: "ko")))
    }

    /// A block as the capture cut it: the header block with the shell's header bar over it (the bar with the place's
    /// title and the page's buttons, 5 pt of safe area above its 44 pt), a chart at its opening position.
    static func blockView(_ block: WeatherBlock, content: WeatherPageContent, page: String) -> AnyView {
        let theme = Theme.light
        let tab: ShellTab = content.type == .short ? .forecast : .dailyforecast
        switch block {
        case .header:
            let colors = ShellColors.of(theme, tab: tab)
            return AnyView(ZStack(alignment: .top) {
                WeatherBlockView(block: .header, content: content, theme: theme)
                HeaderBar(colors: colors, title: content.page.title,
                          insets: ShellInsets(statusBar: 0, top: 5, bottom: 0, leading: 0, trailing: 0), onMenu: {}) {
                    WeatherBarActions(hasPush: content.page.hasPush, colors: colors)
                }
            })
        case .chart:
            let opening = content.type == .short ? content.hourly?.openingOffset ?? 0 : content.daily?.openingOffset ?? 0
            return AnyView(WeatherBlockView(block: .chart, content: content, theme: theme,
                                            chartOffset: OpeningScrollView<EmptyView>.scrollPosition(opening)))
        case .attribution:
            // The notice has no background of its own: the page's shows.
            return AnyView(WeatherBlockView(block: block, content: content, theme: theme, chartOffset: 0)
                .background(WeatherColors.of(theme, daily: content.type == .mid).page.color))
        default:
            return AnyView(WeatherBlockView(block: block, content: content, theme: theme, chartOffset: 0).clipped())
        }
    }

    private func number(_ v: JSONValue?) -> Double { v?.numberValue?.double ?? .nan }

    private func render(_ view: AnyView, width: Double, scale: Double) throws -> Bitmap {
        let renderer = ImageRenderer(content: view.frame(width: width).environment(\.sizeCategory, .large))
        renderer.scale = scale
        renderer.proposedSize = ProposedViewSize(width: width, height: nil)
        return Bitmap(try #require(renderer.cgImage, "render"))
    }
}
