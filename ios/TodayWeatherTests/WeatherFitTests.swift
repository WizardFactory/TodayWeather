import Foundation
import SwiftUI
import Testing
import TWDomain
import TWModel
@testable import TodayWeather

/// The weather pages at larger text and on other screens (IN-08, #2957; text follows Dynamic Type, verified up to
/// `xxxLarge` as decided on #2948): on an iPhone SE, the 393 pt iPhone and iPad portrait and landscape widths, in every
/// catalog, the pages render at the window's width, the header block grows to hold its text, every summary line fits the
/// main box, and the tables' rows grow with the text and stay inside the window.
@MainActor
struct WeatherFitTests {
    static let widths: [CGFloat] = [375, 393, 834, 1024, 1366]

    @Test(arguments: ["ko", "en", "de", "ja", "zh-CN", "zh-TW"])
    func pagesFitAtTheLargestTextSize(catalog: String) throws {
        for page in WeatherScreenshotTests.pages where !page.hasSuffix("expanded") {
            for width in Self.widths {
                let base = try Self.content(page, catalog: catalog, width: width)
                for category in [ContentSizeCategory.large, .extraExtraExtraLarge] {
                    let name = "\(catalog) \(page) \(width) \(category)"
                    let s = TextScale(category)
                    // Rendering every combination would keep the main actor busy for minutes: the narrowest and the
                    // widest window render at the largest size, the others are checked on the model's measures.
                    if category == .extraExtraExtraLarge && (width == Self.widths.first || width == Self.widths.last) {
                        let renderer = ImageRenderer(content: WeatherPageView(content: base, theme: .light, scrolls: false)
                            .frame(width: width).environment(\.sizeCategory, category))
                        renderer.proposedSize = ProposedViewSize(width: width, height: nil)
                        renderer.scale = 1
                        let image = try #require(renderer.cgImage, "\(name)")
                        #expect(CGFloat(image.width) == width, "\(name): the page keeps the window's width")
                    }
                    if let hero = base.page.hero {
                        for text in [hero.summary] + (hero.summaryAir.map { [$0] } ?? []) {
                            for line in SummaryLines.lines(text, size: s(21), width: width * 0.8) {
                                #expect(CssLine.width([CssRun(text: line, size: s(21))]) <= width * 0.8 + 0.5, "\(name): \(line)")
                            }
                        }
                    }
                    for row in base.page.detailWeather ?? [] {
                        let w = 40 + CssLine.width([CssRun(text: " " + row.text.map(\.text).joined(), size: s(17))])
                        #expect(w <= width, "\(name): detail row \(row.text)")
                    }
                }
            }
        }
    }

