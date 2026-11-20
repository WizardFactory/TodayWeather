import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import UIKit
@testable import TodayWeather

/// Timings from in-process actions to the hosted accessibility tree on a Release simulator.
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["TW_PROFILE_PHASES"] == "1"))
@MainActor
struct ResponsivenessPhaseTests {
    private func sample(_ name: String, _ batch: Int, _ run: Int, since start: Double, at end: Double) {
        print("TW_SAMPLE,\(batch),\(run),\(name),\((end - start) * 1000),true")
    }

    private func observed(_ view: HostedView, _ predicate: () -> Bool) async throws -> Double {
        let deadline = ProcessInfo.processInfo.systemUptime + 5
        repeat {
            try await view.settle(8)
            if predicate() { return ProcessInfo.processInfo.systemUptime }
        } while ProcessInfo.processInfo.systemUptime < deadline
        throw PhaseError.missingState
    }

    enum PhaseError: Error { case missingState }

    @Test func drawer() async throws {
        let fixture = HostedShellTests.SettingsTests.Fixture()
        let view = try HostedView(fixture.view(), size: CGSize(width: 393, height: 852))
        defer { view.close() }
        for batch in 0...2 {
            for run in 1...(batch == 0 ? 1 : 10) {
                try await view.settle(300)
                let open = try #require(view.element("shell-menu-button"))
                let start = ProcessInfo.processInfo.systemUptime
                try #require(open.accessibilityActivate())
                var firstX: CGFloat = 0
                let moving = try await observed(view) {
                    guard let back = view.element("shell-menu-back") else { return false }
                    firstX = back.accessibilityFrame.minX
                    return firstX > 5 - 393 + 0.5
                }
                let ready = try await observed(view) {
                    guard let back = view.element("shell-menu-back") else { return false }
                    return back.accessibilityFrame.minX >= 4.9 && view.element("shell-menu-units") != nil
                }
                try view.tap("shell-menu-units")
                _ = try await observed(view) { view.element("settings-row-temperatureUnit") != nil }
                try view.tap("settings-back")
                _ = try await observed(view) { view.element("settings-back") == nil && !fixture.shell.menuOpen }
                print("TW_DRAWER_FRAME," + String(batch) + "," + String(run) + "," + String(Double(firstX)))
                sample("drawer-first-displacement", batch, run, since: start, at: moving)
                sample("drawer-settled", batch, run, since: start, at: ready)
            }
        }
    }

    @Test func places() async throws {
        let word = "부산"
        let search = TestPlaceSearch([word: [Prediction(fullText: "부산 fixture", firstMatch: 0)]])
        let fixture = try PlacesFixture(places: [.currentPositionPlaceholder, PlacesFixture.seoul], search: search)
        let places = fixture.places
        places.query.predictionDelay = .milliseconds(300)
        let view = try await fixture.hosted()
        defer { view.close() }
        places.focusChanged(true)
        for batch in 0...2 {
            for run in 1...(batch == 0 ? 1 : 10) {
                places.wordChanged("")
                _ = try await observed(view) { view.element("places-town-0") == nil && view.element("places-prediction-0") == nil }
                let count = search.words.count
                let start = ProcessInfo.processInfo.systemUptime
                places.wordChanged(word)
                let local = try await observed(view) {
                    places.query.word == word && view.element("places-town-9") != nil
                }
                sample("first-ten", batch, run, since: start, at: local)
                let more = ProcessInfo.processInfo.systemUptime
                places.query.moreTowns()
                let page = try await observed(view) { view.element("places-town-19") != nil }
                sample("next-ten", batch, run, since: more, at: page)
                let prediction = try await observed(view) {
                    places.query.predictions?.word == word && view.element("places-prediction-0") != nil
                }
                try #require(search.words.count == count + 1 && search.words.last == word)
                sample("prediction", batch, run, since: start, at: prediction)
            }
        }
    }

    private actor Responses: WeatherHTTP {
        let map: Data
        let warnings: Data
        var completed: [Double] = []
        init() throws {
            map = try NationFixtures.body("nation")
            warnings = try NationFixtures.body("special")
        }
        func get(_ url: URL, headers: [String: String]) async throws -> Data {
            try await Task.sleep(for: .milliseconds(250))
            completed.append(ProcessInfo.processInfo.systemUptime)
            return url.path.hasSuffix("/special") ? warnings : map
        }
    }

    @Test func nation() async throws {
        let server = try Responses()
        let shell = ShellFixture.shell(languages: ["ko-KR"])
        let nation = NationScreens(shell: shell, source: NationSource(baseURL: "https://fixture.invalid", http: server))
        let view = try HostedView(ShellView(model: shell, page: nation.pageView), size: CGSize(width: 393, height: 852))
        defer { view.close() }
        for (row, destination) in [(MenuRow.nationalWeather, NationPage.nation), (.nationalAir, .nationAir), (.specialWeather, .warnings)] {
            let name = row.rawValue
            for batch in 0...2 {
                for run in 1...(batch == 0 ? 1 : 10) {
                    let count = await server.completed.count
                    let start = ProcessInfo.processInfo.systemUptime
                    shell.onMenuRow(row)
                    let route = try await observed(view) { view.element("nation-page-" + destination.rawValue) != nil }
                    let ready = try await observed(view) {
                        if destination == .warnings {
                            return nation.cards.count == 3 && view.element("nation-card-0") != nil
                        }
                        let seoul = nation.content.labels.first
                        return !nation.loading && nation.response != nil && seoul?.name == "서울"
                            && seoul?.lines.isEmpty == false && view.element("nation-label-서울") != nil
                    }
                    let responses = await server.completed
                    try #require(responses.count == count + 1)
                    sample(name + "-route", batch, run, since: start, at: route)
                    sample(name + "-response", batch, run, since: start, at: responses[count])
                    sample(name + "-content", batch, run, since: start, at: ready)
                    let back = ProcessInfo.processInfo.systemUptime
                    try view.tap("nation-back")
                    let returned = try await observed(view) { nation.page == nil && view.element("shell-menu-button") != nil }
                    sample(name + "-back", batch, run, since: back, at: returned)
                }
            }
        }
    }
}
