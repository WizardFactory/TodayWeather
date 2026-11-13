import Foundation
import Testing
import TWDomain
import TWModel
import TWResources

/// The chart scenes against the charts the Cordova app drew (port of Kotlin `ChartSceneTest`): every SVG element with
/// its class, attributes and text, the header labels, the legend and the opening scroll offsets, for every captured
/// fixture and size.
///
/// - `ChartReference/android/<WxH>/`: the scenes of the Cordova Android build (android/tools/chart-reference, copied
///   by ios/tools/import_chart_reference.py), built here with the Android metrics (`iOS: false`).
/// - `ChartReference/ios/<WxH>/`: the scenes of the Cordova iOS build on iOS Simulators (ios/tools/chart-reference),
///   built with the iOS metrics.
struct ChartSceneTests {
    /// Positions in the captures went through the browser's layout (1/64 px in WebKit, 1/128 px in Chrome) and
    /// attribute printing.
    static let tolerance = 0.02

    @Test func scenesMatchTheCordovaAndroidCharts() throws {
        let compared = try compare(platform: "android", iOS: false)
        #expect(compared.sizes == ["360x780", "384x832", "412x892"])
        #expect(compared.count == 15, "fixtures x sizes")
    }

    @Test func scenesMatchTheCordovaIOSCharts() throws {
        let compared = try compare(platform: "ios", iOS: true)
        #expect(compared.sizes == ["375x667", "393x852", "440x956"])
        #expect(compared.count == 15, "fixtures x sizes")
    }

    @Test func iOSMetricsSubtractTheStatusBar() {
        // initSize: contentHeight -= 20 on iOS. Phones are bound by the width (bodyWidth * 0.8 / 4) either way; a
        // landscape iPad (1024x768) is bound by the height, where the status bar counts.
        for (w, h) in [(375.0, 667.0), (393, 852), (440, 956)] {
            #expect(ChartMetrics(bodyWidth: w, bodyHeight: h).bigFontSize == w * 0.8 / 4)
        }
        let ios = ChartMetrics(bodyWidth: 1024, bodyHeight: 768)
        let android = ChartMetrics(bodyWidth: 1024, bodyHeight: 768, iOS: false)
        #expect(abs(ios.bigFontSize - (768 * 3 / 8 - 44 - 5 - 20 - 72) * 0.9) < 1e-9)
        #expect(android.bigFontSize == 142.1) // (768 * 3 / 8 - 44 - 5 - 72) * 0.9 = 150.3, capped
        #expect(ios.columnWidth == android.columnWidth)
    }

