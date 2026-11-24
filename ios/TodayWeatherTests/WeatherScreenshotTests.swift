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

    @Test func captureFractionalWeatherHeader() throws {
        let page = "kma-seoul-hourly"
        let content = try Self.content(page, exampleTemperature: -0.1)
        #expect(content.page.hero?.temperature == "-0.1")
        let header = Self.blockView(.header, content: content, page: page)
        let bitmap = try render(header, width: 393, scale: 3)
        let png = try #require(UIImage(cgImage: bitmap.image).pngData())
        Attachment.record(png, named: "ios-fractional-header.png")
    }

    @Test(arguments: ["kma-seoul-hourly", "kma-seoul-daily"])
    func rankedForecastHeader(page: String) throws {
        let midnight = try #require(ISO8601DateFormatter().date(from: "2026-02-04T15:00:00Z"))
        let daylight = midnight.addingTimeInterval(-1)
        let display = try MatrixScreenshotTests.display("375x667")

        func header(_ text: String, at now: Date = daylight, name: String) throws -> Bitmap {
            let content = try Self.content(page, rankedSummary: text, now: now, metrics: display.metrics)
            let hero = try #require(content.page.hero)
            if now < midnight {
                #expect(hero.rankedSummary)
                #expect(hero.summary == text)
                #expect(hero.summaryAir == nil)
            } else {
                #expect(!hero.rankedSummary)
                #expect(hero.summary == "흐림")
            }
            let view = Self.blockView(.header, content: content, page: page, headerTop: display.top)
            let bitmap = try render(view, width: display.width, scale: display.scale)
            let png = try #require(UIImage(cgImage: bitmap.image).pngData())
            Attachment.record(png, named: "\(page)-\(name).png")
            return bitmap
        }

        let term = try header("입춘", name: "solar-term")
        let hazards = try header("한파주의보, 초미세먼지 매우 나쁨", name: "hazards")
        let expired = try header("입춘", at: midnight, name: "expired")
        #expect(term.pixels != hazards.pixels, "The displayed header must react to distinct ranked text")
        #expect(term.pixels != expired.pixels, "The dated text must disappear after Seoul midnight")

        // Measure the actual summary box outside the header's fixed frame, where wrapping cannot be hidden by clipping.
        func box(_ text: String) throws -> Bitmap {
            let content = try Self.content(page, rankedSummary: text, now: daylight, metrics: display.metrics)
            let width = display.width * 0.8
            let view = MainBox(page: content.page, metrics: display.metrics, theme: .light,
                               colors: WeatherColors.of(.light, daily: content.type == .mid),
                               s: TextScale(.large), width: width, perform: { _ in })
            return try render(AnyView(view), width: width, scale: display.scale)
        }
        let one = try box("입춘")
        let two = try box("입춘\n오늘 최저 영하 12도")
        let long = try box("입춘\n오늘 최저 영하 12도\n최고 영하 3도\n한파주의보")
        #expect(two.height > one.height)
        #expect(long.height == two.height, "The forecast summary must occupy at most two lines")
    }

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
            let file = try #require(block["file"]?.stringValue)
            let reference = try References.image(Self.referenceFile(file, block: kind, content: content))
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

    /// The native baseline replaces only the temperature and its recentered sky icon in fractional headers.
    static func referenceFile(_ file: String, block: WeatherBlock, content: WeatherPageContent) -> String {
        guard block == .header, content.page.hero?.temperature.contains(".") == true else { return file }
        return "fractional-" + file
    }

    /// The page model of a captured page: the served response converted, with the place's own fields, applied as the
    /// Cordova visit did (London as the second of two places).
    static func content(_ page: String, exampleTemperature: Double? = nil, rankedSummary: String? = nil,
                        now: Date = Date(), metrics: ChartMetrics = ChartMetrics(bodyWidth: 393, bodyHeight: 852)) throws -> WeatherPageContent {
        let manifest = try References.json("forecast-captures.json")
        let fixture = page.hasPrefix("vc-london") ? "vc-london" : "kma-seoul"
        let place = try #require(manifest["places"]?[fixture]?.objectValue)
        let converted = try #require(try WeatherConverter.convert(References.json("forecast-\(fixture).input.json")))
        var record = JSONObject()
        for field in WeatherRepository.weatherFields { if let v = converted[field], Js.truthy(v) { record[field] = v } }
        for key in ["name", "address", "country", "location"] { record[key] = place[key] }
        record["currentPosition"] = .bool(false)
        if let exampleTemperature, var current = record["currentWeather"]?.objectValue {
            current["t1h"] = .number(exampleTemperature)
            record["currentWeather"] = .object(current)
        }
        if let rankedSummary {
            let current = try #require(record["currentWeather"]?.objectValue)
            record["currentWeather"] = .object(current.setting("summary", .string(rankedSummary))
                .setting("summaryForDate", "2026-02-04").setting("summaryWeather", "흐림"))
        }
        var scope = ForecastScope(type: page.contains("daily") ? .mid : .short, metrics: metrics,
                                  fahrenheit: false, photoTheme: false,
                                  yesterday: YesterdayText(same: Catalog(code: "ko")("LOC_SAME_AS_YESTERDAY"),
                                                           than: Catalog(code: "ko")("LOC_THAN_YESTERDAY")),
                                  expandShortChart: page.hasSuffix("expanded"))
        scope.open(record, enabledCount: Int(place["cityCount"]?.numberValue?.double ?? 1), hasPush: false)
        if rankedSummary != nil { scope.apply(record, hasPush: false, now: now) }
        let units = PageUnits(temperature: "C", windSpeed: "m/s", pressure: "hPa", distance: "km", precipitation: "mm", air: "airkorea")
        return WeatherPageContent(scope: scope, units: units, texts: WeatherScreens.texts(Catalog(code: "ko")))
    }

    /// A block as the capture cut it: the header block with the shell's header bar over it (the bar with the place's
    /// title and the page's buttons, `headerTop` of safe area above its 44 pt: 5 on the 393x852 iPhone), a chart at its
    /// opening position.
    static func blockView(_ block: WeatherBlock, content: WeatherPageContent, page: String, theme: Theme = .light,
                          headerTop: CGFloat = 5) -> AnyView {
        let tab: ShellTab = content.type == .short ? .forecast : .dailyforecast
        switch block {
        case .header:
            let colors = ShellColors.of(theme, tab: tab)
            return AnyView(ZStack(alignment: .top) {
                WeatherBlockView(block: .header, content: content, theme: theme)
                HeaderBar(colors: colors, title: content.page.title,
                          insets: ShellInsets(statusBar: 0, top: headerTop, bottom: 0, leading: 0, trailing: 0), onMenu: {}) {
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
