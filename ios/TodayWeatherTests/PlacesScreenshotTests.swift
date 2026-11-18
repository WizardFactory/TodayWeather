import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// S02 against the Cordova iOS build (#2960 AC4): the states of the Cordova manual's pages 13 (favorites), 14 (search
/// for 부산), 18 (edit) and 19 (location: the find-by-location result), and the list with an alarm's bell, in Korean and
/// English, captured at 393x852 pt and scale 3 by ios/tools/places-reference (`PlacesReference/places-<lang>-<state>.png`,
/// the WebView from its top to the tab bar). Each is rendered with `ImageRenderer` in the shell (the header bar with the
/// search field over the page) at the WebView's size and scale 3, from the same responses, and compared by the AN-05
/// metric within `PlacesReference/places-tolerances.json`; renders and differences go to `<tmp>/chart-compare/`. The rows'
/// boxes are also checked against the captured rects.
@MainActor
struct PlacesScreenshotTests {
    static let scale: CGFloat = 3
    static let insets = ShellInsets(statusBar: 0, top: 5, bottom: 34, leading: 0, trailing: 0)
    nonisolated static let states = ["favorites", "search", "list", "edit", "location"]
    nonisolated static let cases: [(String, String)] = ["ko-KR", "en-US"].flatMap { l in states.map { ($0, l) } }

    /// The page of a state over the captured responses: 서울 alone (favorites, search), then 서울, 부산광역시 and London
    /// with London's alarm (list, edit, location).
    static func fixture(_ state: String, language: String) async throws -> PlacesFixture {
        let places: [Place] = state == "favorites" || state == "search"
            ? [.currentPositionPlaceholder, PlacesFixture.seoul]
            : [.currentPositionPlaceholder, PlacesFixture.seoul, PlacesFixture.busan, PlacesFixture.london]
        let location = TestLocation(system: .authorizedWhenInUse, fixes: [Location(lat: 37.5665, long: 126.978)])
        let f = try PlacesFixture(places: places, selected: places.count - 1, records: state == "favorites" || state == "search" ? [] : [PlacesFixture.alarm(3)],
                                  location: location, languages: [language])
        f.shell.select(.search)
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.visits == 1 })
        await f.settle()
        #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.rows.dropFirst().allSatisfy { $0.temperature != nil } }, "the weather")
        switch state {
        case "search":
            f.places.focusChanged(true)
            f.places.wordChanged("부산")
            f.places.focusChanged(false)
        case "edit":
            f.places.modeTapped()
        case "location":
            f.places.focusChanged(true)
            f.places.focusChanged(false)
            f.places.findByLocation()
            await f.settle()
            #expect(await HostedShellTests.AirLiveTests.wait(5) { f.places.query.word == "회현동" })
        default:
            break
        }
        return f
    }

    @Test func thePlacesPageMatchesTheCordovaPage() async throws {
        let tolerances = try References.json("places-tolerances.json")
        var report: [String] = []
        for (state, language) in Self.cases {
            let f = try await Self.fixture(state, language: language)
            let places = f.places
            let view = ShellFrame(model: f.shell, insets: Self.insets, content: { places.content($0, live: false) })
                .frame(width: 393, height: 798)
                .environment(\.cssFallbackLanguage, "ko")
            let name = "\(language)-\(state)"
            let renderer = ImageRenderer(content: view.environment(\.sizeCategory, .large))
            renderer.scale = Self.scale
            let native = Bitmap(try #require(renderer.cgImage, "render"))
            let reference = try References.image("places-\(name).png")
            let diff = ImageDiff(native: native.top(reference.height), reference: reference)
            try diff.write("places-\(name)")
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
            // The status bar above the WebView: `applyIOSStatusBar('light', 'search')`, white.
            #expect(try References.image("places-\(name)-statusbar.png").rgb(x: 600, y: 20) == [255, 255, 255], "\(name) status bar")
        }
        print("PLACES-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// Every row's box where WebKit put it: the items' tops and heights, within half a point.
    @Test(arguments: ["list", "edit", "search"])
    func theRowsAreWhereTheCordovaPagePutThem(state: String) throws {
        let record = try References.json("places-ko-KR-\(state).json")
        let rows = record["rows"]?.arrayValue ?? []
        func n(_ v: JSONValue?, _ key: String) -> CGFloat { CGFloat(v?["rect"]?[key]?.numberValue?.double ?? .nan) }
        // The bar (49 pt with the 5 pt inset) then the list's first item 9 pt under it (10 pt and the shared border); in
        // search mode under 현재위치로 지역찾기.
        var y: CGFloat = state == "search" ? 49 + PlacesMetrics.findTop + PlacesMetrics.findHeight + PlacesMetrics.resultsTop
                                             : 49 + PlacesMetrics.listTop
        for row in rows {
            let item = row["item"]
            let className = item?["className"]?.stringValue ?? ""
            let height: CGFloat
            if className.contains("item-divider") {
                height = n(item, "h")
            } else if state == "search" {
                height = 22 + 2 * (PlacesMetrics.itemPadding + 1)
            } else if (row["temperature"]?.arrayValue ?? []).isEmpty {
                height = PlacesMetrics.switchCell + 2 * (PlacesMetrics.itemPadding + 1)
            } else {
                height = PlacesMetrics.image + 2 * (PlacesMetrics.itemPadding + 1)
            }
            #expect(abs(n(item, "y") - y) <= 0.5, "\(state) row at \(n(item, "y")) vs \(y)")
            #expect(abs(n(item, "h") - height) <= 0.5, "\(state) row height \(n(item, "h")) vs \(height)")
            #expect(n(item, "x") == PlacesMetrics.listInset && n(item, "w") == 393 - 2 * PlacesMetrics.listInset)
            y += height - 1
        }
    }
}
