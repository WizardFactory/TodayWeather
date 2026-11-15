import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The settings pages, the weather page after a settings change and About against the Cordova iOS build (#2961 AC3):
/// the states of the Cordova manual's pages 25-31 and 36, captured at 393x852 pt and scale 3 by
/// ios/tools/settings-reference (`SettingsReference/settings-<lang>-<state>.png`): S07 in Korean (also after 온도단위 F) and
/// English, every S08 list and the check mark after a choice (manual 25, 26, 28, 29), the theme list in the dark and photo
/// themes, the Hourly page's header block and chart in °F, dark and photo (27, 30, 31), and About over the menu in Korean
/// and English (36). Each is rendered with `ImageRenderer` at the capture's size and scale and compared by the AN-05
/// metric within `SettingsReference/settings-tolerances.json`; renders and differences go to `<tmp>/chart-compare/`.
@MainActor
struct SettingsScreenshotTests {
    static let scale: CGFloat = 3
    /// The WebView's insets on the 393x852 iPhone: the status bar above it, `env(safe-area-inset-top)` 5 pt in the header
    /// bar, the home indicator's 34 pt at the bottom.
    static let insets = ShellInsets(statusBar: 0, top: 5, bottom: 34, leading: 0, trailing: 0)

    /// The settings pages captured: (state, language).
    nonisolated static let pages: [(String, String)] = [
        ("units", "ko-KR"), ("units-f", "ko-KR"), ("units", "en-US"),
        ("radio-temperatureUnit", "ko-KR"), ("radio-windSpeedUnit", "ko-KR"), ("radio-pressureUnit", "ko-KR"),
        ("radio-distanceUnit", "ko-KR"), ("radio-precipitationUnit", "ko-KR"), ("radio-airUnit", "ko-KR"),
        ("radio-temperatureUnit-f", "ko-KR"), ("radio-startupPage", "ko-KR"), ("radio-refreshInterval", "ko-KR"),
        ("radio-theme", "ko-KR"), ("radio-theme-dark", "ko-KR"), ("radio-theme-photo", "ko-KR"),
    ]

    @Test func settingsPagesMatchTheCordovaPages() throws {
        let tolerances = try References.json("settings-tolerances.json")
        var report: [String] = []
        for (state, language) in Self.pages {
            let (page, theme, units) = Self.page(state, region: language == "en-US" ? "US" : "KR")
            let shell = ShellFixture.shell(ShellFixture.state(theme: theme.key), languages: [language])
            let catalog = Catalog(code: shell.locale.catalog)
            let content: SettingsPageContent
            switch page {
            case .units: content = .units(units, catalog: catalog)
            case .list(let name):
                // Korean default units, startup page and refresh interval "0", the theme of the state.
                let value = SettingLists.units.contains(name) ? units.value(name) : name == "theme" ? theme.key : "0"
                content = .list(name, value: value, catalog: catalog)
            }
            let view = SettingsPageFrame(content: content, theme: theme, insets: Self.insets, scrolls: false, onBack: {}, onRow: { _ in })
                .frame(width: 393, height: 798)
            let name = "\(language)-\(state)"
            // Compared from the top to 40 pt under the list (the rest of the page is the list's background, checked by
            // samples): the full page would make each comparison three times slower for blank pixels.
            let height = Int((49 + 55 * Double(content.rows.count) + 41) * Self.scale)
            let native = render(view), reference = try References.image("settings-\(name).png")
            try compare(name, native.top(height), reference.top(height), tolerances, &report)
            // The check mark (a whole-page metric barely sees it): glyph pixels at the right of the checked row only.
            if case .list = page {
                for (i, row) in content.rows.enumerated() {
                    let area = CGRect(x: 340, y: 49 + 55 * Double(i) + 1, width: 53, height: 54)
                    let captured = reference.ink(area, scale: Self.scale), drawn = native.ink(area, scale: Self.scale)
                    if row.checked {
                        #expect(captured > 100 && abs(drawn - captured) <= captured * 35 / 100, "\(name) check \(drawn) vs \(captured)")
                    } else {
                        #expect(captured == 0 && drawn == 0, "\(name) no check in row \(i)")
                    }
                }
            }
            let background = ShellColors.menu(theme).menuList
            let rgb = [background.red, background.green, background.blue].map { Int(($0 * 255).rounded()) }
            for y in [reference.height - 200, reference.height - 600, height + 30] {
                #expect(reference.rgb(x: 600, y: y) == rgb && native.rgb(x: 600, y: y) == rgb, "\(name) background at \(y)")
            }
            // The status bar above the WebView: `applyIOSStatusBar(theme, 'setting')`.
            let bar = try References.image("settings-\(name)-statusbar.png").rgb(x: 600, y: 20)
            let expected = ShellColors.menu(theme).statusBar
            #expect(bar == [expected.red, expected.green, expected.blue].map { Int(($0 * 255).rounded()) }, "\(name) status bar")
        }
        print("SETTINGS-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// The Hourly page after 온도단위 F and in the dark and photo themes: the header block with the bar over it and the
    /// hourly chart at its opening position.
    @Test(arguments: ["hourly-f", "hourly-dark", "hourly-photo"])
    func theWeatherPageAfterAChange(state: String) throws {
        let manifest = try References.json("settings-captures.json")
        let tolerances = try References.json("settings-tolerances.json")
        let entry = try #require(manifest["states"]?["ko-KR/\(state)"])
        let theme = Theme.of(entry["theme"]?.stringValue)
        let fahrenheit = entry["units"]?["temperatureUnit"]?.stringValue == "F"
        let content = try Self.weather(fahrenheit: fahrenheit, theme: theme)
        var report: [String] = []
        for block in entry["blocks"]?.arrayValue ?? [] {
            let index = Int(block["index"]?.numberValue?.double ?? -1)
            let view = WeatherScreenshotTests.blockView(content.blocks[index], content: content, page: state, theme: theme)
            let renderer = ImageRenderer(content: view.frame(width: 393).environment(\.sizeCategory, .large))
            renderer.scale = Self.scale
            renderer.proposedSize = ProposedViewSize(width: 393, height: nil)
            let native = Bitmap(try #require(renderer.cgImage, "render"))
            try compare("ko-KR-\(state)-\(index)", native, try #require(block["file"]?.stringValue), tolerances, &report)
        }
        print("SETTINGS-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// About (O10) over the menu, in Korean and English: the menu at its top under the popup and its backdrop.
    @Test(arguments: ["ko-KR", "en-US"])
    func aboutMatchesTheCordovaPopup(language: String) throws {
        let tolerances = try References.json("settings-tolerances.json")
        let shell = ShellFixture.shell(languages: [language])
        let catalog = Catalog(code: shell.locale.catalog)
        let about = About(text: catalog.callAsFunction)
        let popup = Popup(title: about.title, lines: about.lines, buttons: [Popup.Button(text: about.ok, style: .positive)])
        let view = ZStack(alignment: .top) {
            SideMenu(model: shell, catalog: catalog, insets: ShellInsets(statusBar: 54, top: 5, bottom: 34, leading: 0, trailing: 0),
                     scrolls: false)
            IonicPopupView(popup: popup, onTap: { _ in }, scrolls: false)
        }
        .frame(width: 393, height: 798)
        var report: [String] = []
        try compare("\(language)-about", render(view), "settings-\(language)-about.png", tolerances, &report)
        print("SETTINGS-COMPARE \(ImageDiff.directory.path)\n" + report.joined(separator: "\n"))
    }

    /// The page, theme and units of a captured state: the region's default units (`Units._getDefaultUnits`; F after the
    /// choice), light unless named.
    static func page(_ state: String, region: String) -> (SettingsPage, Theme, UnitSettings) {
        var units = UnitSettings.defaults(region: region)
        if state.hasSuffix("-f") { units.temperatureUnit = "F" }
        let theme: Theme = state.hasSuffix("-dark") ? .dark : state.hasSuffix("-photo") ? .photo : .light
        if state.hasPrefix("units") { return (.units, theme, units) }
        var name = String(state.dropFirst("radio-".count))
        for suffix in ["-f", "-dark", "-photo"] where name.hasSuffix(suffix) { name = String(name.dropLast(suffix.count)) }
        return (.list(name), theme, units)
    }

    /// The Hourly page of 회현동 as the capture showed it: the served response (kma-seoul, or kma-seoul-f in °F) applied
    /// with the units and theme.
    static func weather(fahrenheit: Bool, theme: Theme) throws -> WeatherPageContent {
        let input = fahrenheit ? "settings-kma-seoul-f.input.json" : "forecast-kma-seoul.input.json"
        let converted = try #require(try WeatherConverter.convert(References.json(input)))
        var record = JSONObject()
        for field in WeatherRepository.weatherFields { if let v = converted[field], Js.truthy(v) { record[field] = v } }
        record["name"] = "회현동"
        record["address"] = "대한민국 서울특별시 중구 회현동"
        record["country"] = "KR"
        record["location"] = .object(JSONObject([("lat", .number(37.56)), ("long", .number(126.98))]))
        record["currentPosition"] = .bool(false)
        let ko = Catalog(code: "ko")
        var scope = ForecastScope(type: .short, metrics: ChartMetrics(bodyWidth: 393, bodyHeight: 852), fahrenheit: fahrenheit,
                                  photoTheme: theme == .photo,
                                  yesterday: YesterdayText(same: ko("LOC_SAME_AS_YESTERDAY"), than: ko("LOC_THAN_YESTERDAY")),
                                  expandShortChart: false)
        scope.open(record, enabledCount: 1, hasPush: false)
        let units = PageUnits(temperature: fahrenheit ? "F" : "C", windSpeed: "m/s", pressure: "hPa", distance: "km",
                              precipitation: "mm", air: "airkorea")
        return WeatherPageContent(scope: scope, units: units, texts: WeatherScreens.texts(ko))
    }

    private func render<V: View>(_ view: V) -> Bitmap {
        let renderer = ImageRenderer(content: view.environment(\.sizeCategory, .large))
        renderer.scale = Self.scale
        return Bitmap(renderer.cgImage!)
    }

    private func compare(_ name: String, _ native: Bitmap, _ file: String, _ tolerances: JSONValue, _ report: inout [String]) throws {
        try compare(name, native, try References.image(file), tolerances, &report)
    }

    private func compare(_ name: String, _ native: Bitmap, _ reference: Bitmap, _ tolerances: JSONValue,
                         _ report: inout [String]) throws {
        let diff = ImageDiff(native: native, reference: reference)
        try diff.write("settings-\(name)")
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
    /// The pixels of `rect` (points at `scale`) that differ from its top left pixel by more than 100 in a channel: the
    /// glyph's ink over the row's background.
    func ink(_ rect: CGRect, scale: CGFloat) -> Int {
        let x0 = Int(rect.minX * scale), y0 = Int(rect.minY * scale)
        let x1 = min(width, Int(rect.maxX * scale)), y1 = min(height, Int(rect.maxY * scale))
        let base = rgb(x: x0, y: y0)
        var count = 0
        for y in y0..<y1 {
            for x in x0..<x1 where zip(rgb(x: x, y: y), base).contains(where: { abs($0 - $1) > 100 }) { count += 1 }
        }
        return count
    }

    /// The top `height` pixel rows.
    func top(_ height: Int) -> Bitmap {
        Bitmap(image.cropping(to: CGRect(x: 0, y: 0, width: width, height: min(height, self.height)))!)
    }
}