    /// Every theme colors the header block, the cards and the page as its SCSS does (the photo theme without a photo
    /// shows the light page).
    @Test func themesColorThePage() throws {
        for (theme, header, page) in [(Theme.light, 0xFFFFFF, 0xF5F5F5), (.dark, 0x1C1C1D, 0x171717), (.old, 0x03A9F4, 0x03A9F4),
                                      (.photo, 0xFFFFFF, 0xF5F5F5)] as [(Theme, UInt32, UInt32)] {
            let content = try Self.content("kma-seoul-hourly", catalog: "ko", width: 393)
            let renderer = ImageRenderer(content: WeatherPageView(content: content, theme: theme, scrolls: false).frame(width: 393))
            renderer.proposedSize = ProposedViewSize(width: 393, height: nil)
            renderer.scale = 1
            let image = Bitmap(try #require(renderer.cgImage))
            func pixel(_ x: Int, _ y: Int) -> UInt32 {
                let i = (y * image.width + x) * 4
                return UInt32(image.pixels[i]) << 16 | UInt32(image.pixels[i + 1]) << 8 | UInt32(image.pixels[i + 2])
            }
            #expect(pixel(3, 3) == header, "\(theme): header block")
            // The page's color shows in the 5 pt gap under the first card.
            let gap = Int(content.metrics.headerHeight + 5 + (content.hourly.map { HourlyChartLayout($0, expanded: true).wrapperHeight } ?? 0) + 10 + 3)
            #expect(pixel(3, gap) == page, "\(theme): page at \(gap)")
        }
    }

    /// CODEX-IN08-2: narrow iPad windows (Split View's third and half of a portrait iPad Pro 11", a small Stage Manager
    /// window) at `xxxLarge`, with the page's sizes taken from the window: both pages of both places ask for no more than
    /// the window's width (tables wrap their text), and the temperature with the sky image fits the main box.
    @Test(arguments: ["ko", "de"])
    func narrowWindowsFitAtTheLargestTextSize(catalog: String) throws {
        let windows = [CGSize(width: 320, height: 1032), CGSize(width: 678, height: 1032), CGSize(width: 500, height: 600)]
        for page in WeatherScreenshotTests.pages where !page.hasSuffix("expanded") {
            for window in windows {
                let name = "\(catalog) \(page) \(window)"
                let content = try Self.content(page, catalog: catalog, width: window.width, height: window.height)
                let view = WeatherPageView(content: content, theme: .light, scrolls: false)
                    .environment(\.sizeCategory, .extraExtraExtraLarge)
                let host = UIHostingController(rootView: view)
                let asked = host.sizeThatFits(in: CGSize(width: window.width, height: .greatestFiniteMagnitude))
                #expect(asked.width <= window.width + 0.5, "\(name): the page asks for \(asked.width)")
                if let hero = content.page.hero {
                    let big = content.metrics.bigFontSize
                    let runs = [CssRun(text: hero.temperature, size: big), CssRun(text: "˚", size: big / 2)]
                    let row = CssLine.width(runs) + content.metrics.bigImageSize
                    #expect(row <= window.width * 0.8 + 0.5, "\(name): temperature row \(row)")
                }
            }
        }
    }

    @Test func rowsGrowWithTheText() {
        let large = CssLine.metrics([CssRun(text: "가", size: TextScale(.large)(17))])
        let xxx = CssLine.metrics([CssRun(text: "가", size: TextScale(.extraExtraExtraLarge)(17))])
        #expect(large.ascent + large.descent == 22, "WebKit's 17 px line box")
        #expect(xxx.ascent + xxx.descent > 22)
        #expect(TextScale(.extraExtraExtraLarge).factor > 1.3)
    }

    static func content(_ page: String, catalog: String, width: CGFloat, height: CGFloat? = nil) throws -> WeatherPageContent {
        let manifest = try References.json("forecast-captures.json")
        let fixture = page.hasPrefix("vc-london") ? "vc-london" : "kma-seoul"
        let place = try #require(manifest["places"]?[fixture]?.objectValue)
        let converted = try #require(try WeatherConverter.convert(References.json("forecast-\(fixture).input.json")))
        var record = JSONObject()
        for (k, v) in converted where Js.truthy(v) { record[k] = v }
        for key in ["name", "address", "country", "location"] { record[key] = place[key] }
        let c = Catalog(code: catalog)
        var scope = ForecastScope(type: page.contains("daily") ? .mid : .short,
                                  metrics: ChartMetrics(bodyWidth: width, bodyHeight: height ?? (width > 900 ? 1024 : 852)),
                                  fahrenheit: false, photoTheme: false,
                                  yesterday: YesterdayText(same: c("LOC_SAME_AS_YESTERDAY"), than: c("LOC_THAN_YESTERDAY")),
                                  expandShortChart: true)
        scope.open(record, enabledCount: 2, hasPush: false)
        let units = PageUnits(temperature: "C", windSpeed: "m/s", pressure: "hPa", distance: "km", precipitation: "mm", air: "airkorea")
        return WeatherPageContent(scope: scope, units: units, texts: WeatherScreens.texts(c))
    }
}
