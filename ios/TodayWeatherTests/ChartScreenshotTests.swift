import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import SwiftUI
import Testing
import TWDomain
import TWModel
import UniformTypeIdentifiers
@testable import TodayWeather

/// The SwiftUI charts against captures of the Cordova iOS build (gate G2, #2954): kma-seoul at 375x667, 393x852 and
/// 440x956 pt, the hourly and the daily chart at the opening position and both scroll ends
/// (`ChartReference/<WxH>-<chart>-<position>.png`, ios/tools/chart-reference). The native chart is rendered with
/// `ImageRenderer` at the capture's width, scroll offset and pixel scale, so the result does not depend on the
/// simulator model that runs the test. Each comparison passes within the tolerance recorded in
/// `ChartReference/tolerances.json`; renders and difference images go to `<tmp>/chart-compare/`.
@MainActor
struct ChartScreenshotTests {
    static let positions = ["opening", "start", "end"]

    @Test(arguments: ["375x667", "393x852", "440x956"])
    func chartsMatchTheCordovaCaptures(size: String) throws {
        let manifest = try References.json("captures.json")
        let tolerances = try References.json("tolerances.json")
        let entry = try #require(manifest["sizes"]?[size], "\(size) in captures.json")
        let wh = size.split(separator: "x").map { Double($0)! }
        let scale = try #require(entry["devicePixelRatio"]?.numberValue?.double)
        let place = try #require(try WeatherConverter.convert(References.json("kma-seoul.input.json")))
        let metrics = ChartMetrics(bodyWidth: wh[0], bodyHeight: wh[1])
        let texts = ChartTexts.catalog("ko")
        let hourly = try #require(HourlyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm", windUnit: "m/s"))
        let daily = try #require(DailyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm"))
        var report: [String] = []
        for chart in ["hourly", "daily"] {
            for position in Self.positions {
                let name = "\(size)-\(chart)-\(position)"
                let p = try #require(entry[chart]?["positions"]?[position], "\(name)")
                let left = try #require(p["scrollLeft"]?.numberValue?.double)
                let view: AnyView = chart == "hourly"
                    ? AnyView(HourlyChartFrame(chart: hourly, expanded: true, offset: left))
                    : AnyView(DailyChartFrame(chart: daily, offset: left))
                let native = try render(view, width: wh[0], scale: scale)
                let reference = try References.image(try #require(p["file"]?.stringValue))
                let diff = ImageDiff(native: native, reference: reference)
                try diff.write(name)
                report.append("\(name): strong \(diff.strong) mean \(diff.mean) height \(diff.heightDifference)")
                let limit = try #require(tolerances["cases"]?[name], "tolerance for \(name)")
                let margin = tolerances["margin"]
                let maxStrong = number(limit["strong"]) + number(margin?["strong"])
                let maxMean = number(limit["mean"]) + number(margin?["mean"])
                let maxHeight = number(limit["heightDifference"]) + number(margin?["heightDifference"])
                #expect(native.width == reference.width, "\(name) width")
                #expect(diff.strong <= maxStrong, "\(name) strong \(diff.strong)")
                #expect(diff.mean <= maxMean, "\(name) mean \(diff.mean)")
                #expect(abs(Double(diff.heightDifference)) <= maxHeight, "\(name) height \(diff.heightDifference)")
            }
        }
        print("CHART-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    private func number(_ v: JSONValue?) -> Double { v?.numberValue?.double ?? .nan }

    private func render(_ view: AnyView, width: Double, scale: Double) throws -> Bitmap {
        let renderer = ImageRenderer(content: view.frame(width: width))
        renderer.scale = scale
        renderer.proposedSize = ProposedViewSize(width: width, height: nil)
        return Bitmap(try #require(renderer.cgImage, "render"))
    }
}

/// The opening scroll position of the live views, in a window: the Cordova `scrollLeft` (floor of the opening offset).
@MainActor
struct ChartScrollTests {
    @Test(arguments: ["375x667", "393x852", "440x956"])
    func chartsOpenAtTheCordovaPosition(size: String) async throws {
        let manifest = try References.json("captures.json")
        let entry = try #require(manifest["sizes"]?[size])
        let wh = size.split(separator: "x").map { Double($0)! }
        let place = try #require(try WeatherConverter.convert(References.json("kma-seoul.input.json")))
        let metrics = ChartMetrics(bodyWidth: wh[0], bodyHeight: wh[1])
        let texts = ChartTexts.catalog("ko")
        let hourly = try #require(HourlyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm", windUnit: "m/s"))
        let daily = try #require(DailyChart.build(place: place, metrics: metrics, texts: texts, precipUnit: "mm"))
        for (chart, view) in [("hourly", AnyView(HourlyChartView(chart: hourly, expanded: true))), ("daily", AnyView(DailyChartView(chart: daily)))] {
            let expected = try #require(entry[chart]?["positions"]?["opening"]?["scrollLeft"]?.numberValue?.double)
            let offset = try await scrollOffset(view, width: wh[0])
            #expect(offset == expected, "\(size) \(chart): opens at \(offset), Cordova at \(expected)")
        }
    }

    @Test func expanderHidesTheDetailRows() throws {
        let place = try #require(try WeatherConverter.convert(References.json("kma-seoul.input.json")))
        let chart = try #require(HourlyChart.build(place: place, metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852),
                                                   texts: ChartTexts.catalog("ko"), precipUnit: "mm", windUnit: "m/s"))
        let open = HourlyChartLayout(chart, expanded: true), closed = HourlyChartLayout(chart, expanded: false)
        #expect(open.wrapperHeight - closed.wrapperHeight == chart.detail.height)
        // The captured wrapper (expanded) at 393x852; WebKit lays out on 1/64 pt, and the chart height is rounded.
        let captured = try #require(References.json("captures.json")["sizes"]?["393x852"]?["hourly"]?["wrapperHeight"]?.numberValue?.double)
        #expect(abs(open.wrapperHeight - captured) < 0.05, "\(open.wrapperHeight) vs \(captured)")
    }

    private func scrollOffset(_ view: AnyView, width: Double) async throws -> Double {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 900)
        let host = UIHostingController(rootView: view.frame(width: width).frame(maxHeight: .infinity, alignment: .top))
        window.rootViewController = host
        window.isHidden = false
        defer { window.isHidden = true }
        for _ in 0..<50 {
            try await Task.sleep(for: .milliseconds(100))
            if let scroll = Self.scrollView(in: host.view), scroll.contentOffset.x > 0 { return scroll.contentOffset.x }
        }
        return try #require(Self.scrollView(in: host.view)).contentOffset.x
    }

    private static func scrollView(in view: UIView) -> UIScrollView? {
        if let s = view as? UIScrollView { return s }
        for sub in view.subviews { if let s = scrollView(in: sub) { return s } }
        return nil
    }
}

/// The references bundled with the test target (ios/TodayWeatherTests/ChartReference).
enum References {
    static func url(_ name: String) throws -> URL {
        let bundle = Bundle(for: BundleToken.self)
        let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
        return try #require(bundle.url(forResource: base, withExtension: ext), "\(name) in the test bundle")
    }

