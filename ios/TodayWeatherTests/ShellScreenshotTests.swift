import CoreGraphics
import Foundation
import SwiftUI
import Testing
import TWDomain
import TWModel
@testable import TodayWeather

/// The SwiftUI shell against captures of the Cordova iOS build (IN-07, #2956; ios/tools/shell-reference): on the
/// 393x852 pt iPhone 16 at scale 3, in Korean and English, for each theme the tab bar and the header bar on each tab and
/// the open side menu; the launch image. Each part is rendered with `ImageRenderer` at the capture's width and pixel
/// scale with the capture's insets (status bar 54 pt, `env(safe-area-inset-top)` 5 pt, home indicator 34 pt), so the
/// result does not depend on the simulator that runs the test. A header bar is compared without the page's own buttons
/// (and, on Locations, its search field), which IN-08 and IN-10 add; everything else is the shell's. Each comparison
/// passes within `ShellReference/shell-tolerances.json` (the AN-05 metric and margins); renders and difference images
/// go to `<tmp>/chart-compare/`.
@MainActor
struct ShellScreenshotTests {
    static let insets = ShellInsets(statusBar: 54, top: 5, bottom: 34, leading: 0, trailing: 0)
    static let width: CGFloat = 393
    static let scale: CGFloat = 3
    static let themes = ["light", "dark", "photo", "old"]

