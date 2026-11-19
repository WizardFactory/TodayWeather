import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
@testable import TodayWeather

/// The size and language matrix against the Cordova iOS build (IN-18 part 2, #2967 AC2): each screen S01-S12 and its main
/// dialogs in the state the user manual shows, at 375x667 (scale 2), 393x852 and 440x956 pt (scale 3), in Korean and
/// English, captured by ios/tools/matrix-reference with the sets' own capture tools (`MatrixReference/matrix-<size>-<lang>-*`).
/// At 393x852 the matrix adds the English states the other suites lack (S03-S05, S08, S10-S12); their Korean states and the
/// other English ones are compared there. Each state is rendered with `ImageRenderer` at the capture's WebView size, insets
/// and scale with the views and fixtures of the set's own suite, and compared by the AN-05 metric within
/// `MatrixReference/matrix-tolerances.json`; renders and differences go to `<tmp>/chart-compare/matrix-*`.
@MainActor
struct MatrixScreenshotTests {
    /// A captured display: the WebView under the status bar, `env(safe-area-inset-top)` inside it (the header bar's extra
    /// top) and the home indicator's inset at its bottom.
    struct Display {
        let size: String
        let width: CGFloat
        let height: CGFloat
        let scale: CGFloat
        let statusBar: CGFloat
        let top: CGFloat
        let bottom: CGFloat

        var webViewHeight: CGFloat { height - statusBar }
        var insets: ShellInsets { ShellInsets(statusBar: 0, top: top, bottom: bottom, leading: 0, trailing: 0) }
        var metrics: ChartMetrics { ChartMetrics(bodyWidth: Double(width), bodyHeight: Double(height)) }
    }

    /// iPhone SE (3rd generation), iPhone 16 and iPhone 16 Pro Max on iOS 26.5: the status bar's height (the WebView's
    /// origin in every capture, checked: 54 pt on the Pro Max too, whose safe area starts at 62) and the safe area's top
    /// and bottom.
    nonisolated static let displays: [String: (CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)] = [
        "375x667": (375, 667, 2, 20, 20, 0), "393x852": (393, 852, 3, 54, 59, 34), "440x956": (440, 956, 3, 54, 62, 34),
    ]

    static func display(_ size: String) throws -> Display {
        let d = try #require(displays[size])
        return Display(size: size, width: d.0, height: d.1, scale: d.2, statusBar: d.3, top: d.4 - d.3, bottom: d.5)
    }

    /// The (size, language) cases of a set: both languages at 375 and 440; English at 393 for the sets whose 393x852
    /// references are Korean only.
    nonisolated static func cases(english393: Bool, korean: Bool = false) -> [(String, String)] {
        var cases: [(String, String)] = []
        for size in ["375x667", "393x852", "440x956"] {
            for language in korean ? ["ko-KR"] : ["ko-KR", "en-US"] where size != "393x852" || (english393 && language == "en-US") {
                cases.append((size, language))
            }
        }
        return cases
    }