    static func json(_ name: String) throws -> JSONValue { try JSONValue.parse(Data(contentsOf: url(name))) }

    static func image(_ name: String) throws -> Bitmap {
        let source = try #require(CGImageSourceCreateWithURL(try url(name) as CFURL, nil))
        return Bitmap(try #require(CGImageSourceCreateImageAtIndex(source, 0, nil)))
    }

    private final class BundleToken {}
}

/// An 8-bit sRGB RGBA copy of an image (color-matched from its own color space).
struct Bitmap {
    let width: Int
    let height: Int
    let pixels: [UInt8]
    let image: CGImage

    init(_ image: CGImage) {
        width = image.width
        height = image.height
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        data.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                                    bytesPerRow: image.width * 4, space: space,
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        pixels = data
        self.image = image
    }
}

/// The comparison metric of the Android chart screenshots (android/README.md, AN-05): `strong` is the share of pixels
/// whose largest RGB channel difference exceeds 64 after a 3x3 box blur of both images (shifts of a fraction of a
/// pixel and glyph rasterization stay below it; a missing or moved element does not); `mean` is the mean largest RGB
/// channel difference without blur (0-255); `heightDifference` is native minus Cordova height in pixels. Both images
/// are compared over their common area.
struct ImageDiff {
    let native: Bitmap
    let reference: Bitmap
    let strong: Double
    let mean: Double
    let heightDifference: Int
    let mask: [Bool]

