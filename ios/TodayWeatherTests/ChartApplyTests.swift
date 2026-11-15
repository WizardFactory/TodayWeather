import Observation
import SwiftUI
import Testing
import TWDomain
import TWModel
import UIKit
@testable import TodayWeather

/// The charts return to the opening position on every apply, as Cordova's `applyWeatherData` sets `scrollLeft` after
/// each apply (controller.forecastctrl.js), and keep the position when the hourly expander toggles (`clickExpander`
/// only switches `expand`). One view instance stays in a window while the model changes, as on the forecast page.
@MainActor
struct ChartApplyTests {
    /// What a forecast page gives the charts: the built charts, the expander state and the count of applies.
    @Observable
    final class Model {
        var hourly: HourlyChart
        var daily: DailyChart
        var expanded = true
        var applyCount = 0

        init(hourly: HourlyChart, daily: DailyChart) {
            self.hourly = hourly
            self.daily = daily
        }
    }

    struct Host: View {
        let model: Model
        let daily: Bool

        var body: some View {
            if daily {
                DailyChartView(chart: model.daily, applyCount: model.applyCount)
            } else {
                HourlyChartView(chart: model.hourly, expanded: model.expanded, applyCount: model.applyCount)
            }
        }
    }

    static let width = 393.0

    private static func place() throws -> JSONObject {
        try #require(try WeatherConverter.convert(References.json("kma-seoul.input.json")))
    }

    private static func charts(_ place: JSONObject) throws -> (HourlyChart, DailyChart) {
        let metrics = ChartMetrics(bodyWidth: width, bodyHeight: 852)
        let texts = ChartTexts.catalog("ko")
        return (try #require(HourlyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm", windUnit: "m/s")),
                try #require(DailyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm")))
    }

    /// Another weather for the same place: other current and daily temperatures, the same opening offsets.
    private static func otherWeather(_ place: JSONObject) throws -> JSONObject {
        let current = try #require(place["currentWeather"]?.objectValue)
        var dayCharts = try #require(place["dayChart"]?.arrayValue)
        let first = try #require(dayCharts.first?.objectValue)
        dayCharts[0] = .object(first.setting("temp", .number(Js.number(first["temp"]) + 3)))
        return place.setting("currentWeather", .object(current.setting("t1h", .number(Js.number(current["t1h"]) + 3))))
            .setting("dayChart", .array(dayCharts))
    }

    /// The captured Cordova `scrollLeft` at the opening position (393x852).
    private static func capturedOpening(_ chart: String) throws -> Double {
        try #require(References.json("captures.json")["sizes"]?["393x852"]?[chart]?["positions"]?["opening"]?["scrollLeft"]?
            .numberValue?.double)
    }

    @MainActor private final class Window {
        let window: UIWindow
        let host: UIViewController

        @MainActor init(_ view: some View) throws {
            let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: ChartApplyTests.width, height: 900)
            host = UIHostingController(rootView: view.frame(width: ChartApplyTests.width).frame(maxHeight: .infinity, alignment: .top))
            window.rootViewController = host
            window.isHidden = false
        }

        @MainActor var scroll: UIScrollView? { Self.find(host.view) }

        @MainActor private static func find(_ view: UIView) -> UIScrollView? {
            if let s = view as? UIScrollView { return s }
            for sub in view.subviews { if let s = find(sub) { return s } }
            return nil
        }
    }

    /// Offsets are compared within half a device pixel at scale 3 (UIKit keeps them on device pixels).
    private static func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1.0 / 6 }

    /// Waits up to 5 s for the offset to reach `target`, then returns the offset.
    private func offset(_ w: Window, reaching target: Double) async throws -> Double {
        for _ in 0..<50 {
            if let x = w.scroll?.contentOffset.x, Self.near(x, target) { return x }
            try await Task.sleep(for: .milliseconds(100))
        }
        return try #require(w.scroll).contentOffset.x
    }

    /// Opens the view, waits for the opening position and lets the first layout settle.
    private func opened(_ w: Window, at opening: Double) async throws {
        let x = try await offset(w, reaching: opening)
        #expect(Self.near(x, opening), "opens at \(x), Cordova at \(opening)")
        try await Task.sleep(for: .milliseconds(500))
        #expect(w.scroll.map { Self.near($0.contentOffset.x, opening) } == true, "stays at the opening position")
    }

    /// Scrolls to the end as a user would, and returns the end offset.
    private func scrollToEnd(_ w: Window) async throws -> Double {
        let scroll = try #require(w.scroll)
        let end = scroll.contentSize.width - scroll.bounds.width
        #expect(end > 0)
        scroll.setContentOffset(CGPoint(x: end, y: 0), animated: false)
        try await Task.sleep(for: .milliseconds(500))
        #expect(Self.near(scroll.contentOffset.x, end), "stays at the end (\(scroll.contentOffset.x), \(end)) until the next apply")
        return end
    }

    @Test(arguments: [false, true])
    func anotherWeatherWithTheSameOpeningScrollsBack(daily: Bool) async throws {
        let place = try Self.place()
        let (hourly, dailyChart) = try Self.charts(place)
        let model = Model(hourly: hourly, daily: dailyChart)
        let w = try Window(Host(model: model, daily: daily))
        defer { w.window.isHidden = true }
        let opening = try Self.capturedOpening(daily ? "daily" : "hourly")
        try await opened(w, at: opening)
        _ = try await scrollToEnd(w)

        let (otherHourly, otherDaily) = try Self.charts(try Self.otherWeather(place))
        #expect(otherHourly.openingOffset == hourly.openingOffset && otherDaily.openingOffset == dailyChart.openingOffset)
        model.hourly = otherHourly
        model.daily = otherDaily
        model.applyCount += 1
        let x = try await offset(w, reaching: opening)
        #expect(Self.near(x, opening), "\(daily ? "daily" : "hourly"): after the apply at \(x), Cordova at \(opening)")
    }

    @Test(arguments: [false, true])
    func reapplyingTheSameDataScrollsBack(daily: Bool) async throws {
        let (hourly, dailyChart) = try Self.charts(try Self.place())
        let model = Model(hourly: hourly, daily: dailyChart)
        let w = try Window(Host(model: model, daily: daily))
        defer { w.window.isHidden = true }
        let opening = try Self.capturedOpening(daily ? "daily" : "hourly")
        try await opened(w, at: opening)
        _ = try await scrollToEnd(w)

        model.applyCount += 1 // the same charts, applied again (a refresh with unchanged data)
        let x = try await offset(w, reaching: opening)
        #expect(Self.near(x, opening), "\(daily ? "daily" : "hourly"): after the apply at \(x), Cordova at \(opening)")
    }

    @Test func expanderKeepsThePosition() async throws {
        let (hourly, daily) = try Self.charts(try Self.place())
        let model = Model(hourly: hourly, daily: daily)
        let w = try Window(Host(model: model, daily: false))
        defer { w.window.isHidden = true }
        let opening = try Self.capturedOpening("hourly")
        try await opened(w, at: opening)
        let end = try await scrollToEnd(w)

        for expanded in [false, true] {
            model.expanded = expanded
            try await Task.sleep(for: .milliseconds(800))
            #expect(w.scroll.map { Self.near($0.contentOffset.x, end) } == true, "expanded \(expanded): the position stays")
        }
    }
}