    private func compare(platform: String, iOS: Bool) throws -> (sizes: [String], count: Int) {
        let root = ChartReference.root.appendingPathComponent(platform, isDirectory: true)
        let sizes = try FileManager.default.contentsOfDirectory(atPath: root.path).filter { $0.contains("x") }.sorted()
        let texts = try ChartReference.texts("ko")
        var count = 0
        for size in sizes {
            let wh = size.split(separator: "x").map { Double($0)! }
            let dir = root.appendingPathComponent(size, isDirectory: true)
            let capture = try JSONValue.parse(Data(contentsOf: dir.appendingPathComponent("capture.json")))
            #expect(capture["env"]?["language"]?.stringValue == "ko-KR", "\(platform) \(size) language")
            for name in capture["fixtures"]?.arrayValue ?? [] {
                let fixture = try #require(name.stringValue)
                let record = try JSONValue.parse(Data(contentsOf: dir.appendingPathComponent("\(fixture).json")))
                let place = try #require(try WeatherConverter.convert(ChartReference.input(record)))
                let metrics = ChartMetrics(bodyWidth: wh[0], bodyHeight: wh[1], iOS: iOS)
                let at = "\(platform) \(size) \(fixture)"
                let hourly = try #require(HourlyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm", windUnit: "m/s"))
                checkHourly(hourly, try #require(record["hourly"]), at)
                let daily = try #require(DailyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm"))
                checkDaily(daily, try #require(record["daily"]), at)
                count += 1
            }
        }
        return (sizes, count)
    }

    private func checkHourly(_ chart: HourlyChart, _ captured: JSONValue, _ at: String) {
        SvgComparison.compare(chart.chart, captured["scene"], "\(at) hourly")
        SvgComparison.compare(chart.detail, captured["detailScene"], "\(at) detail")
        let days = captured["dayTitles"]?.arrayValue ?? []
        #expect(days.map { $0["text"]?.stringValue ?? "" } == chart.dayLabels.map(\.text), "\(at) day labels")
        for (e, a) in zip(days, chart.dayLabels) { SvgComparison.near(num(e["x"]), a.left, "\(at) day label \(a.text)") }
        #expect((captured["hourTitles"]?.arrayValue ?? []).map { $0["text"]?.stringValue ?? "" } == chart.hourLabels, "\(at) hour labels")
        #expect(captured["legend"]?["today"]?["text"]?.stringValue == chart.legendToday, "\(at) legend")
        #expect(captured["legend"]?["yesterday"]?["text"]?.stringValue == chart.legendYesterday, "\(at) legend")
        // scrollLeft is a whole CSS pixel in the capture.
        let left = num(captured["scroll"]?["left"])
        #expect(abs(left - chart.openingOffset) < 1, "\(at) opening offset \(chart.openingOffset) vs \(left)")
    }

    private func checkDaily(_ chart: DailyChart, _ captured: JSONValue, _ at: String) {
        SvgComparison.compare(chart.chart, captured["scene"], "\(at) daily")
        #expect((captured["dayNames"]?.arrayValue ?? []).map { $0["text"]?.stringValue ?? "" } == chart.dayNames, "\(at) day names")
        #expect((captured["dates"]?.arrayValue ?? []).map { $0["text"]?.stringValue ?? "" } == chart.dates, "\(at) dates")
        let left = num(captured["scroll"]?["left"])
        #expect(abs(left - chart.openingOffset) < 1, "\(at) opening offset \(chart.openingOffset) vs \(left)")
    }
}

/// The copied and captured Cordova charts, read from the test bundle.
enum ChartReference {
    static var root: URL { Bundle.module.resourceURL!.appendingPathComponent("ChartReference", isDirectory: true) }

    /// The response the capture showed: the corpus input, with the patch named in the record (capture.mjs and
    /// ios/tools/chart-reference/capture.js apply the same one).
    static func input(_ record: JSONValue) throws -> JSONValue {
        let from = try #require(record["from"]?.stringValue)
        let c = try Corpus.read("conversion/\(from).json")
        var input = try c["input"] ?? Corpus.read(#require(c["inputFile"]?.stringValue))
        if record["fixture"]?.stringValue == "kma-seoul-sharp" {
            let current = try #require(input["current"]?.objectValue).setting("liveTime", .string("2400"))
            input = .object(try #require(input.objectValue).setting("current", .object(current)))
        } else {
            #expect(record["patched"]?.boolValue == false, "unknown patch for \(record["fixture"]?.stringValue ?? "?")")
        }
        return input
    }

    /// The chart strings of an imported Cordova catalog, as the app reads them.
    static func texts(_ catalog: String) throws -> ChartTexts {
        let bundle = try #require(TWResources.strings(catalog: catalog))
        var strings: [String: String] = [:]
        for key in ChartTexts.keys {
            let value = bundle.localizedString(forKey: key, value: "\u{1}", table: nil)
            if value != "\u{1}" { strings[key] = value }
        }
        return ChartTexts(strings)
    }
}

private func num(_ v: JSONValue?) -> Double {
    switch v {
    case .number(let n): return n.double
    case .string(let s): return Double(s) ?? .nan
    default: return .nan
    }
}

/// Element-by-element comparison of a scene with a captured `<svg>` tree (tag, class and attributes as strings).
enum SvgComparison {
    static func compare(_ svg: Svg, _ captured: JSONValue?, _ at: String, sourceLocation: SourceLocation = #_sourceLocation) {
        guard let captured else { Issue.record("\(at): no captured scene", sourceLocation: sourceLocation); return }
        near(num(captured["width"]), svg.width, "\(at) svg width")
        near(num(captured["height"]), svg.height, "\(at) svg height")
        children(svg.children, captured["children"]?.arrayValue ?? [], at)
    }

    private static func children(_ nodes: [SvgNode], _ captured: [JSONValue], _ at: String) {
        guard nodes.count == captured.count else {
            Issue.record("\(at): element count \(nodes.count), captured \(captured.count) (\(captured.map { $0["tag"]?.stringValue ?? "?" }))")
            return
        }
        for (i, (node, e)) in zip(nodes, captured).enumerated() { compare(node, e, "\(at)/\(i)") }
    }

    private static func str(_ e: JSONValue, _ key: String) -> String? { e[key]?.stringValue }

    private static func compare(_ node: SvgNode, _ e: JSONValue, _ path: String) {
        let tag = str(e, "tag") ?? "?"
        let at = "\(path)<\(tag) \(str(e, "class") ?? "")>"
        func cls(_ expectedTag: String, _ value: String?) {
            #expect(tag == expectedTag, "\(at) tag")
            #expect(str(e, "class") == value, "\(at) class")
        }
        switch node {
        case .group(let g):
            cls("g", g.cls)
            children(g.children, e["children"]?.arrayValue ?? [], at)
        case .rect(let r):
            cls("rect", r.cls)
            near(num(e["x"]), r.x, "\(at) x"); near(num(e["y"]), r.y, "\(at) y")
            near(num(e["width"]), r.width, "\(at) width"); near(num(e["height"]), r.height, "\(at) height")
        case .line(let l):
            cls("line", l.cls)
            near(num(e["x1"]), l.x1, "\(at) x1"); near(num(e["y1"]), l.y1, "\(at) y1")
            near(num(e["x2"]), l.x2, "\(at) x2"); near(num(e["y2"]), l.y2, "\(at) y2")
        case .image(let m):
            cls("image", m.cls)
            #expect(str(e, "href") == m.href, "\(at) href")
            near(num(e["x"]), m.x, "\(at) x"); near(num(e["y"]), m.y, "\(at) y")
            near(num(e["width"]), m.width, "\(at) width"); near(num(e["height"]), m.height, "\(at) height")
            let transform = str(e, "transform")
            if let r = m.rotation {
                guard let t = transform, t.hasPrefix("rotate("), t.hasSuffix(")") else {
                    Issue.record("\(at): transform \(transform ?? "absent")"); return
                }
                let parts = t.dropFirst(7).dropLast().components(separatedBy: ", ").map { Double($0) ?? .nan }
                #expect(parts.count == 3, "\(at) transform \(t)")
                if parts.count == 3 {
                    near(parts[0], r.angle, "\(at) angle"); near(parts[1], r.cx, "\(at) cx"); near(parts[2], r.cy, "\(at) cy")
                }
            } else {
                #expect(transform == nil, "\(at) transform")
            }
        case .text(let t):
            cls("text", t.cls)
            near(num(e["x"]), t.x, "\(at) x")
            if let y = t.y { near(num(e["y"]), y, "\(at) y") } else { #expect(e["y"] == nil, "\(at) y") }
            if let dy = t.dy { near(num(e["dy"]), dy, "\(at) dy") } else { #expect(e["dy"] == nil, "\(at) dy") }
            #expect(str(e, "text") == t.text, "\(at) text")
            let tspans = e["tspans"]?.arrayValue ?? []
            #expect(tspans.count == (t.tspan == nil ? 0 : 1), "\(at) tspans")
            if let s = tspans.first, let tspan = t.tspan {
                #expect(str(s, "text") == tspan.text, "\(at) tspan text")
                #expect(str(s, "class") == tspan.cls, "\(at) tspan class")
                #expect(str(s, "font-size") == tspan.fontSizeAttr, "\(at) tspan font-size")
            }
        case .path(let p):
            cls("path", p.cls)
            var d = str(e, "d") ?? ""
            if d.hasPrefix("M") { d.removeFirst() }
            if d.hasSuffix("Z") { d.removeLast() }
            let points = d.components(separatedBy: "L").map { p -> (Double, Double) in
                let xy = p.components(separatedBy: ",").map { Double($0) ?? .nan }
                return (xy.first ?? .nan, xy.count > 1 ? xy[1] : .nan)
            }
            #expect(points.count == p.points.count, "\(at) points")
            for (i, (a, b)) in zip(points, p.points).enumerated() {
                near(a.0, b.x, "\(at) point \(i) x"); near(a.1, b.y, "\(at) point \(i) y")
            }
        case .circle(let c):
            cls("circle", c.cls)
            near(num(e["cx"]), c.cx, "\(at) cx"); near(num(e["cy"]), c.cy, "\(at) cy"); near(num(e["r"]), c.r, "\(at) r")
        }
    }

    /// Within the tolerance; NaN (a JavaScript NaN or undefined, or an absent attribute) only equals NaN.
    static func near(_ expected: Double, _ actual: Double, _ what: String) {
        if expected.isNaN || actual.isNaN {
            #expect(expected.isNaN == actual.isNaN, "\(what): expected \(expected), got \(actual)")
            return
        }
        #expect(abs(expected - actual) <= ChartSceneTests.tolerance, "\(what): expected \(expected), got \(actual)")
    }
}
