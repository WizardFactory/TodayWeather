import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import UIKit
@testable import TodayWeather

/// The IN-13 completion criterion on a simulator against production (read-only GETs): the nationwide weather in all
/// three modes, the nationwide air in all six tabs and the warnings render. Enabled by `TW_PRODUCTION_NATION` (passed as
/// `TEST_RUNNER_TW_PRODUCTION_NATION`) in an app built with the private `TW_SERVER_URL` (Info.plist `TWServerURL`);
/// otherwise skipped (CI). The requests go through the app's client (`URLSessionGet`) in the live shell, opened from the
/// menu rows; their paths (no host), the shown labels and cards and a snapshot of each state are written to the app's
/// `tmp/nation-production/`.
extension HostedShellTests {
@MainActor
struct ProductionNationTests {
    nonisolated static let enabled = ProcessInfo.processInfo.environment["TW_PRODUCTION_NATION"] != nil
        && !((Bundle.main.infoDictionary?["TWServerURL"] as? String) ?? "").isEmpty

    /// The app's client recording each request's path and outcome: the answer's JSON kind, or the failure
    /// (CODEX-IN13-2: an empty warnings list is a valid answer, a failed request is not).
    final class Outcomes: WeatherHTTP, @unchecked Sendable {
        private let lock = NSLock()
        private var log: [(path: String, outcome: String)] = []
        private let recording = ProductionAirTests.Recording()
        var paths: [String] { recording.paths }

        /// The outcomes of the requests whose path is `path`: `list`, `object`, `other json`, `not json` or `failed`.
        func outcomes(_ path: String) -> [String] { lock.withLock { log.filter { $0.path == path }.map(\.outcome) } }

        func get(_ url: URL, headers: [String: String]) async throws -> Data {
            do {
                let data = try await recording.get(url, headers: headers)
                let outcome: String
                switch try? JSONValue.parse(data) {
                case .array?: outcome = "list"
                case .object?: outcome = "object"
                case .some: outcome = "other json"
                case nil: outcome = "not json"
                }
                lock.withLock { log.append((url.path, outcome)) }
                return data
            } catch {
                lock.withLock { log.append((url.path, "failed")) }
                throw error
            }
        }
    }

    @Test(.enabled(if: enabled)) func theNationwidePagesAndTheWarningsRender() async throws {
        let server = try #require(Bundle.main.infoDictionary?["TWServerURL"] as? String)
        let http = Outcomes()
        let shell = ShellFixture.shell(languages: ["ko-KR"])
        let nation = NationScreens(shell: shell, source: NationSource(baseURL: server, http: http))
        let hosted = try HostedView(ShellView(model: shell, page: nation.pageView), size: CGSize(width: 393, height: 852))
        defer { hosted.close() }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("nation-production", isDirectory: true)
        try? FileManager.default.removeItem(at: out)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        var summary: [String] = []

        func open(_ row: MenuRow) async throws {
            shell.openMenu()
            #expect(try await hosted.menuInPlace())
            try hosted.tap("shell-menu-\(row.rawValue)")
            for _ in 0..<300 where nation.loading { try await hosted.settle(100) }
            try await hosted.settle(800)
            #expect(!nation.loading, "\(row): the answer came")
        }
        func record(_ name: String) throws {
            try snapshot(hosted, out.appendingPathComponent("\(name).png"))
            let labels = nation.content.labels.map { l in
                "\(l.name)[\(l.icon ?? "")|\(l.lines.map { $0.text + $0.unit }.joined(separator: " "))|\(l.background)]"
            }
            summary.append("\(name): " + labels.joined(separator: " "))
        }

        // S10 in its three modes.
        try await open(.nationalWeather)
        #expect(nation.response != nil, "S10 loaded")
        #expect((nation.response?.weather.count ?? 0) > 0)
        for mode in Nationwide.Mode.allCases {
            try hosted.tap("nation-mode-\(mode.rawValue)")
            try await hosted.settle(500)
            #expect(nation.mode == mode)
            let labels = nation.content.labels
            #expect(labels.count == Nationwide.weatherCities.count)
            #expect(labels.contains { !$0.lines.isEmpty }, "S10 mode \(mode.rawValue): values shown")
            if mode != .wind { #expect(labels.contains { $0.icon != nil }, "S10 mode \(mode.rawValue): icons shown") }
            #expect(hosted.element("nation-label-서울") != nil)
            try record("nation-mode-\(mode.rawValue)")
        }
        try hosted.tap("nation-back")
        try await hosted.settle()

        // S11 in its six tabs.
        try await open(.nationalAir)
        #expect((nation.response?.air.count ?? 0) > 0, "S11 loaded")
        for type in Nationwide.airTypes {
            try hosted.tap("nation-tab-\(type)")
            try await hosted.settle(500)
            #expect(nation.airType == type)
            let labels = nation.content.labels
            #expect(labels.count == Nationwide.airCities.count)
            #expect(labels.contains { !$0.lines.isEmpty }, "S11 \(type): values shown")
            #expect(labels.contains { $0.background != Nationwide.noGrade }, "S11 \(type): grade colors shown")
            try record("nation-air-\(type)")
        }
        try hosted.tap("nation-back")
        try await hosted.settle()

        // S12: the cards with each section's time (an empty list is a valid answer: no warning in force).
        try await open(.specialWeather)
        for _ in 0..<50 where nation.cards.isEmpty { try await hosted.settle(100) }
        try snapshot(hosted, out.appendingPathComponent("warnings.png"))
        for _ in 0..<50 where http.outcomes("/v000903/kma/special").isEmpty { try await hosted.settle(100) }
        let cards = nation.cards
        summary.append("warnings: \(cards.count) cards, answer \(http.outcomes("/v000903/kma/special"))")
        // The request answered with a list (empty when no warning is in force); a failure or a timeout leaves no card
        // either, so the cards alone do not tell (CODEX-IN13-2).
        #expect(http.outcomes("/v000903/kma/special") == ["list"], "the warnings request answered with a list")
        summary += cards.map { "  \($0.heading) | \($0.situations.map(\.title).joined(separator: ", ")) | note \($0.note)" }
        #expect(cards.allSatisfy { !$0.heading.contains("Invalid Date") }, "each section's time")
        if let first = cards.first { #expect(hosted.element("nation-card-0") != nil, "\(first.heading) drawn") }
        try hosted.tap("nation-back")
        try await hosted.settle()

        summary += ["requests (\(http.paths.count)):"] + http.paths
        try (summary.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("run.txt"), atomically: true, encoding: .utf8)
        print("NATION-PRODUCTION \(out.path)\n" + summary.joined(separator: "\n"))
        // Read-only GETs: per nationwide opening `_getHttp`'s attempts (a second one 2 s after the first while no answer
        // came, a third at 4 s; the first run sent two per opening), and one for the warnings.
        let nationGets = http.paths.filter { $0.hasPrefix("GET /v000903/nation/KR?") }.count
        #expect((2...6).contains(nationGets), "\(nationGets) nation attempts for two openings")
        #expect(http.paths.filter { $0 == "GET /v000903/kma/special" }.count == 1)
        #expect(http.paths.count == nationGets + 1, "nothing else")
    }

    private func snapshot(_ hosted: HostedView, _ url: URL) throws {
        let renderer = UIGraphicsImageRenderer(bounds: hosted.window.bounds)
        let image = renderer.image { _ in hosted.window.drawHierarchy(in: hosted.window.bounds, afterScreenUpdates: true) }
        try #require(image.pngData()).write(to: url)
    }
}
}
