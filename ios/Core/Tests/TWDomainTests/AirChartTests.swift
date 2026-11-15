import Foundation
import Testing
import TWDomain
import TWModel

/// AirChart against the SVG ngAirChart drew on the Cordova iOS build in the captured S05 states (AirReference/<state>.json,
/// IN-09 #2958): every tick, label, date and bar within 0.02 pt, with the grade fills; then D3's rules the captures do
/// not reach. Port of the Android `AirChartTest`.
struct AirChartTests {
    let tolerance = 0.02

    @Test func scenesMatchTheCordovaCharts() throws {
        var compared = 0
        for state in AirPageTests.states {
            let chart = try AirPageTests.record(state)["chart"]
            let scope = try AirPageTests.scope(state)
            guard let chart, !chart.isNull else {
                #expect(AirPage(scope: scope, texts: AirPageTests.ko).chartTitle == nil, "\(state): no chart")
                continue
            }
            let series = try #require(scope.airChart, "\(state): series")
            let scene = AirChart.build(series, standard: scope.standard, hour: AirPageTests.ko["LOC_HOUR"],
                                       width: double(chart["rect"]?["w"]), height: double(chart["rect"]?["h"]))
            try compare(scene, try #require(chart["scene"]), state)
            compared += 1
        }
        #expect(compared == 5)
    }

    @Test func theOrdinalScaleKeepsEachDateOnceAndTheBarsFollowTheSlots() {
        // A repeated date takes one band: 23 bands for 24 slots, and the bars still step by slot.
        let rows: [JSONValue?] = (0..<24).map { i in Self.row(String(format: "2026-11-08 %02d:00", i == 5 ? 4 : i), 10 + Double(i), 1) }
        let chart = AirChart.build(AirSeries(data: rows, maxValue: 250), standard: AirQuality.standard("airkorea"), hour: "시", width: 383)
        #expect(chart.ticks.count == 23)
        let band = (383.0 - 10) / 23
        near(5 + band / 2, chart.ticks.first?.x ?? .nan, "first tick")
        #expect(chart.bars.count == 24)
        near(band * 23 + 1 + 5, chart.bars.last?.x ?? .nan, "the last bar passes the last band")
        #expect(chart.ticks.dropFirst(12).first?.current == true, "the 13th date has the long line")
        #expect(chart.ticks.first?.label == "0시")
        #expect(chart.ticks.first?.date == "11.08")
        #expect(chart.ticks.dropFirst(1).first?.label == "")
        #expect(chart.ticks.dropFirst(3).first?.label == "3시")
    }

    @Test func withoutValuesTheScaleIsUndefinedAndNoBarShows() {
        let rows: [JSONValue?] = (0..<24).map { i in .object(JSONObject([("date", .string(String(format: "2026-11-08 %02d:00", i)))])) }
        let chart = AirChart.build(AirSeries(data: rows, maxValue: 250), standard: AirQuality.standard("airkorea"), hour: "시", width: 384)
        #expect(chart.bars.count == 24 && chart.bars.allSatisfy { $0.height == 0 && $0.y.isNaN }, "Math.max(250, undefined) is NaN: y(0) is NaN")
        #expect(chart.bars.allSatisfy { $0.fill == nil })
        // Null values count as 0: a bar of height 0 at the axis.
        let nulls: [JSONValue?] = rows.map { .object(($0?.objectValue ?? JSONObject()).setting("val", .null)) }
        let zero = AirChart.build(AirSeries(data: nulls, maxValue: 250), standard: AirQuality.standard("airkorea"), hour: "시", width: 384)
        #expect(zero.bars.count == 24 && zero.bars.allSatisfy { $0.y == 65 && $0.height == 0 })
    }

    @Test func aSlotTheApplyDidNotReachDrawsNothing() throws {
        var seoul = try AirPageTests.seoul()
        var list = try #require(seoul["airInfoList"]?.arrayValue)
        var first = try #require(list[0].objectValue)
        var last = try #require(first["last"]?.objectValue)
        last["dataTime"] = "2026-11-10 00:00"
        first["last"] = .object(last)
        list[0] = .object(first)
        seoul["airInfoList"] = .array(list)
        var scope = AirScope(metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), airUnit: "airkorea", zone: AirPageTests.seoulZone)
        scope.open(seoul, code: nil, enabledCount: 1, hasPush: false)
        let chart = AirChart.build(try #require(scope.airChart), standard: scope.standard, hour: "시", width: 393)
        #expect(chart.ticks.isEmpty)
        #expect(chart.bars.isEmpty)
        #expect(chart.domainStart == nil)
    }

    private static func row(_ date: String, _ value: Double, _ grade: Int) -> JSONValue? {
        .object(JSONObject([("date", .string(date)), ("val", .number(value)), ("grade", .number(grade))]))
    }

    private func compare(_ scene: AirChart, _ svg: JSONValue, _ at: String) throws {
        near(Double(s(svg["width"]) ?? "") ?? .nan, scene.width, "\(at) width")
        near(Double(s(svg["height"]) ?? "") ?? .nan, scene.height, "\(at) height")
        let children = svg["children"]?.arrayValue ?? []
        let axis = try #require(children.first)
        #expect(s(axis["class"]) == "x-axis", "\(at)")
        #expect(s(axis["transform"]) == "translate(0,\(Self.num(scene.bottom)))", "\(at) axis")
        let parts = axis["children"]?.arrayValue ?? []
        let ticks = parts.filter { s($0["class"]) == "tick" }
        #expect(ticks.count == scene.ticks.count, "\(at) ticks")
        for (i, (e, t)) in zip(ticks, scene.ticks).enumerated() {
            let w = "\(at) tick \(i)"
            let transform = s(e["transform"]) ?? ""
            let x = Double(transform.dropFirst("translate(".count).prefix { $0 != "," }) ?? .nan
            near(x, t.x, "\(w) x")
            let line = e["children"]?[0], text = e["children"]?[1]
            #expect(s(line?["y2"]) == "6", "\(w)")
            #expect(s(line?["y1"]) == (t.current ? Self.num(-scene.bottom) : nil), "\(w) long line")
            #expect(s(line?["stroke-width"]) == (t.current ? "2px" : nil), "\(w) stroke")
            #expect(s(text?["y"]) == "9" && s(text?["dy"]) == ".71em", "\(w)")
            #expect(sameText(s(text?["text"]), t.label), "\(w) label")
            let tspans = text?["tspans"]?.arrayValue ?? []
            #expect(sameText(tspans.count == 1 ? s(tspans[0]["text"]) : nil, t.date), "\(w) date")
            if let tspan = tspans.first {
                #expect(s(tspan["dy"]) == "1.065em" && s(tspan["x"]) == "0", "\(w) tspan")
            }
        }
        let domain = parts.first { s($0["class"]) == "domain" }
        #expect(s(domain?["d"]) == "M\(Self.num(scene.domainStart ?? .nan)),0V0H\(Self.num(scene.domainEnd ?? .nan))V0", "\(at) domain")
        let rects = Array(children.dropFirst())
        #expect(rects.count == scene.bars.count, "\(at) bars")
        for (i, (e, b)) in zip(rects, scene.bars).enumerated() {
            let w = "\(at) bar \(i)"
            #expect(s(e["class"]) == (b.current ? "chart-bar" : "chart-blurry-bar"), "\(w)")
            near(Double(s(e["x"]) ?? "") ?? .nan, b.x, "\(w) x")
            near(Double(s(e["y"]) ?? "") ?? .nan, b.y, "\(w) y")
            near(Double(s(e["width"]) ?? "") ?? .nan, b.width, "\(w) width")
            near(Double(s(e["height"]) ?? "") ?? .nan, b.height, "\(w) height")
            #expect(s(e["style"]) == b.fill.map { "fill: \(Self.rgb($0));" }, "\(w) fill")
        }
    }

    private func near(_ expected: Double, _ actual: Double, _ what: String) {
        if expected.isNaN || actual.isNaN {
            #expect(expected.isNaN == actual.isNaN, "\(what): expected \(expected), got \(actual)")
            return
        }
        #expect(abs(expected - actual) <= tolerance, "\(what): expected \(expected), got \(actual)")
    }

    /// A number as the SVG attribute prints it.
    private static func num(_ d: Double) -> String { d == d.rounded(.down) && abs(d) < 1e15 ? String(Int(d)) : String(d) }

    private static func rgb(_ hex: String) -> String {
        let v = Int(hex.dropFirst(), radix: 16) ?? 0
        return "rgb(\(v >> 16 & 255), \(v >> 8 & 255), \(v & 255))"
    }
}