    nonisolated(unsafe) static let directory = FileManager.default.temporaryDirectory.appendingPathComponent("chart-compare", isDirectory: true)

    private(set) var blurSeconds = 0.0
    private(set) var compareSeconds = 0.0

    init(native: Bitmap, reference: Bitmap, measure: Bool = false) {
        self.native = native
        self.reference = reference
        heightDifference = native.height - reference.height
        let w = min(native.width, reference.width), h = min(native.height, reference.height)
        let blurStart = measure ? ProcessInfo.processInfo.systemUptime : 0
        let a = Self.blur(native, w, h), b = Self.blur(reference, w, h)
        let compareStart = measure ? ProcessInfo.processInfo.systemUptime : 0
        blurSeconds = compareStart - blurStart
        var strongCount = 0, sum = 0
        var mask = [Bool](repeating: false, count: w * h)
        for y in 0..<h {
            let nativeRow = y * native.width * 4
            let referenceRow = y * reference.width * 4
            for x in 0..<w {
                let i = y * w + x
                let nativePixel = nativeRow + x * 4
                let referencePixel = referenceRow + x * 4
                var blurred = 0, plain = 0
                for c in 0..<3 {
                    blurred = max(blurred, abs(Int(a[i * 3 + c]) - Int(b[i * 3 + c])))
                    plain = max(plain, abs(Int(native.pixels[nativePixel + c]) - Int(reference.pixels[referencePixel + c])))
                }
                if blurred > 64 { strongCount += 1; mask[i] = true }
                sum += plain
            }
        }
        strong = w * h == 0 ? 1 : Double(strongCount) / Double(w * h)
        mean = w * h == 0 ? 255 : Double(sum) / Double(w * h)
        self.mask = mask
        if measure { compareSeconds = ProcessInfo.processInfo.systemUptime - compareStart }
    }

    /// Sum the vertical neighbors once per column and reuse them for up to three horizontal neighbors.
    /// Divide only after combining both axes to preserve the original integer truncation.
    private static func blur(_ image: Bitmap, _ w: Int, _ h: Int) -> [UInt8] {
        guard w > 0, h > 0 else { return [] }
        var out = [UInt8](repeating: 0, count: w * h * 3)
        var columns = [Int](repeating: 0, count: w * 3)
        let stride = image.width * 4

        for y in 0..<h {
            let row = y * stride
            let hasAbove = y > 0
            let hasBelow = y + 1 < h
            let rows = 1 + (hasAbove ? 1 : 0) + (hasBelow ? 1 : 0)

            for x in 0..<w {
                let pixel = row + x * 4
                for c in 0..<3 {
                    let i = pixel + c
                    var sum = Int(image.pixels[i])
                    if hasAbove { sum += Int(image.pixels[i - stride]) }
                    if hasBelow { sum += Int(image.pixels[i + stride]) }
                    columns[x * 3 + c] = sum
                }
            }

            for x in 0..<w {
                let hasLeft = x > 0
                let hasRight = x + 1 < w
                let count = rows * (1 + (hasLeft ? 1 : 0) + (hasRight ? 1 : 0))
                let column = x * 3
                let output = (y * w + x) * 3
                for c in 0..<3 {
                    let i = column + c
                    var sum = columns[i]
                    if hasLeft { sum += columns[i - 3] }
                    if hasRight { sum += columns[i + 3] }
                    out[output + c] = UInt8(sum / count)
                }
            }
        }
        return out
    }

