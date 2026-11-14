import CoreLocation
import Foundation
import SwiftUI
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit

/// The weather pages S03 (Hourly) and S04 (Daily) in the shell (IN-08, #2957): TabCtrl's loading (`WeatherSession`) and
/// ForecastCtrl's scope for the shown page (`ForecastScope`), connected to the shell's hooks: the opening and a return
/// to the foreground reload (`reloadEvent` `init` and `resume`), a tap on the selected weather or air tab reloads
/// (`tab`), and a failure shows the retry confirmation O03. State writes go through the `AppStateHolder`.
@MainActor
@Observable
final class WeatherScreens {
    let session: WeatherSession
    let shell: ShellModel
    @ObservationIgnored private let catalog: Catalog
    @ObservationIgnored let texts: ChartTexts
    /// The scope of the weather page shown now (ForecastCtrl, not cached: a new visit each time the tab opens).
    private(set) var scope: ForecastScope?
    /// The tab whose visit `scope` is.
    @ObservationIgnored private var visitTab: ShellTab?
    /// The session's `applyEvent` count the visit last applied (CODEX-IN08-1): only a new one applies the weather again.
    @ObservationIgnored private var appliedEvents = -1
    @ObservationIgnored private var retryShown = false
    /// The screen size in points (`screen.width`, `screen.height`), for the chart and header sizes.
    @ObservationIgnored var screenSize: CGSize

    init(session: WeatherSession, shell: ShellModel, screenSize: CGSize) {
        self.session = session
        self.shell = shell
        self.screenSize = screenSize
        catalog = Catalog(code: shell.locale.catalog)
        texts = Self.texts(catalog)
        shell.onRefresh = { [weak self] tab in
            // The Air tab's reload is the same `reloadEvent 'tab'` (IN-09 shows its page).
            if tab != .search { self?.session.reload(.tab) }
        }
        observe()
    }

    /// The strings of ForecastPage and the charts from the shell's catalog, with English and then the key as fallbacks.
    static func texts(_ catalog: Catalog) -> ChartTexts {
        var strings: [String: String] = [:]
        for key in Set(ForecastPage.keys + ChartTexts.keys + ["LOC_ERROR", "LOC_FAIL_TO_GET_WEATHER_INFO", "LOC_OK"]) {
            strings[key] = catalog(key)
        }
        return ChartTexts(strings)
    }

    /// An entry event after the migration: the launch is TabCtrl's `init` (`reloadEvent 'init'`), a return from the
    /// background Cordova's `resume` (gated).
    func handle(_ event: EntryEvent) {
        switch event {
        case .launch: session.reload(.initial)
        case .resume: session.reload(.resume)
        case .notification, .link: break
        }
    }

    // MARK: - The page's scope

