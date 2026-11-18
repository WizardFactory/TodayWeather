import CoreText
import Testing
@testable import TodayWeather

@MainActor
struct HourlyChartTextCacheTests {
    @Test func reusesOnlyMatchingTextAndStyle() {
        let cache = HourlyChartTextCache()
        let ink = CssColor(0x444444)
        let runs = [("12", 15.0), ("°", 10.0)]
        let line = cache.line(runs, color: ink)
        #expect(line === cache.line(runs, color: ink))
        #expect(line !== cache.line([("13", 15), ("°", 10)], color: ink))
        #expect(line !== cache.line([("12", 15), ("°", 15)], color: ink))
        #expect(line !== cache.line([("°", 10), ("12", 15)], color: ink))
        #expect(line !== cache.line(runs, color: CssColor(0x444444, alpha: 0.5)))

        let header = cache.header("오전 9시", size: 17, color: ink)
        #expect(header.line === cache.line([("오전 9시", 17)], color: ink))
        #expect(header.ascent == CssText.metrics("오전 9시", size: 17).ascent)
    }

    @Test func evictsOldLabelsAndKeepsNewOnesLocalToTheChart() {
        let cache = HourlyChartTextCache()
        let ink = CssColor(0)
        let first = cache.line([("first", 15)], color: ink)
        for hour in 1...255 {
            _ = cache.line([("label-\(hour)", 15)], color: ink)
        }
        #expect(first === cache.line([("first", 15)], color: ink))
        let newest = cache.line([("new", 15)], color: ink)
        #expect(first !== cache.line([("first", 15)], color: ink))
        #expect(newest === cache.line([("new", 15)], color: ink))
        #expect(newest !== HourlyChartTextCache().line([("new", 15)], color: ink))
    }
}