    @Test(arguments: ["ko-KR", "en-US"])
    func theShellMatchesTheCordovaCaptures(language: String) throws {
        let tolerances = try References.json("shell-tolerances.json")
        var report: [String] = []
        for theme in Self.themes {
            for tab in ShellTab.allCases {
                let shell = ShellFixture.shell(ShellFixture.state(theme: theme), languages: [language])
                shell.select(tab)
                let colors = ShellColors.of(Theme.of(theme), tab: tab)
                let catalog = Catalog(code: shell.locale.catalog)
                let name = "\(language)-\(theme)-\(tab.rawValue)"
                // The tab bar.
                let tabs = render(TabBar(selected: tab, colors: colors, catalog: catalog, insets: Self.insets, onTap: { _ in }))
                try compare("\(name)-tabs", tabs, "shell-\(name)-tabs.png", tolerances, &report)
                // The hairlines (a whole-image metric barely sees a 0.5 pt line): the tab bar's top row and the header
                // bar's bottom row as the capture has them.
                let tabsReference = try References.image("shell-\(name)-tabs.png")
                #expect(close(tabs.rgb(x: 300, y: 1), tabsReference.rgb(x: 300, y: 1)), "\(name) tab bar hairline")
                // The header bar over what the page shows under a clear bar.
                let reference = try References.image("shell-\(name)-header.png")
                let under = reference.color(x: 2, y: 2)
                let header = render(HeaderBar(colors: colors, title: tab == .search ? "" : "회현동", insets: Self.insets,
                                              onMenu: {}) { EmptyView() }.background(under))
                // Masked: the page's buttons (and on Locations, the search field and its button), not the shell's.
                let mask = tab == .search ? CGRect(x: 50, y: 0, width: 343, height: 48.5) : CGRect(x: 305, y: 0, width: 88, height: 48.5)
                try compare("\(name)-header", header, "shell-\(name)-header.png", tolerances, &report, mask: [mask])
                let bottom = reference.height - 1
                #expect(close(header.rgb(x: 300, y: bottom), reference.rgb(x: 300, y: bottom)), "\(name) header hairline")
            }
            // The side menu, open on Hourly.
            let shell = ShellFixture.shell(ShellFixture.state(theme: theme), languages: [language])
            let menu = render(SideMenu(model: shell, catalog: Catalog(code: shell.locale.catalog), insets: Self.insets, scrolls: false)
                .frame(height: 798, alignment: .top).clipped())
            try compare("\(language)-\(theme)-menu", menu, "shell-\(language)-\(theme)-menu.png", tolerances, &report)
        }
        print("SHELL-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// The status bar above the WebView: its color per theme and tab (`applyIOSStatusBar`), also with the menu open.
    @Test(arguments: ["ko-KR", "en-US"])
    func statusBarColors(language: String) throws {
        for theme in Self.themes {
            for tab in ShellTab.allCases + [nil] {
                let file = "shell-\(language)-\(theme)-\(tab?.rawValue ?? "menu")-statusbar.png"
                let captured = try References.image(file).rgb(x: 600, y: 20)
                // With the menu open the status bar keeps Hourly's color.
                let expected = ShellColors.of(Theme.of(theme), tab: tab ?? .forecast).statusBar
                let rgb = [expected.red, expected.green, expected.blue].map { Int(($0 * 255).rounded()) }
                #expect(captured == rgb, "\(file)")
            }
        }
        #expect(!ShellColors.of(.light, tab: .forecast).statusBarLightContent, "styleDefault: dark content")
        #expect(ShellColors.of(.dark, tab: .forecast).statusBarLightContent)
    }

    /// The launch image under the white status bar, as the Cordova splash shows it until the first view (the status
    /// bar's own text is masked).
    @Test func theLaunchImageMatchesTheCordovaSplash() throws {
        let tolerances = try References.json("shell-tolerances.json")
        var report: [String] = []
        let renderer = ImageRenderer(content: SplashFrame(size: CGSize(width: 393, height: 852 - 59 - 34), insets: Self.insets))
        renderer.scale = 1
        let splash = Bitmap(try #require(renderer.cgImage))
        try compare("ko-KR-splash", splash, "shell-ko-KR-splash.png", tolerances, &report, mask: [CGRect(x: 0, y: 0, width: 393, height: 54)],
                    scale: 1)
        print("SHELL-COMPARE\n" + report.joined(separator: "\n"))
    }

    /// Two colors within 24 levels per channel (WebKit blends the half-pixel line into its neighbor rows).
    private func close(_ a: [Int], _ b: [Int]) -> Bool { zip(a, b).allSatisfy { abs($0 - $1) <= 24 } }

    private func render<V: View>(_ view: V) -> Bitmap {
        let renderer = ImageRenderer(content: view.frame(width: Self.width))
        renderer.scale = Self.scale
        renderer.proposedSize = ProposedViewSize(width: Self.width, height: nil)
        return Bitmap(renderer.cgImage!)
    }

    private func compare(_ name: String, _ rendered: Bitmap, _ file: String, _ tolerances: JSONValue, _ report: inout [String],
                         mask: [CGRect] = [], scale: CGFloat = scale) throws {
        let reference = try References.image(file)
        let native = rendered.copying(mask, from: reference, scale: scale)
        let diff = ImageDiff(native: native, reference: reference)
        try diff.write("shell-\(name)")
        report.append("\(name): strong \(diff.strong) mean \(diff.mean) height \(diff.heightDifference)")
        guard let limit = tolerances["cases"]?[name] else {
            Issue.record("no tolerance for \(name): strong \(diff.strong) mean \(diff.mean) height \(diff.heightDifference)")
            return
        }
        let margin = tolerances["margin"]
        func n(_ v: JSONValue?) -> Double { v?.numberValue?.double ?? .nan }
        #expect(native.width == reference.width, "\(name) width \(native.width) vs \(reference.width)")
        #expect(diff.strong <= n(limit["strong"]) + n(margin?["strong"]), "\(name) strong \(diff.strong)")
        #expect(diff.mean <= n(limit["mean"]) + n(margin?["mean"]), "\(name) mean \(diff.mean)")
        #expect(abs(Double(diff.heightDifference)) <= n(limit["heightDifference"]) + n(margin?["heightDifference"]),
                "\(name) height \(diff.heightDifference)")
    }
}

extension Bitmap {
    /// The sRGB color at a pixel.
    func rgb(x: Int, y: Int) -> [Int] {
        let p = (y * width + x) * 4
        return [Int(pixels[p]), Int(pixels[p + 1]), Int(pixels[p + 2])]
    }

    func color(x: Int, y: Int) -> Color {
        let c = rgb(x: x, y: y)
        return Color(.sRGB, red: Double(c[0]) / 255, green: Double(c[1]) / 255, blue: Double(c[2]) / 255)
    }

    /// This image with the pixels of `rects` (points at `scale`) taken from `other`: the areas a comparison leaves out.
    func copying(_ rects: [CGRect], from other: Bitmap, scale: CGFloat) -> Bitmap {
        guard !rects.isEmpty else { return self }
        var data = pixels
        for rect in rects {
            let x0 = max(0, Int((rect.minX * scale).rounded(.down))), y0 = max(0, Int((rect.minY * scale).rounded(.down)))
            let x1 = min(min(width, other.width), Int((rect.maxX * scale).rounded(.up)))
            let y1 = min(min(height, other.height), Int((rect.maxY * scale).rounded(.up)))
            guard x0 < x1, y0 < y1 else { continue }
            for y in y0..<y1 {
                for x in x0..<x1 {
                    for c in 0..<4 { data[(y * width + x) * 4 + c] = other.pixels[(y * other.width + x) * 4 + c] }
                }
            }
        }
        let provider = CGDataProvider(data: Data(data) as CFData)!
        let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider,
                            decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        return Bitmap(image)
    }
}
