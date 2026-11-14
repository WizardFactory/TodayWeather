import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
@testable import TodayWeather

/// The native air page against the Cordova iOS page (#2958): every block of S05 in seven states, among them the states of
/// the Cordova manual's pages 10 to 12 with fixed data (회현동 on the overall index, after the 초미세먼지 cell, after the
/// second station; the page's end with the info and station cards), the overall index in the dark theme, ozone from a
/// link, 런던 as the second place and a place without air data (the grade scale only), captured at 393x852 pt and scale 3
/// by ios/tools/air-reference (`AirReference/<state>-<block>.png`). Each block is rendered alone with `ImageRenderer` at
/// the captured width and scale 3 from the same responses and taps and compared by the AN-05 metric; each passes within
/// the tolerance recorded in `AirReference/air-tolerances.json`. The header block is compared with the shell's header bar
/// over it, as captured. Renders and difference images go to `<tmp>/chart-compare/air-*`.
@MainActor
struct AirScreenshotTests {
    nonisolated static let states = ["kma-seoul", "kma-seoul-pm25", "kma-seoul-station-1", "kma-seoul-o3", "kma-seoul-dark",
                                     "vc-london", "kma-jeju-no-air"]

    @Test(arguments: states)
    func stateBlocksMatchTheCordovaPage(state: String) throws {
        let manifest = try References.json("air-captures.json")
        let tolerances = try References.json("air-tolerances.json")
        let entry = try #require(manifest["states"]?[state], "\(state) in air-captures.json")
        let scale = try #require(manifest["devicePixelRatio"]?.numberValue?.double)
        let content = try Self.content(state)
        let theme: Theme = state.hasSuffix("dark") ? .dark : .light
        var report: [String] = []
        for block in entry["blocks"]?.arrayValue ?? [] {
            let index = Int(block["index"]?.numberValue?.double ?? -1)
            let name = "\(state)-\(index)"
            let kind = content.blocks[index]
            let width = block["rect"]?["w"]?.numberValue?.double ?? 393
            let native = try render(Self.blockView(kind, content: content, theme: theme), width: width, scale: scale)
            let reference = try References.image(try #require(block["file"]?.stringValue))
            let diff = ImageDiff(native: native, reference: reference)
            try diff.write("air-\(name)")
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
        print("AIR-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// The scope of a captured state: the served responses converted and saved as capture.js `addPlace` saved them, the
    /// visit opened afresh with the link's pollutant, then the state's tap.
    static func scope(_ state: String, width: Double = 393, height: Double = 852) throws -> AirScope {
        var scope = AirScope(metrics: ChartMetrics(bodyWidth: width, bodyHeight: height), airUnit: "airkorea",
                             zone: try #require(TimeZone(identifier: "Asia/Seoul")))
        switch state {
        case "vc-london": scope.open(try city("vc-london"), code: nil, enabledCount: 2, hasPush: false)
        case "kma-jeju-no-air": scope.open(try city("kma-jeju"), code: nil, enabledCount: 3, hasPush: false)
        case "kma-seoul-o3": scope.open(try city("kma-seoul"), code: "o3", enabledCount: 1, hasPush: false)
        default: scope.open(try city("kma-seoul"), code: nil, enabledCount: 1, hasPush: false)
        }
        if state == "kma-seoul-pm25" { scope.setCode("pm25") }
        if state == "kma-seoul-station-1" { scope.setStation(1) }
        return scope
    }

    static func content(_ state: String) throws -> AirPageContent {
        AirPageContent(scope: try scope(state), texts: WeatherScreens.texts(Catalog(code: "ko")))
    }

    /// A place as capture.js saved it: its own fields, the converted response over them, then its mutations (연동: no
    /// stations and no observation).
    static func city(_ fixture: String) throws -> JSONObject {
        let manifest = try References.json("air-captures.json")
        let states = manifest["states"]?.objectValue ?? JSONObject()
        let place = try #require(states.compactMap { $0.value["places"]?.arrayValue }.flatMap { $0 }
            .first { $0["fixture"]?.stringValue == fixture }, "\(fixture) in air-captures.json")
        var city = JSONObject()
        for key in ["name", "address", "country", "location"] { if let v = place[key] { city[key] = v } }
        city["currentPosition"] = .bool(false)
        let converted = try #require(try WeatherConverter.convert(References.json("air-\(fixture).input.json")))
        for (k, v) in converted { city[k] = v }
        for m in place["mutations"]?.arrayValue ?? [] {
            let path = (m["path"]?.arrayValue ?? []).compactMap(\.stringValue)
            if path.count == 1 { city[path[0]] = nil }
            if path.count == 2, var inner = city[path[0]]?.objectValue {
                inner[path[1]] = nil
                city[path[0]] = .object(inner)
            }
        }
        return city
    }

    /// A block as the capture cut it: the header block with the shell's header bar over it (the place's title and the
    /// page's buttons, 5 pt of safe area above its 44 pt), the gauge alone (the `.air-std-table`, 4 pt in from the card's
    /// sides) on the card's color, the cards at their scroll start.
    static func blockView(_ block: AirBlock, content: AirPageContent, theme: Theme) -> AnyView {
        let colors = AirColors.of(theme)
        switch block {
        case .header:
            let bar = ShellColors.of(theme, tab: .air)
            return AnyView(ZStack(alignment: .top) {
                AirBlockView(block: .header, content: content, theme: theme)
                HeaderBar(colors: bar, title: content.page.title,
                          insets: ShellInsets(statusBar: 0, top: 5, bottom: 0, leading: 0, trailing: 0), onMenu: {}) {
                    WeatherBarActions(hasPush: content.page.hasPush, colors: bar)
                }
            })
        case .gauge:
            return AnyView(AirGaugeView(gauge: content.page.gauge, colors: colors, s: TextScale(.large))
                .background(colors.page.card.color))
        default:
            return AnyView(AirBlockView(block: block, content: content, theme: theme, scrolls: false).clipped())
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