    /// Keeps the shown page's scope current: a new visit when a weather tab opens, an apply at each `applyEvent`, the
    /// selected place's photo when the feed gives it one (`loadWeatherPhotosEvent`), the retry confirmation while the
    /// session asks for it. The holder replaces the whole state on every save, so a change is told apart here: the
    /// expander and the settings apply nothing (CODEX-IN08-1).
    private func observe() {
        withObservationTracking {
            _ = shell.selected
            _ = shell.screen
            _ = session.applies
            _ = session.retry
            _ = session.selected?.photo
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                self?.update()
                self?.observe()
            }
        }
        update()
    }

    private func update() {
        let tab = shell.selected
        if case .start = shell.screen {
            scope = nil
            visitTab = nil
        } else if tab == .forecast || tab == .dailyforecast {
            if visitTab != tab || scope == nil {
                openVisit(tab)
            } else if session.applies != appliedEvents {
                applySelected()
            } else {
                photoLoaded()
            }
        } else {
            scope = nil
            visitTab = nil
        }
        if session.retry && !retryShown { showRetry() }
    }

    /// ForecastCtrl's `init`: the sizes, `expandShortChart`, the enabled places, then `applyWeatherData`.
    private func openVisit(_ tab: ShellTab) {
        guard let state = shell.holder.state else { return }
        visitTab = tab
        var visit = ForecastScope(
            type: tab == .forecast ? .short : .mid,
            metrics: ChartMetrics(bodyWidth: screenSize.width, bodyHeight: screenSize.height),
            fahrenheit: state.units.temperatureUnit == "F", photoTheme: state.settings.theme == "photo",
            yesterday: YesterdayText(same: texts["LOC_SAME_AS_YESTERDAY"], than: texts["LOC_THAN_YESTERDAY"]),
            expandShortChart: state.expandShortChart)
        let enabled = PlaceIndex.enabledCount(state.places.map(\.disable))
        // No enabled place: Cordova opens the start choice O02 instead (IN-10).
        visit.open(selectedRecord(), enabledCount: enabled, hasPush: hasPush(state))
        appliedEvents = session.applies
        scope = visit
    }

    /// `applyEvent`: the selected place again, with the units and theme as they are now.
    private func applySelected() {
        guard var visit = scope, let state = shell.holder.state else { return }
        visit.fahrenheit = state.units.temperatureUnit == "F"
        visit.photoTheme = state.settings.theme == "photo"
        visit.apply(selectedRecord(), hasPush: hasPush(state))
        appliedEvents = session.applies
        scope = visit
    }

    /// `loadWeatherPhotosEvent`: in the photo theme the page takes the selected place's new photo, without an apply (the
    /// charts stay where they are).
    private func photoLoaded() {
        guard var visit = scope, let state = shell.holder.state else { return }
        visit.photoTheme = state.settings.theme == "photo"
        let before = visit.photo
        visit.photoLoaded(selectedRecord())
        if visit.photo != before { scope = visit }
    }

    private func selectedRecord() -> JSONObject? {
        guard let place = session.selected else { return nil }
        return session.record(place)
    }

    /// `Push.hasPushInfo(cityIndex)`: an enabled alert or alarm record of the selected place.
    private func hasPush(_ state: AppState) -> Bool {
        state.push.records.contains { record in
            record["cityIndex"]?.numberValue?.double == Double(state.placeIndex) && Js.truthy(record["enable"])
        }
    }

    // MARK: - The page

    /// The bell (`goPushPage`, IN-14) and share (`doTabShare`, IN-16) buttons; those tasks connect them.
    @ObservationIgnored var onBell: () -> Void = {}
    @ObservationIgnored var onShare: () -> Void = {}

    /// The units the pages show (`Units.getUnit`).
    static func units(_ u: UnitSettings) -> PageUnits {
        PageUnits(temperature: u.temperatureUnit, windSpeed: u.windSpeedUnit, pressure: u.pressureUnit, distance: u.distanceUnit,
                  precipitation: u.precipitationUnit, air: u.airUnit)
    }

    /// The page model of the shown visit.
    var pageContent: WeatherPageContent? {
        guard let scope, let state = shell.holder.state else { return nil }
        let photo = scope.photo?.stringValue.flatMap { URL(string: $0) }
        return WeatherPageContent(scope: scope, units: Self.units(state.units), texts: texts, photo: photo)
    }

    /// What the shell shows on a weather tab: the place's title with the location glyph or the spinner, the bell and
    /// share buttons, and the page. Nil on other tabs and before the visit applied (the shell's default).
    func content(_ tab: ShellTab) -> TabContent? {
        guard tab == visitTab, let content = pageContent, let state = shell.holder.state else { return nil }
        let theme = Theme.of(state.settings.theme)
        let colors = ShellColors.of(theme, tab: tab)
        let actions = WeatherPageActions(
            toggleExpanded: { [weak self] in self?.toggleExpanded() },
            previous: { [weak self] in self?.session.previous() },
            next: { [weak self] in self?.session.next() },
            perform: { [weak self] in self?.perform($0) })
        return TabContent(
            title: content.page.title,
            titleAccessory: titleAccessory(content.page, colors: colors),
            actions: AnyView(WeatherBarActions(hasPush: content.page.hasPush, colors: colors,
                                               onBell: { [weak self] in self?.onBell() }, onShare: { [weak self] in self?.onShare() })),
            page: AnyView(WeatherPageView(content: content, theme: theme, actions: actions)
                .accessibilityIdentifier("forecast-page-\(tab.rawValue)")))
    }

    /// Inside the title: the current position's location glyph (`location_on` while location is allowed, else
    /// `location_off`; a tap opens the settings) unless the place loads; the spinner (O17) while it loads.
    private func titleAccessory(_ page: ForecastPage, colors: ShellColors) -> AnyView? {
        if session.loadingSelected {
            return AnyView(BubblesSpinner().padding(.leading, 4).accessibilityIdentifier("forecast-spinner"))
        }
        guard page.currentPosition else { return nil }
        return AnyView(Button { [weak self] in self?.locationGlyphTapped() } label: {
            Text(Self.locationEnabled ? Glyphs.locationOn : Glyphs.locationOff)
                .font(Glyphs.material(24)).foregroundStyle(colors.headerText.color)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("location")
        .accessibilityIdentifier("forecast-location"))
    }

    // MARK: - Actions

    /// `clickExpander`: the hourly chart's detail rows, stored as `expandShortChart`.
    func toggleExpanded() {
        guard var visit = scope else { return }
        visit.expand.toggle()
        scope = visit
        let expand = visit.expand
        shell.holder.change { $0.expandShortChart = expand }
    }

    /// What a tap on a part of the page opens.
    func perform(_ action: PageAction) {
        switch action {
        case .airInfo:
            // `goAirInfoPage(code)`: the Air tab (IN-09 opens it on the pollutant).
            shell.select(.air)
        case .units:
            // `goUnitsPage()`: the units page (IN-12).
            shell.onMenuRow(.units)
        case .airForecastInfo(let source):
            // `popUpAirForecastInfo`: the source's description for kaq and airkorea; nothing for others.
            let key = source == "kaq" ? "LOC_KAQ_DESCRIPTION" : source == "airkorea" ? "LOC_AIRKOREA_DESCRIPTION" : nil
            guard let key else { return }
            shell.show(Popup(title: "", lines: [texts[key]], buttons: [Popup.Button(text: texts["LOC_CLOSE"])]))
        case .pollen(let rows):
            shell.show(pollenPopup(rows))
        case .url(let url):
            // `openUrl`: the system browser (`window.open(src, '_system')` on the device).
            if let url = URL(string: url) { UIApplication.shared.open(url) }
        }
    }

    /// `showPollenInfo`: per pollen type its label and grade, the information and the advice, then the source.
    func pollenPopup(_ rows: [PollenRow]) -> Popup {
        var lines: [String] = []
        for row in rows {
            lines.append("\(texts[row.labelKey]): \(row.gradeLabel)")
            lines.append(texts[row.infoKey])
            lines.append(texts[row.adviceKey])
        }
        lines.append(texts["LOC_POLLEN_SOURCE"])
        return Popup(title: texts["LOC_POLLEN_RISK"], lines: lines, buttons: [Popup.Button(text: texts["LOC_CLOSE"])])
    }

    /// O03 `weather`: `LOC_ERROR`, `LOC_FAIL_TO_GET_WEATHER_INFO`, Close and OK (positive); OK reloads.
    private func showRetry() {
        retryShown = true
        shell.show(Popup(title: texts["LOC_ERROR"], lines: [texts["LOC_FAIL_TO_GET_WEATHER_INFO"]], buttons: [
            Popup.Button(text: texts["LOC_CLOSE"]) { [weak self] in
                self?.retryShown = false
                self?.session.closeRetry()
            },
            Popup.Button(text: texts["LOC_OK"], style: .positive) { [weak self] in
                self?.retryShown = false
                self?.session.confirmRetry()
            },
        ]))
    }

    /// The header's location glyph (`switchToLocationSettings`): while location is not allowed it opens the app's
    /// settings; the selected place may load again (`reloadCity`).
    func locationGlyphTapped() {
        if !Self.locationEnabled, let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
        if let place = session.selected { session.repository.invalidate(place) }
    }

    /// `Util.isLocationEnabled()` on iOS: when-in-use or always authorization.
    static var locationEnabled: Bool {
        let status = CLLocationManager().authorizationStatus
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }
}
