import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// The weather page of the real screens (`WeatherScreens.content`) live in a window (IN-08 review): what the page does to
/// the chart's scroll position and to its sizes while it stays open. The server is the `WeatherTabTests` double.
@MainActor
@Suite(.serialized)
struct WeatherLiveTests {
    /// The shown page, read from the screens on every change, as the shell shows it.
    struct Live: View {
        let screens: WeatherScreens
        let tab: ShellTab

        var body: some View {
            screens.content(tab)?.page ?? AnyView(Color.clear)
        }
    }

    final class Window {
        let window: UIWindow
        let host: UIViewController

        @MainActor init(_ view: some View, size: CGSize) throws {
            let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            window = UIWindow(windowScene: scene)
            window.frame = CGRect(origin: .zero, size: size)
            host = UIHostingController(rootView: view)
            window.rootViewController = host
            window.isHidden = false
        }

        /// The hourly chart's scroll view: the one whose content is wider than itself.
        @MainActor var chartScroll: UIScrollView? { Self.find(host.view) }

        @MainActor private static func find(_ view: UIView) -> UIScrollView? {
            if let s = view as? UIScrollView, s.contentSize.width > s.bounds.width + 1 { return s }
            for sub in view.subviews { if let s = find(sub) { return s } }
            return nil
        }
    }

    /// Polls the main actor's state (no timing is asserted: the limit only ends a failing wait).
    private func eventually(_ seconds: Double = 30, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    /// CODEX-IN08-1: Cordova's `clickExpander` only switches `expand` and stores it. Saving `expandShortChart` through the
    /// holder must not apply the weather again: the chart keeps the user's scroll position and the visit's applies stay.
    @Test func theExpanderKeepsTheScrollPositionAndAppliesNothing() async throws {
        let f = WeatherTabTests.Fixture(WeatherTabTests.byPlace())
        f.screens.handle(.launch)
        #expect(await eventually { f.screens.scope?.currentWeather != nil && !f.screens.session.loadingSelected })
        let w = try Window(Live(screens: f.screens, tab: .forecast), size: CGSize(width: 393, height: 852))
        defer { w.window.isHidden = true }
        #expect(await eventually { w.chartScroll != nil })
        let scroll = try #require(w.chartScroll)
        try await Task.sleep(for: .milliseconds(500))
        let end = scroll.contentSize.width - scroll.bounds.width
        scroll.setContentOffset(CGPoint(x: end, y: 0), animated: false)
        try await Task.sleep(for: .milliseconds(300))
        let applies = try #require(f.screens.scope?.scrolls)
        let sessionApplies = f.screens.session.applies

        f.screens.toggleExpanded()
        #expect(await eventually { f.holder.state?.expandShortChart == true }, "`expandShortChart` is stored")
        try await Task.sleep(for: .milliseconds(800))
        #expect(f.screens.scope?.expand == true)
        #expect(f.screens.scope?.scrolls == applies, "no apply: \(f.screens.scope?.scrolls ?? -1) after \(applies)")
        #expect(f.screens.session.applies == sessionApplies, "no applyEvent")
        let x = try #require(w.chartScroll).contentOffset.x
        #expect(abs(x - end) < 1.0 / 6, "the chart keeps the user's position: \(x), was \(end)")

        // A real applyEvent (a tab tap reloads) still brings the chart back to today's position.
        f.shell.now = { 10_000 }
        f.shell.tapTab(.forecast)
        #expect(await eventually { (f.screens.scope?.scrolls ?? 0) > applies + 1 })
    }

    /// CODEX-IN08-2: the page's sizes follow the window, as Cordova's `initSize` takes them from the WebView's area: one
    /// live window of an iPad screen resizes to Split View's third and half and to a small Stage Manager window, at
    /// `xxxLarge`. After each resize the sizes are the window's, the temperature with the sky image and every summary
    /// line fit the main box (80 % of the width), and the page asks for no more than the window's width.
    @Test func theSizesFollowTheWindow() async throws {
        let screen = CGSize(width: 1024, height: 1366)
        let f = WeatherTabTests.Fixture(WeatherTabTests.byPlace(), screenSize: screen)
        f.screens.handle(.launch)
        #expect(await eventually { f.screens.scope?.currentWeather != nil && !f.screens.session.loadingSelected })
        let view = Live(screens: f.screens, tab: .forecast).environment(\.sizeCategory, .extraExtraExtraLarge)
        let w = try Window(view, size: screen)
        defer { w.window.isHidden = true }
        for size in [CGSize(width: 320, height: 1032), CGSize(width: 678, height: 1032), CGSize(width: 500, height: 600),
                     CGSize(width: 1024, height: 1366)] {
            w.window.frame = CGRect(origin: .zero, size: size)
            let followed = await eventually {
                f.screens.scope?.metrics.bodyWidth == Double(size.width) && f.screens.scope?.metrics.bodyHeight == Double(size.height)
            }
            #expect(followed, "\(size): the sizes are the window's, not \(String(describing: f.screens.scope?.metrics.bodyWidth))")
            let content = try #require(f.screens.pageContent)
            let hero = try #require(content.page.hero)
            let s = TextScale(.extraExtraExtraLarge)
            let big = content.metrics.bigFontSize
            let temperature = [CssRun(text: hero.temperature, size: big), CssRun(text: "˚", size: big / 2)]
            let row = CssLine.width(temperature) + content.metrics.bigImageSize
            let box = size.width * 0.8
            #expect(row <= box + 0.5, "\(size): the temperature row \(row) fits the main box \(box)")
            for text in [hero.summary] + (hero.summaryAir.map { [$0] } ?? []) {
                for line in SummaryLines.lines(text, size: s(21), width: box) {
                    let width = CssLine.width([CssRun(text: line, size: s(21))])
                    #expect(width <= box + 0.5, "\(size): summary line \(line)")
                }
            }
            try await Task.sleep(for: .milliseconds(300))
            let fitting = w.host.view.sizeThatFits(CGSize(width: size.width, height: .greatestFiniteMagnitude))
            #expect(fitting.width <= size.width + 0.5, "\(size): the page asks for \(fitting.width)")
        }
    }
}