    /// Writes the render and a difference image (reference in grey, strong differences in red).
    func write(_ name: String, directory: URL = Self.directory) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        Self.png(native.image, directory.appendingPathComponent("\(name)-native.png"))
        let w = min(native.width, reference.width), h = min(native.height, reference.height)
        var data = [UInt8](repeating: 255, count: w * h * 4)
        for y in 0..<h {
            for x in 0..<w {
                let i = y * w + x, p = (y * reference.width + x) * 4
                let grey = UInt8((Int(reference.pixels[p]) + Int(reference.pixels[p + 1]) + Int(reference.pixels[p + 2])) / 6 + 128)
                data[i * 4] = mask[i] ? 255 : grey
                data[i * 4 + 1] = mask[i] ? 0 : grey
                data[i * 4 + 2] = mask[i] ? 0 : grey
            }
        }
        let provider = CGDataProvider(data: Data(data) as CFData)!
        if let image = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                               space: CGColorSpace(name: CGColorSpace.sRGB)!,
                               bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider,
                               decode: nil, shouldInterpolate: false, intent: .defaultIntent) {
            Self.png(image, directory.appendingPathComponent("\(name)-diff.png"))
        }
    }

    private static func png(_ image: CGImage, _ url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
    }
}


struct ImageDiffTests {
    @Test func preservesComparisonMetrics() throws {
        for (nativeWidth, nativeHeight, referenceWidth, referenceHeight) in [
            (1, 1, 1, 1), (1, 5, 2, 4), (5, 1, 4, 2), (2, 2, 2, 2),
            (2, 5, 5, 3), (8, 7, 6, 9), (6, 9, 8, 7),
        ] {
            let native = try bitmap(width: nativeWidth, height: nativeHeight) { x, y, channel in
                UInt8(truncatingIfNeeded: x * 61 + y * 89 + channel * 47)
            }
            let reference = try bitmap(width: referenceWidth, height: referenceHeight) { x, y, channel in
                UInt8(truncatingIfNeeded: x * 133 + y * 29 + channel * 81 + 75)
            }
            let result = ImageDiff(native: native, reference: reference)
            let width = min(native.width, reference.width)
            let height = min(native.height, reference.height)
            var mask: [Bool] = []
            var sum = 0
            for y in 0..<height {
                for x in 0..<width {
                    var strong = false
                    var plain = 0
                    for channel in 0..<3 {
                        func value(_ image: Bitmap, _ x: Int, _ y: Int) -> Int {
                            Int(image.pixels[(y * image.width + x) * 4 + channel])
                        }
                        var a = 0, b = 0, count = 0
                        for dy in -1...1 {
                            for dx in -1...1 {
                                let xx = x + dx, yy = y + dy
                                guard (0..<width).contains(xx), (0..<height).contains(yy) else { continue }
                                a += value(native, xx, yy)
                                b += value(reference, xx, yy)
                                count += 1
                            }
                        }
                        strong = strong || abs(a / count - b / count) > 64
                        plain = max(plain, abs(value(native, x, y) - value(reference, x, y)))
                    }
                    mask.append(strong)
                    sum += plain
                }
            }
            try #require(result.mask == mask)
            try #require(result.strong == Double(mask.filter { $0 }.count) / Double(width * height))
            try #require(result.mean == Double(sum) / Double(width * height))
            try #require(result.heightDifference == nativeHeight - referenceHeight)
        }

        // A two-pixel edge uses both samples and truncates the average.
        let reference = try bitmap(width: 2, height: 1) { _, _, _ in 0 }
        for delta: UInt8 in [129, 130] {
            let native = try bitmap(width: 2, height: 1) { x, _, _ in x == 0 ? delta : 0 }
            let diff = ImageDiff(native: native, reference: reference)
            try #require(diff.mask == [delta == 130, delta == 130])
            try #require(diff.mean == Double(delta) / 2)
        }
    }

    private func bitmap(width: Int, height: Int, pixel: (Int, Int, Int) -> UInt8) throws -> Bitmap {
        var data = Data()
        for y in 0..<height {
            for x in 0..<width {
                for channel in 0..<3 { data.append(pixel(x, y, channel)) }
                data.append(255)
            }
        }
        let provider = try #require(CGDataProvider(data: data as CFData))
        let image = try #require(CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
        ))
        return Bitmap(image)
    }
}

