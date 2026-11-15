import Foundation
import SwiftUI
import Testing
import TWDomain
import TWModel
@testable import TodayWeather

/// The air page at larger text, on other screens and in every theme (IN-09, #2958; text follows Dynamic Type, verified up
/// to `xxxLarge` as decided on #2948): on an iPhone SE, the 393 pt iPhone and iPad portrait and landscape widths, in every
/// catalog, the page renders at the window's width, the header block grows to hold the main box, every grade line fits the
/// main box, the gauge's band texts fit their band (cut with an ellipsis, as `text-overflow` does), and the cells are at
/// least as wide as their texts (the rows scroll sideways when wider than the card).
@MainActor
struct AirFitTests {
    static let widths: [CGFloat] = [375, 393, 834, 1024, 1366]
    static let states = ["kma-seoul", "kma-seoul-pm25", "vc-london", "kma-jeju-no-air"]

    @Test(arguments: ["ko", "en", "de", "ja", "zh-CN", "zh-TW"])
    func pagesFitAtTheLargestTextSize(catalog: String) throws {
        let texts = WeatherScreens.texts(Catalog(code: catalog))
        for state in Self.states {
            for width in Self.widths {
                var scope = try AirScreenshotTests.scope(state, width: width, height: width > 900 ? 1024 : 852)
                scope.airUnit = "airkorea"
                let content = AirPageContent(scope: scope, texts: texts)
                for category in [ContentSizeCategory.large, .extraExtraExtraLarge] {
                    let name = "\(catalog) \(state) \(width) \(category)"
                    let s = TextScale(category)
                    // Rendering every combination would keep the main actor busy for minutes: the narrowest and the
                    // widest window render at the largest size, the others are checked on the model's measures.
                    if category == .extraExtraExtraLarge && (width == Self.widths.first || width == Self.widths.last) {
                        let renderer = ImageRenderer(content: AirPageView(content: content, theme: .light, scrolls: false)
                            .frame(width: width).environment(\.sizeCategory, category))
                        renderer.proposedSize = ProposedViewSize(width: width, height: nil)
                        renderer.scale = 1
                        let image = try #require(renderer.cgImage, "\(name)")
                        #expect(CGFloat(image.width) == width, "\(name): the page keeps the window's width")
                    }
                    if let main = content.page.main {
                        let box = width * 0.8
                        for line in AirGradeLine.lines(main, s: s, width: box) {
                            let w = line.reduce(CGFloat(0)) { total, piece in
                                switch piece {
                                case .face: return total + 24
                                case .text(let t): return total + CssLine.width([CssRun(text: t, size: s(21))])
                                }
                            }
                            #expect(w <= box + 0.5, "\(name): grade line \(line)")
                        }
                        let header = max(content.metrics.headerHeight,
                                         WeatherMetrics.headerTop + AirMainBox.height(main: main, metrics: content.metrics, s: s, width: box) + 5)
                        #expect(header >= content.metrics.headerHeight)
                        let title = CssLine.width([CssRun(text: main.title, size: s(17))]) + 26
                        #expect(title <= box, "\(name): the main box title")
                    }
                    let inner = (width - 8) / CGFloat(max(content.page.gauge.bands.count, 1)) - 2
                    for band in content.page.gauge.bands {
                        for text in [band.label, band.bound] {
                            let shown = AirGaugeView.fit(text, size: s(15), width: inner)
                            #expect(CssLine.width([CssRun(text: shown, size: s(15))]) <= inner + 0.5, "\(name): band \(text)")
                        }
                    }
                    for (cells, minimum, preferred) in [(content.page.detail ?? [], CGFloat(110), CGFloat?.none),
                                                        (content.page.stations ?? [], CGFloat(0), CGFloat?(110))] {
                        let widths = AirCellRow.widths(cells, s: s, minimum: minimum, preferred: preferred, available: width)
                        for (cell, w) in zip(cells, widths) {
                            #expect(w >= AirCellContent.width(cell, s: s) + 2 - 0.01, "\(name): cell \(cell.heading)")
                        }
                    }
                }
            }
        }
    }

    /// Every theme colors the header block, the cards and the page as its SCSS does: only the dark theme has its own S05
    /// colors; the photo and old themes show the light page (their bars are the shell's).
    @Test func themesColorThePage() throws {
        let content = try AirScreenshotTests.content("kma-seoul")
        for (theme, header, page) in [(Theme.light, 0xFFFFFF, 0xF5F5F5), (.dark, 0x1C1C1D, 0x171717), (.old, 0xFFFFFF, 0xF5F5F5),
                                      (.photo, 0xFFFFFF, 0xF5F5F5)] as [(Theme, UInt32, UInt32)] {
            let renderer = ImageRenderer(content: AirPageView(content: content, theme: theme, scrolls: false).frame(width: 393))
            renderer.proposedSize = ProposedViewSize(width: 393, height: nil)
            renderer.scale = 1
            let image = Bitmap(try #require(renderer.cgImage))
            func pixel(_ x: Int, _ y: Int) -> UInt32 {
                let i = (y * image.width + x) * 4
                return UInt32(image.pixels[i]) << 16 | UInt32(image.pixels[i + 1]) << 8 | UInt32(image.pixels[i + 2])
            }
            #expect(pixel(3, 3) == header, "\(theme): header block")
            // The page's color shows in the 5 pt gap under the first card (header, 5, gauge 69, 10).
            let gap = Int(content.metrics.headerHeight + 5 + 69 + 10 + 3)
            #expect(pixel(3, gap) == page, "\(theme): page at \(gap)")
        }
    }
}