    /// The run record of a set at a size and language: its files and the captured environment.
    static func run(_ set: String, _ display: Display, _ language: String) throws -> JSONValue {
        let run = try References.json("matrix-\(display.size)-\(language)-\(set)-run.json")
        let env = try #require(run["env"])
        #expect(Int(env["screen"]?["width"]?.numberValue?.double ?? 0) == Int(display.width), "\(set) \(display.size) width")
        #expect(Int(env["screen"]?["height"]?.numberValue?.double ?? 0) == Int(display.height), "\(set) \(display.size) height")
        #expect(CGFloat(env["devicePixelRatio"]?.numberValue?.double ?? 0) == display.scale, "\(set) \(display.size) scale")
        for origin in run["webViewOrigins"]?.arrayValue ?? [] {
            #expect(CGFloat(origin["y"]?.numberValue?.double ?? -1) == display.statusBar * display.scale,
                    "\(set) \(display.size) WebView under the status bar")
        }
        return run
    }

    /// The units the captured page used (`env.units`: Korea's defaults in Korean; region US's in English, as the Cordova
    /// iOS build takes its region from navigator.language, which an English iPhone reports as en-US).
    static func units(_ run: JSONValue) throws -> UnitSettings {
        let u = try #require(run["env"]?["units"])
        func v(_ key: String) throws -> String { try #require(u[key]?.stringValue, "units.\(key)") }
        return UnitSettings(temperatureUnit: try v("temperatureUnit"), windSpeedUnit: try v("windSpeedUnit"),
                            pressureUnit: try v("pressureUnit"), distanceUnit: try v("distanceUnit"),
                            precipitationUnit: try v("precipitationUnit"), airUnit: try v("airUnit"))
    }

    static func region(_ run: JSONValue) -> String { run["env"]?["region"]?.stringValue ?? "KR" }

    static func file(_ display: Display, _ language: String, _ name: String) -> String { "matrix-\(display.size)-\(language)-\(name)" }

    static func catalog(_ language: String) -> Catalog { Catalog(code: language == "en-US" ? "en" : "ko") }

    // MARK: - S01, O01

    @Test(arguments: cases(english393: false))
    func startPage(size: String, language: String) async throws {
        let display = try Self.display(size)
        _ = try Self.run("start", display, language)
        var report = Report()
        for state in ["access", "start"] {
            let f = try await StartScreenshotTests.page(state, language: language)
            let view = StartFrame(page: f.page, insets: .zero, screenHeight: display.height, scrolls: false)
                .frame(width: display.width, height: display.webViewHeight)
                .environment(\.cssFallbackLanguage, StartScreenshotTests.fallback(language))
            let reference = try References.image(Self.file(display, language, "start-\(language)-\(state).png"))
            try report.compare("\(size)-\(language)-start-\(state)", render(view, display, language: language), reference)
            #expect(try References.image(Self.file(display, language, "start-\(language)-\(state)-statusbar.png"))
                .rgb(x: 20, y: 4) == [255, 255, 255], "\(state) status bar")
        }
        report.print("start")
    }

    // MARK: - S02

    @Test(arguments: cases(english393: false))
    func placesList(size: String, language: String) async throws {
        let display = try Self.display(size)
        _ = try Self.run("places", display, language)
        var report = Report()
        let f = try await PlacesScreenshotTests.fixture("list", language: language)
        let places = f.places
        let view = ShellFrame(model: f.shell, insets: display.insets, content: { places.content($0, live: false) })
            .frame(width: display.width, height: display.webViewHeight)
            .environment(\.cssFallbackLanguage, "ko")
        let reference = try References.image(Self.file(display, language, "places-\(language)-list.png"))
        try report.compare("\(size)-\(language)-places-list", render(view, display, language: language).top(reference.height), reference)
        report.print("places")
    }

    // MARK: - S03, S04

    @Test(arguments: cases(english393: true))
    func weatherPages(size: String, language: String) throws {
        let display = try Self.display(size)
        let run = try Self.run("forecast", display, language)
        let units = try Self.units(run)
        let manifest = try References.json(Self.file(display, language, "forecast-captures.json"))
        var report = Report()
        for page in ["kma-seoul-hourly", "kma-seoul-daily"] {
            let content = try Self.weather(page, manifest: manifest, display: display, language: language, units: units)
            let blocks = try #require(manifest["pages"]?[page]?["blocks"]?.arrayValue, "\(page) blocks")
            #expect(blocks.count == content.blocks.count, "\(size) \(language) \(page): one reference per block")
            for block in blocks {
                let index = Int(block["index"]?.numberValue?.double ?? -1)
                let view = WeatherScreenshotTests.blockView(content.blocks[index], content: content, page: page, headerTop: display.top)
                let native = render(view.frame(width: display.width), display, width: display.width, language: language)
                let file = Self.file(display, language, try #require(block["file"]?.stringValue))
                let reference = try References.image(WeatherScreenshotTests.referenceFile(file, block: content.blocks[index], content: content))
                let hidden = Int((block["hidden"]?.numberValue?.double ?? 0) * Double(display.scale))
                try report.compare("\(size)-\(language)-forecast-\(page)-\(index)", native, reference, hidden: hidden)
            }
        }
        report.print("forecast")
    }

    /// WeatherScreenshotTests.content at a display and in a language: the served response converted with the place's
    /// fields, opened at the display's chart metrics with the language's texts.
    static func weather(_ page: String, manifest: JSONValue, display: Display, language: String,
                        units u: UnitSettings) throws -> WeatherPageContent {
        let place = try #require(manifest["places"]?["kma-seoul"]?.objectValue)
        let converted = try #require(try WeatherConverter.convert(References.json(file(display, language, "forecast-kma-seoul.input.json"))))
        var record = JSONObject()
        for field in WeatherRepository.weatherFields { if let v = converted[field], Js.truthy(v) { record[field] = v } }
        for key in ["name", "address", "country", "location"] { record[key] = place[key] }
        record["currentPosition"] = .bool(false)
        let catalog = catalog(language)
        var scope = ForecastScope(type: page.contains("daily") ? .mid : .short, metrics: display.metrics,
                                  fahrenheit: u.temperatureUnit == "F",
                                  photoTheme: false,
                                  yesterday: YesterdayText(same: catalog("LOC_SAME_AS_YESTERDAY"), than: catalog("LOC_THAN_YESTERDAY")),
                                  expandShortChart: false)
        scope.open(record, enabledCount: 1, hasPush: false)
        let units = PageUnits(temperature: u.temperatureUnit, windSpeed: u.windSpeedUnit, pressure: u.pressureUnit,
                              distance: u.distanceUnit, precipitation: u.precipitationUnit, air: u.airUnit)
        return WeatherPageContent(scope: scope, units: units, texts: WeatherScreens.texts(catalog))
    }

    // MARK: - S05

    @Test(arguments: cases(english393: true))
    func airPage(size: String, language: String) throws {
        let display = try Self.display(size)
        let run = try Self.run("air", display, language)
        let manifest = try References.json(Self.file(display, language, "air-captures.json"))
        let place = try #require(manifest["states"]?["kma-seoul"]?["places"]?.arrayValue?.first)
        var city = JSONObject()
        for key in ["name", "address", "country", "location"] { if let v = place[key] { city[key] = v } }
        city["currentPosition"] = .bool(false)
        let converted = try #require(try WeatherConverter.convert(References.json(Self.file(display, language, "air-kma-seoul.input.json"))))
        for (k, v) in converted { city[k] = v }
        var scope = AirScope(metrics: display.metrics, airUnit: try Self.units(run).airUnit, zone: try #require(TimeZone(identifier: "Asia/Seoul")))
        scope.open(city, code: nil, enabledCount: 1, hasPush: false)
        let content = AirPageContent(scope: scope, texts: WeatherScreens.texts(Self.catalog(language)))
        let blocks = try #require(manifest["states"]?["kma-seoul"]?["blocks"]?.arrayValue)
        #expect(blocks.count == content.blocks.count, "\(size) \(language): one reference per block")
        var report = Report()
        for block in blocks {
            let index = Int(block["index"]?.numberValue?.double ?? -1)
            let width = CGFloat(block["rect"]?["w"]?.numberValue?.double ?? Double(display.width))
            let view = AirScreenshotTests.blockView(content.blocks[index], content: content, theme: .light, headerTop: display.top)
            let native = render(view.frame(width: width), display, width: width, language: language)
            let reference = try References.image(Self.file(display, language, try #require(block["file"]?.stringValue)))
            let hidden = Int((block["hidden"]?.numberValue?.double ?? 0) * Double(display.scale))
            try report.compare("\(size)-\(language)-air-kma-seoul-\(index)", native, reference, hidden: hidden)
        }
        report.print("air")
    }

    // MARK: - S06

    @Test(arguments: cases(english393: false))
    func sideMenu(size: String, language: String) throws {
        let display = try Self.display(size)
        _ = try Self.run("shell", display, language)
        let shell = ShellFixture.shell(ShellFixture.state(theme: "light"), languages: [language])
        let insets = ShellInsets(statusBar: display.statusBar, top: display.top, bottom: display.bottom, leading: 0, trailing: 0)
        let view = SideMenu(model: shell, catalog: Catalog(code: shell.locale.catalog), insets: insets, scrolls: false)
            .frame(width: display.width, height: display.webViewHeight, alignment: .top).clipped()
        var report = Report()
        try report.compare("\(size)-\(language)-shell-menu", render(view, display, language: language),
                           try References.image(Self.file(display, language, "shell-\(language)-light-menu.png")))
        // X1: the tab bar and the header bar on Hourly (the header without the page's own buttons, as ShellScreenshotTests).
        shell.select(.forecast)
        let colors = ShellColors.of(.light, tab: .forecast)
        let catalog = Catalog(code: shell.locale.catalog)
        let tabs = render(TabBar(selected: .forecast, colors: colors, catalog: catalog, insets: insets, onTap: { _ in })
            .frame(width: display.width), display, width: display.width, language: language)
        let tabsReference = try References.image(Self.file(display, language, "shell-\(language)-light-forecast-tabs.png"))
        // The home indicator iOS drew over the WebView's bottom inset in some captures (system UI, not the page's).
        let indicator = CGRect(x: display.width / 2 - 75, y: CGFloat(tabsReference.height) / display.scale - 14, width: 150, height: 12)
        let masks = ShellScreenshotTests.legacyRefreshGlyph(.forecast, width: display.width) + (display.bottom > 0 ? [indicator] : [])
        try report.compare("\(size)-\(language)-shell-tabs",
                           tabs.copying(masks, from: tabsReference, scale: display.scale), tabsReference)
        let reference = try References.image(Self.file(display, language, "shell-\(language)-light-forecast-header.png"))
        let header = render(HeaderBar(colors: colors, title: "회현동", insets: insets, onMenu: {}) { EmptyView() }
            .background(reference.color(x: 2, y: 2)).frame(width: display.width), display, width: display.width, language: language)
        let mask = CGRect(x: display.width - 88, y: 0, width: 88, height: 44 + display.top + 0.5)
        try report.compare("\(size)-\(language)-shell-header", header.copying([mask], from: reference, scale: display.scale), reference)
        report.print("shell")
    }

    // MARK: - S07, S08, O10

    @Test(arguments: cases(english393: true))
    func settingsPages(size: String, language: String) throws {
        let display = try Self.display(size)
        _ = try Self.run("settings", display, language)
        // At 393x852 the English units page and About are SettingsScreenshotTests'; the matrix adds the list.
        let states = size == "393x852" ? ["radio-temperatureUnit"] : ["units", "radio-temperatureUnit", "about"]
        var report = Report()
        for state in states {
            let shell = ShellFixture.shell(ShellFixture.state(theme: "light"), languages: [language])
            let catalog = Catalog(code: shell.locale.catalog)
            let view: AnyView
            if state == "about" {
                let about = About(text: catalog.callAsFunction)
                let popup = Popup(title: about.title, lines: about.lines, buttons: [Popup.Button(text: about.ok, style: .positive)])
                let insets = ShellInsets(statusBar: display.statusBar, top: display.top, bottom: display.bottom, leading: 0, trailing: 0)
                view = AnyView(ZStack(alignment: .top) {
                    SideMenu(model: shell, catalog: catalog, insets: insets, scrolls: false)
                    IonicPopupView(popup: popup, onTap: { _ in }, scrolls: false)
                })
            } else {
                let (page, theme, units) = SettingsScreenshotTests.page(state, region: language == "en-US" ? "US" : "KR")
                let content: SettingsPageContent
                switch page {
                case .units: content = .units(units, catalog: catalog)
                case .list(let name): content = .list(name, value: units.value(name), catalog: catalog)
                }
                view = AnyView(SettingsPageFrame(content: content, theme: theme, insets: display.insets, scrolls: false,
                                                 onBack: {}, onRow: { _ in }))
            }
            let native = render(view.frame(width: display.width, height: display.webViewHeight), display, language: language)
            try report.compare("\(size)-\(language)-settings-\(state)", native,
                               try References.image(Self.file(display, language, "settings-\(language)-\(state).png")))
        }
        report.print("settings")
    }

    // MARK: - S09, O14 (time picker), O12 (save confirmation)

    @Test(arguments: cases(english393: false))
    func alarmsPage(size: String, language: String) throws {
        let display = try Self.display(size)
        _ = try Self.run("push", display, language)
        let catalog = Self.catalog(language)
        var report = Report()
        for state in ["settings", "picker", "confirm"] {
            let view = ZStack(alignment: .top) {
                AlarmsPageFrame(content: AlarmsScreenshotTests.content(state), theme: .light, catalog: catalog, insets: display.insets,
                                scrolls: false)
                if let popup = AlarmsScreenshotTests.popup(state, catalog: catalog) {
                    IonicPopupView(popup: popup, onTap: { _ in }, scrolls: false)
                }
            }
            .frame(width: display.width, height: display.webViewHeight)
            try report.compare("\(size)-\(language)-push-\(state)", render(view, display, language: language),
                               try References.image(Self.file(display, language, "alarms-\(language)-\(state).png")))
        }
        report.print("push")
    }

    // MARK: - S10, S11, S12

    /// Korean only: the Cordova iOS build takes its region from navigator.language (en-US on an English iPhone), so its
    /// English users never reach S10-S12 (no menu rows outside KR; opened anyway, "USA" without data).
    @Test(arguments: cases(english393: false, korean: true))
    func nationPages(size: String, language: String) throws {
        let display = try Self.display(size)
        let run = try Self.run("nation", display, language)
        let catalog = Self.catalog(language)
        let units = try Self.units(run), region = Self.region(run)
        let response = try NationScreenshotTests.nation()
        var report = Report()
        for name in ["nation-weather", "nation-air-pm2.5", "warnings"] {
            let page: NationPage, content: NationContent
            switch name {
            case "warnings":
                let list = try JSONValue.parse(NationFixtures.body("special"))
                let tag = language
                page = .warnings
                content = .warnings(WarningCards.cards(Warnings.parse(list, languageTag: tag, timeZoneId: "Asia/Seoul")), catalog: catalog)
            case "nation-air-pm2.5":
                page = .nationAir
                content = .air(response, type: "pm2.5", units: units, region: region, catalog: catalog)
            default:
                page = .nation
                content = .weather(response, mode: .skyTemperature, units: units, region: region, catalog: catalog)
            }
            let record = try References.json(Self.file(display, language, "nation-\(name).json"))
            let offset = CGFloat(record["content"]?["scrollTop"]?.numberValue?.double ?? 0)
            let view = NationPageFrame(page: page, content: content, theme: .light, insets: display.insets, loading: false,
                                       scrolls: false, offset: offset)
                .frame(width: display.width, height: display.webViewHeight)
                .environment(\.cssFallbackLanguage, "ko")
            let reference = try References.image(Self.file(display, language, "nation-\(name).png"))
            var height = reference.height
            if let map = record["map"]?["rect"] {
                let bottom = (map["y"]?.numberValue?.double ?? 0) + (map["h"]?.numberValue?.double ?? 0) + 20
                height = min(height, Int(bottom * Double(display.scale)))
            }
            try report.compare("\(size)-\(language)-nation-\(name)", render(view, display, language: language).top(height), reference.top(height))
        }
        report.print("nation")
    }

    // MARK: - Rendering and comparison

    /// The render at the display's scale. `language` sets the fallback fonts of the captured system (a CJK compatibility
    /// character such as ㎍ comes from another font in another language; CI's simulator is in English); a view that
    /// sets its own keeps it.
    private func render<V: View>(_ view: V, _ display: Display, width: CGFloat? = nil, language: String) -> Bitmap {
        let renderer = ImageRenderer(content: view.environment(\.sizeCategory, .large)
            .environment(\.cssFallbackLanguage, language == "ko-KR" ? "ko" : "en"))
        renderer.scale = display.scale
        if let width { renderer.proposedSize = ProposedViewSize(width: width, height: nil) }
        return Bitmap(renderer.cgImage!)
    }

    /// The comparisons of one test, each within its recorded tolerance; a case without one is reported with its measures.
    struct Report {
        var lines: [String] = []
        let tolerances = try? References.json("matrix-tolerances.json")

        mutating func compare(_ name: String, _ native: Bitmap, _ reference: Bitmap, hidden: Int = 0) throws {
            let diff = ImageDiff(native: native, reference: reference)
            try diff.write("matrix-\(name)")
            let height = diff.heightDifference - hidden
            lines.append("MATRIX-MEASURED \(name) \(diff.strong) \(diff.mean) \(height)")
            guard let limit = tolerances?["cases"]?[name] else {
                Issue.record("no tolerance for \(name): strong \(diff.strong) mean \(diff.mean) height \(height)")
                return
            }
            let margin = tolerances?["margin"]
            func n(_ v: JSONValue?) -> Double { v?.numberValue?.double ?? .nan }
            #expect(native.width == reference.width, "\(name) width \(native.width) vs \(reference.width)")
            #expect(diff.strong <= n(limit["strong"]) + n(margin?["strong"]), "\(name) strong \(diff.strong)")
            #expect(diff.mean <= n(limit["mean"]) + n(margin?["mean"]), "\(name) mean \(diff.mean)")
            #expect(Double(abs(height)) <= n(limit["heightDifference"]) + n(margin?["heightDifference"]), "\(name) height \(height)")
        }

        func print(_ set: String) {
            Swift.print("MATRIX-COMPARE \(set) \(ImageDiff.directory.path)\n" + lines.joined(separator: "\n"))
        }
    }
}