/// Only the benchmark assigns a mode. Ordinary screenshot tests keep their diagnostic output.
struct ScreenshotMeasurement {
    private static let environment = ProcessInfo.processInfo.environment
    private static let mode = environment["TW_SCREENSHOT_CAPTURE"]
    private static let profiling = mode != nil && environment["TW_SCREENSHOT_TIMING"] != "off"

    let name: String
    var referenceFile = ""
    private var renderSeconds = 0.0
    private var decodeSeconds = 0.0

    init(_ name: String) { self.name = name }

    mutating func render(_ operation: () -> Bitmap) -> Bitmap {
        let start = Self.now
        let value = operation()
        renderSeconds += Self.now - start
        return value
    }

    mutating func prepare(_ operation: () throws -> Bitmap) rethrows -> Bitmap {
        let start = Self.now
        let value = try operation()
        decodeSeconds += Self.now - start
        return value
    }

    mutating func reference(_ file: String) throws -> Bitmap {
        referenceFile = file
        return try prepare { try References.image(file) }
    }

    private static var now: Double { profiling ? ProcessInfo.processInfo.systemUptime : 0 }

    func compare(_ rendered: Bitmap, _ reference: Bitmap, limit: JSONValue?, margin: JSONValue?,
                 hidden: Int = 0) throws -> ImageDiff {
        let native = Self.environment["TW_SCREENSHOT_MISMATCH"] == name ? rendered.top(1) : rendered
        let diff = ImageDiff(native: native, reference: reference, measure: Self.profiling)
        let height = diff.heightDifference - hidden
        func threshold(_ key: String) -> Double {
            (limit?[key]?.numberValue?.double ?? .nan) + (margin?[key]?.numberValue?.double ?? .nan)
        }
        let widthMatches = native.width == reference.width
        let strongPasses = diff.strong <= threshold("strong")
        let meanPasses = diff.mean <= threshold("mean")
        let heightPasses = Double(abs(height)) <= threshold("heightDifference")
        let passed = limit != nil && widthMatches && strongPasses && meanPasses && heightPasses
        let start = Self.now
        if Self.mode != "failures" || !passed {
            let directory = Self.environment["TW_SCREENSHOT_OUTPUT"].map { FileManager.default.temporaryDirectory.appendingPathComponent($0, isDirectory: true) }
            try diff.write(name, directory: directory ?? ImageDiff.directory)
        }
        let writeSeconds = Self.now - start
        if Self.profiling {
            func digest<T>(_ bytes: [T]) -> String {
                bytes.withUnsafeBytes { SHA256.hash(data: Data($0)).map { String(format: "%02x", $0) }.joined() }
            }
            let hashesStart = Self.now
            let hashes = [digest(native.pixels), digest(reference.pixels), digest(diff.mask)]
            let record: [String: Any] = [
                "name": name, "reference": referenceFile, "passed": passed, "strong": diff.strong, "mean": diff.mean,
                "height": height, "nativeSize": [native.width, native.height], "referenceSize": [reference.width, reference.height],
                "hashes": hashes, "render": renderSeconds, "decode": decodeSeconds,
                "blur": diff.blurSeconds, "compare": diff.compareSeconds, "png": writeSeconds,
                "hash": Self.now - hashesStart,
            ]
            let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
            print("TW-SCREENSHOT " + String(decoding: data, as: UTF8.self))
        }
        if limit == nil {
            Issue.record("no tolerance for \(name): strong \(diff.strong) mean \(diff.mean) height \(height)")
        } else {
            #expect(widthMatches, "\(name) width \(native.width) vs \(reference.width)")
            #expect(strongPasses, "\(name) strong \(diff.strong)")
            #expect(meanPasses, "\(name) mean \(diff.mean)")
            #expect(heightPasses, "\(name) height \(height)")
        }
        return diff
    }
}
