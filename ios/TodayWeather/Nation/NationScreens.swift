import Foundation
import Observation
import os
import SwiftUI
import TWData
import TWDomain
import TWModel
import TWStorage

/// A page of the nationwide pages over the tabs; the raw value is its Cordova state (`screen_view`).
enum NationPage: String, Equatable {
    /// S10, nation.html (NationCtrl).
    case nation
    /// S11, nation-air.html (NationAirCtrl).
    case nationAir = "nation-air"
    /// S12, kma-special.html (KmaSpecialCtrl).
    case warnings = "kma-special"
}

/// The nationwide weather S10, the nationwide air S11 and the warnings S12 (IN-13, #2962), connected to the shell's menu
/// rows (`ShellModel.onMenuRow`): 전국날씨, 전국미세먼지 and 기상특보 close the menu (the row's `closesMenu`) and open their
/// page over the tab page and the tab bar (the Cordova `nation`, `nation-air` and `kma-special` states are outside the
/// tabs). The rows show for region KR only, and 전국날씨 also needs the TodayWeather product, which this app is
/// (`MenuRow.rows`). Each opening is a new controller (the states have `cache: false`): it starts on the first mode or
/// tab and sends its request (`NationSource`). While S10 or S11 loads, `$ionicLoading`'s backdrop covers the page, the
/// back button included; a failed answer leaves the labels with their names (S10, S11) or no card (S12). Port of the
/// Android `NationScreen` and `NationLoads` (AN-13), with the Cordova iOS template.
@MainActor
@Observable
final class NationScreens {
    /// The page shown; nil: the tabs.
    private(set) var page: NationPage?
    /// S10 and S11's answer; nil while loading and after a failure.
    private(set) var response: NationResponse?
    /// S12's cards.
    private(set) var cards: [WarningCard] = []
    /// `$ionicLoading` of S10 and S11 is shown.
    private(set) var loading = false
    /// S10's mode (`changeWeatherType`).
    private(set) var mode: Nationwide.Mode = .skyTemperature
    /// S11's pollutant (`changeAirType`).
    private(set) var airType = Nationwide.airTypes[0]

    @ObservationIgnored let shell: ShellModel
    @ObservationIgnored let source: NationSource
    @ObservationIgnored let catalog: Catalog
    /// The rows this does not handle: the shell's hook as it was before.
    @ObservationIgnored private let otherRows: (MenuRow) -> Void
    /// Counts the openings: an answer counts only for the opening that sent it.
    @ObservationIgnored private var visit = 0
    @ObservationIgnored private let log = Logger(subsystem: "net.wizardfactory.todayweather", category: "nation")

    init(shell: ShellModel, source: NationSource) {
        self.shell = shell
        self.source = source
        catalog = Catalog(code: shell.locale.catalog)
        otherRows = shell.onMenuRow
        shell.onMenuRow = { [weak self] row in self?.menuRow(row) }
    }

    /// The Cordova state of the page shown (`screen_view`), nil while the tabs show.
    var screenName: String? { page?.rawValue }

    /// The shell's page slot: the page in the shell's insets, nil while none shows.
    var pageView: (ShellInsets) -> AnyView? {
        { [weak self] insets in
            guard let self, page != nil else { return nil }
            return AnyView(NationPageView(screens: self, insets: insets))
        }
    }

    /// A menu row was chosen (after the menu closed).
    func menuRow(_ row: MenuRow) {
        switch row {
        case .nationalWeather: open(.nation)
        case .nationalAir: open(.nationAir)
        case .specialWeather: open(.warnings)
        default: otherRows(row)
        }
    }

    /// Opens `page` (`$location.path('/' + menu)`): a new controller, which requests its answer.
    func open(_ page: NationPage) {
        visit += 1
        let visit = self.visit
        self.page = page
        response = nil
        cards = []
        mode = .skyTemperature
        airType = Nationwide.airTypes[0]
        loading = page != .warnings
        let locale = shell.locale
        let source = self.source
        switch page {
        case .nation, .nationAir:
            let units = shell.holder.state?.units ?? .defaults(region: locale.region)
            Task { [weak self] in
                let load = await source.nation(region: locale.region, units: units, acceptLanguage: locale.acceptLanguage)
                guard let self, self.visit == visit else { return }
                if case .loaded(let response) = load { self.response = response }
                loading = false
            }
        case .warnings:
            Task { [weak self] in
                let load = await source.special(acceptLanguage: locale.acceptLanguage)
                guard let self, self.visit == visit else { return }
                // `toLocaleDateString()` and `toLocaleTimeString()` in the WebView's language and the device's zone.
                if case .loaded(let list) = load {
                    cards = WarningCards.cards(Warnings.parse(list, languageTag: locale.webLanguage,
                                                              timeZoneId: TimeZone.current.identifier))
                }
            }
        }
    }

    /// The page's back button (`onClose`, `$ionicHistory.goBack()`): the tabs as they were. Nothing while
    /// `$ionicLoading` covers the page.
    func back() {
        guard !loading else { return }
        visit += 1
        page = nil
    }

    /// S10's mode buttons.
    func choose(_ mode: Nationwide.Mode) { self.mode = mode }

    /// S11's pollutant tabs.
    func choose(airType: String) { self.airType = airType }

    /// What the page shows now.
    var content: NationContent {
        let units = shell.holder.state?.units ?? .defaults(region: shell.locale.region)
        switch page {
        case .nation?, nil:
            return .weather(response, mode: mode, units: units, region: shell.locale.region, catalog: catalog)
        case .nationAir?:
            return .air(response, type: airType, units: units, region: shell.locale.region, catalog: catalog)
        case .warnings?:
            return .warnings(cards, catalog: catalog)
        }
    }
}

/// What a nationwide page shows: the title and, by page, the mode buttons (S10), the pollutant tabs (S11), the map's
/// labels or the warning cards (S12).
struct NationContent: Equatable {
    var title: String
    var modes: [String] = []
    var mode: Nationwide.Mode = .skyTemperature
    var airType: String? = nil
    var labels: [NationLabel] = []
    var cards: [WarningCard] = []
    var note: String = ""

    /// S10 (nation.html): `getNationName`, the mode buttons, the labels in `mode` with the stored units.
    static func weather(_ response: NationResponse?, mode: Nationwide.Mode, units: UnitSettings, region: String,
                        catalog: Catalog) -> NationContent {
        NationContent(title: NationPages.title(region).map { catalog($0) } ?? "",
                      modes: NationPages.modeKeys.map { $0.map { catalog($0) }.joined(separator: "/") },
                      mode: mode, labels: NationPages.weather(response, mode: mode) { units.value($0) })
    }

    /// S11 (nation-air.html): `getNationName`, the labels of `type` in the stored air standard.
    static func air(_ response: NationResponse?, type: String, units: UnitSettings, region: String,
                    catalog: Catalog) -> NationContent {
        NationContent(title: NationPages.title(region).map { catalog($0) } ?? "", airType: type,
                      labels: NationPages.air(response, type: type, airUnit: units.airUnit))
    }

    /// S12 (kma-special.html): the cards and the note heading's text.
    static func warnings(_ cards: [WarningCard], catalog: Catalog) -> NationContent {
        NationContent(title: catalog("LOC_TYPE_SPECIAL_WEATHER"), cards: cards, note: catalog("LOC_SPECIAL_WEATHER_NOTE"))
    }
}
