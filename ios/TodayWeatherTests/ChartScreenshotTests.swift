import CoreGraphics
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

    init(native: Bitmap, reference: Bitmap) {
        self.native = native
        self.reference = reference
        heightDifference = native.height - reference.height
        let w = min(native.width, reference.width), h = min(native.height, reference.height)
        let a = Self.blur(native, w, h), b = Self.blur(reference, w, h)
        var strongCount = 0, sum = 0
        var mask = [Bool](repeating: false, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                let i = y * w + x
                var blurred = 0, plain = 0
                for c in 0..<3 {
                    blurred = max(blurred, abs(a[i * 3 + c] - b[i * 3 + c]))
                    plain = max(plain, abs(Int(native.pixels[(y * native.width + x) * 4 + c]) - Int(reference.pixels[(y * reference.width + x) * 4 + c])))
                }
                if blurred > 64 { strongCount += 1; mask[i] = true }
                sum += plain
            }
        }
        strong = w * h == 0 ? 1 : Double(strongCount) / Double(w * h)
        mean = w * h == 0 ? 255 : Double(sum) / Double(w * h)
        self.mask = mask
    }

    /// 3x3 box blur of the RGB channels over the common area (edges use the available neighbors).
    private static func blur(_ image: Bitmap, _ w: Int, _ h: Int) -> [Int] {
        var out = [Int](repeating: 0, count: w * h * 3)
        for y in 0..<h {
            for x in 0..<w {
                var s = [0, 0, 0], n = 0
                for dy in -1...1 {
                    for dx in -1...1 {
                        let xx = x + dx, yy = y + dy
                        guard xx >= 0, yy >= 0, xx < w, yy < h else { continue }
                        let p = (yy * image.width + xx) * 4
                        s[0] += Int(image.pixels[p]); s[1] += Int(image.pixels[p + 1]); s[2] += Int(image.pixels[p + 2]); n += 1
                    }
                }
                let o = (y * w + x) * 3
                out[o] = s[0] / n; out[o + 1] = s[1] / n; out[o + 2] = s[2] / n
            }
        }
        return out
    }

    /// Writes the render and a difference image (reference in grey, strong differences in red).
    func write(_ name: String) throws {
        try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        Self.png(native.image, Self.directory.appendingPathComponent("\(name)-native.png"))
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
            Self.png(image, Self.directory.appendingPathComponent("\(name)-diff.png"))
        }
    }

    private static func png(_ image: CGImage, _ url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
    }
}
