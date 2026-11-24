import CoreLocation
import Foundation
import SwiftUI
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit

/// The weather pages S03 (Hourly) and S04 (Daily) in the shell (IN-08, #2957) and the air page S05 (IN-09, #2958):
/// TabCtrl's loading (`WeatherSession`), ForecastCtrl's scope for the shown weather page (`ForecastScope`) and AirCtrl's
/// for the air page (`AirScope`), connected to the shell's hooks: the opening and a return to the foreground reload
/// (`reloadEvent` `init` and `resume`), pulling down on a forecast or air page refreshes its place, and a failure shows the
/// retry confirmation O03. State writes go through the `AppStateHolder`.
@MainActor
@Observable
final class WeatherScreens {
    let session: WeatherSession
    let shell: ShellModel
    @ObservationIgnored private let catalog: Catalog
    @ObservationIgnored let texts: ChartTexts
    /// The scope of the weather page shown now (ForecastCtrl, not cached: a new visit each time the tab opens).
    private(set) var scope: ForecastScope?
    /// The tab whose visit `scope` or `airScope` is.
    @ObservationIgnored private var visitTab: ShellTab?
    /// The scope of the air page shown now (AirCtrl, not cached: a new visit each time the Air tab opens).
    private(set) var airScope: AirScope?
    /// The `applyEvent`s the air visit has seen (`session.applies` when it last applied).
    @ObservationIgnored private var airApplies = 0
    /// The pollutant in the URL (`/tab/air?code=`): set by `goAirInfoPage(code)`, kept while the weather tabs change the
    /// path (`$location.path`), cleared by the Locations tab (`href="#/tab/search"`). The Air tab opens on it.
    private(set) var airLink: String?
    /// The session's `applyEvent` count the visit last applied (CODEX-IN08-1): only a new one applies the weather again.
    @ObservationIgnored private var appliedEvents = -1
    /// Page visits opened so far: each is a new chart identity (CODEX-IN08-3).
    private(set) var visits = 0
    @ObservationIgnored private var retryShown = false
    @ObservationIgnored private var retryPopupID: UUID?
    /// The window's size in points, for the chart and header sizes (`initSize`'s `bodyWidth` and `bodyHeight`; CODEX-IN08-2):
    /// the screen until the page reports its window, then the window as it is resized.
    @ObservationIgnored private(set) var screenSize: CGSize

    init(session: WeatherSession, shell: ShellModel, screenSize: CGSize) {
        self.session = session
        self.shell = shell
        self.screenSize = screenSize
        catalog = Catalog(code: shell.locale.catalog)
        texts = Self.texts(catalog)
        observe()
    }

    /// The strings of ForecastPage and the charts from the shell's catalog, with English and then the key as fallbacks.
    static func texts(_ catalog: Catalog) -> ChartTexts {
        var strings: [String: String] = [:]
        for key in Set(ForecastPage.keys + AirPage.keys + ChartTexts.keys + ["LOC_ERROR", "LOC_FAIL_TO_GET_WEATHER_INFO", "LOC_OK"]) {
            strings[key] = catalog(key)
        }
        return ChartTexts(strings)
    }

    /// An entry event after the migration: the launch is TabCtrl's `init` (`reloadEvent 'init'`), a return from the
    /// background Cordova's `resume` (gated).
    func handle(_ event: EntryEvent) {
        // While S01 shows TabCtrl does not exist yet: its `init` runs when S01 closes (IN-10, `AppLaunch.startClosed`).
        if case .start = shell.screen { return }
        switch event {
        case .launch: session.reload(.initial)
        case .resume:
            if scope?.summaryExpiresAt != nil { applySelected() }
            session.reload(.resume)
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
            _ = session.selected
            _ = shell.holder.state?.units
            // The units page's air standard goes to the air visit as it is (`changeAirUnitEvent`).
            _ = shell.holder.state?.units.airUnit
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                self?.update()
                self?.observe()
            }
        }
        update()
    }

    /// Back from S09 (IN-14): the shown page starts anew (`cache: false`), so the bell is read again.
    func reopen() {
        visitTab = nil
        update()
    }

    private func update() {
        let tab = shell.selected
        if tab == .search { airLink = nil }
        if case .start = shell.screen {
            scope = nil
            airScope = nil
            visitTab = nil
        } else if tab == .forecast || tab == .dailyforecast {
            airScope = nil
            if visitTab != tab || scope == nil {
                openVisit(tab)
            } else if session.applies != appliedEvents {
                applySelected()
            } else if scope?.summaryExpiresAt != nil,
                      selectedRecord()?["currentWeather"]?["summary"]?.stringValue != scope?.summary?.stringValue {
                applySelected()
            } else {
                photoLoaded()
            }
        } else if tab == .air {
            scope = nil
            if visitTab != tab || airScope == nil { openAirVisit() } else { applyAir() }
        } else {
            scope = nil
            airScope = nil
            visitTab = nil
        }
        if session.retry && !retryShown { showRetry() }
        // A position confirmation replaced it (`showRetryConfirm` closes the open one; IN-10).
        if !session.retry && retryShown, let id = retryPopupID {
            shell.dismiss(id)
            retryShown = false
            retryPopupID = nil
        }
    }

    /// AirCtrl's `init`: the sizes, the pollutant of the link (`?code=`, else the overall index), the enabled places, then
    /// `_applyWeatherData`.
    private func openAirVisit() {
        guard let state = session.state else { return }
        visitTab = .air
        var visit = AirScope(metrics: ChartMetrics(bodyWidth: screenSize.width, bodyHeight: screenSize.height),
                             airUnit: state.units.airUnit)
        let enabled = PlaceIndex.enabledCount(state.places.map(\.disable))
        // No enabled place: AirCtrl only stops (the Air tab's tap opened O02 before, IN-10).
        visit.open(selectedRecord(), code: airLink, enabledCount: enabled, hasPush: hasPush(state))
        airApplies = session.applies
        airScope = visit
    }

    /// The air visit follows the session: each `applyEvent` returns to the first station and applies the selected place;
    /// a new standard from the units page goes to the visit as it is (`changeAirUnitEvent`).
    private func applyAir() {
        guard var visit = airScope, let state = session.state else { return }
        if visit.airUnit != state.units.airUnit { visit.airUnit = state.units.airUnit }
        if airApplies != session.applies {
            airApplies = session.applies
            let enabled = PlaceIndex.enabledCount(state.places.map(\.disable))
            visit.applyEvent(selectedRecord(), enabledCount: enabled, hasPush: hasPush(state))
        }
        airScope = visit
    }

    /// A detail cell (`setMainAqiCode`): its pollutant on the place last applied; the page goes to the top.
    func selectAirCode(_ code: String) {
        guard var visit = airScope else { return }
        visit.setCode(code)
        airScope = visit
    }

    /// A link's tab (#3097): Hourly, Daily, or Air on its pollutant as a new visit (`goAirInfoPage(code)`).
    func openLinkTab(_ tab: ShellTab, pollutant: String?) {
        if tab == .air {
            airLink = pollutant
            if shell.selected == .air { visitTab = nil }
        }
        shell.select(tab)
        update()
    }

    /// The main box's current weather (`goWeather()`): S03 (`$location.path('/tab/forecast')`; the link's pollutant stays
    /// in the URL).
    func airWeatherTapped() {
        shell.select(.forecast)
    }

    /// A station cell (`setStation`): its values; the page goes to the top.
    func selectAirStation(_ index: Int) {
        guard var visit = airScope else { return }
        visit.setStation(index)
        airScope = visit
    }

    /// ForecastCtrl's `init`: the sizes, `expandShortChart`, the enabled places, then `applyWeatherData`.
    private func openVisit(_ tab: ShellTab) {
        guard let state = session.state else { return }
        visitTab = tab
        var visit = ForecastScope(
            type: tab == .forecast ? .short : .mid,
            metrics: ChartMetrics(bodyWidth: screenSize.width, bodyHeight: screenSize.height),
            fahrenheit: state.units.temperatureUnit == "F", photoTheme: state.settings.theme == "photo",
            yesterday: YesterdayText(same: texts["LOC_SAME_AS_YESTERDAY"], than: texts["LOC_THAN_YESTERDAY"]),
            expandShortChart: state.expandShortChart)
        let enabled = PlaceIndex.enabledCount(state.places.map(\.disable))
        // No enabled place: the start choice O02 instead (IN-10, `CurrentPositionPopups`).
        if !visit.open(selectedRecord(), enabledCount: enabled, hasPush: hasPush(state)) { session.openStartPopup() }
        appliedEvents = session.applies
        visits += 1
        scope = visit
    }

    /// `applyEvent`: the selected place again, with the units and theme as they are now.
    private func applySelected() {
        guard var visit = scope, let state = session.state else { return }
        visit.fahrenheit = state.units.temperatureUnit == "F"
        visit.photoTheme = state.settings.theme == "photo"
        visit.apply(selectedRecord(), hasPush: hasPush(state))
        appliedEvents = session.applies
        scope = visit
    }

    /// The page's window has a new size (it opened, rotated or was resized). Cordova's `initSize` measures once per page
    /// visit, from `window.screen` (the WebView filled the screen); the native window can be smaller than the screen (Split
    /// View, Stage Manager) and change while the page is open, so the visit starts again with the window's sizes: the
    /// header, the fonts and the chart columns follow it, and the charts open at today's position again.
    func windowChanged(_ size: CGSize) {
        guard size.width > 0, size.height > 0, size != screenSize else { return }
        screenSize = size
        guard let tab = visitTab else { return }
        // The air page measures the same way (AirCtrl's `initSize`), so its visit starts again too.
        if tab == .air {
            if airScope != nil { openAirVisit() }
        } else if scope != nil {
            openVisit(tab)
        }
    }

    /// `loadWeatherPhotosEvent`: in the photo theme the page takes the selected place's new photo, without an apply (the
    /// charts stay where they are).
    private func photoLoaded() {
        guard var visit = scope, let state = session.state else { return }
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

    /// The bell (`goPushPage`, IN-14) and share (`doTabShare`, IN-16) buttons.
    @ObservationIgnored var onBell: () -> Void = {}
    @ObservationIgnored var onShare: () -> Void = {}
    /// The search button beside the place name (#3180): S02's search from this tab.
    @ObservationIgnored var onSearch: (ShellTab) -> Void = { _ in }
    /// The star of an unsaved place (#3180): saves it.
    @ObservationIgnored var onStar: () -> Void = {}
    /// Whether the selected place of the shown state is the unsaved one (`UnsavedPlaces.isSelected`).
    @ObservationIgnored var isUnsaved: (AppState) -> Bool = { _ in false }
    /// The header's texts that the Cordova catalogs lack (#3180).
    @ObservationIgnored lazy var linkTexts = LinkTexts.of(shell.locale.catalog)

    /// The room the weather pages' title leaves on each side: the bell or star and share at the right (#3180).
    static let titleClearance: CGFloat = 86

    /// The units the pages show (`Units.getUnit`).
    static func units(_ u: UnitSettings) -> PageUnits {
        PageUnits(temperature: u.temperatureUnit, windSpeed: u.windSpeedUnit, pressure: u.pressureUnit, distance: u.distanceUnit,
                  precipitation: u.precipitationUnit, air: u.airUnit)
    }

    /// The page model of the shown visit.
    var pageContent: WeatherPageContent? {
        guard let scope, let state = session.state else { return nil }
        let photo = scope.photo?.stringValue.flatMap { URL(string: $0) }
        var content = WeatherPageContent(scope: scope, units: Self.units(state.units), texts: texts, photo: photo)
        content.visit = visits
        return content
    }

    /// The air page model of the shown visit.
    var airContent: AirPageContent? {
        airScope.map { AirPageContent(scope: $0, texts: texts) }
    }

    /// What the shell shows on a weather or the air tab: the place's title with the location glyph or the spinner, the
    /// bell and share buttons, and the page. Nil on other tabs and before the visit applied (the shell's default).
    func content(_ tab: ShellTab) -> TabContent? {
        if tab == .air { return airTabContent() }
        // The scope is read first, so a shell drawn before the visit opened (S01 just closed, IN-10) is drawn again
        // when it does.
        guard let content = pageContent, tab == visitTab, let state = session.state else { return nil }
        let theme = Theme.of(state.settings.theme)
        let colors = ShellColors.of(theme, tab: tab)
        let actions = WeatherPageActions(
            toggleExpanded: { [weak self] in self?.toggleExpanded() },
            refresh: session.refresh,
            previous: { [weak self] in self?.session.previous() },
            next: { [weak self] in self?.session.next() },
            perform: { [weak self] in self?.perform($0) })
        return TabContent(
            title: content.page.title,
            titleLeading: titleLeading(content.page.currentPosition, colors: colors, tappable: true),
            titleAccessory: titleAccessory(tab, colors: colors),
            titleClearance: Self.titleClearance,
            actions: barActions(content.page.hasPush, state: state, colors: colors),
            page: AnyView(WeatherPageView(content: content, theme: theme, actions: actions,
                                          trackingNotice: trackingNotice(colors: WeatherColors.of(theme, daily: tab == .dailyforecast)))
                .task(id: scope?.summaryExpiresAt) { [weak self] in
                    guard let expiry = self?.scope?.summaryExpiresAt else { return }
                    do {
                        try await Task.sleep(for: .seconds(max(0, expiry.timeIntervalSinceNow)))
                    } catch { return }
                    self?.applySelected()
                }
                .background(WindowSizeReader { [weak self] size in self?.windowChanged(size) })
                .accessibilityIdentifier("forecast-page-\(tab.rawValue)")))
    }

    /// S05 in the shell: the title, the location glyph (inert on S05: `switchToLocationSettings` is ForecastCtrl's, A10)
    /// or the spinner, the bell and share buttons, and the page with its taps.
    private func airTabContent() -> TabContent? {
        guard let content = airContent, visitTab == .air, let state = session.state else { return nil }
        let theme = Theme.of(state.settings.theme)
        let colors = ShellColors.of(theme, tab: .air)
        let actions = AirPageActions(
            refresh: session.refresh,
            previous: { [weak self] in self?.session.previous() },
            next: { [weak self] in self?.session.next() },
            code: { [weak self] in self?.selectAirCode($0) },
            station: { [weak self] in self?.selectAirStation($0) },
            weather: { [weak self] in self?.airWeatherTapped() },
            perform: { [weak self] in self?.perform($0) })
        return TabContent(
            title: content.page.title,
            titleLeading: titleLeading(content.page.currentPosition, colors: colors, tappable: false),
            titleAccessory: titleAccessory(.air, colors: colors),
            titleClearance: Self.titleClearance,
            actions: barActions(content.page.hasPush, state: state, colors: colors),
            page: AnyView(AirPageView(content: content, theme: theme, actions: actions,
                                      trackingNotice: trackingNotice(colors: AirColors.of(theme).page))
                .background(WindowSizeReader { [weak self] size in self?.windowChanged(size) })
                .accessibilityIdentifier("air-page")))
    }

    private func trackingNotice(colors: WeatherColors) -> TrackingNotice? {
        guard shell.trackingStatus == .denied else { return nil }
        return TrackingNotice(catalog: catalog, colors: colors) { [weak shell] in shell?.chooseMenuRow(.trackingPermission) }
    }

    /// Before the title (#3180: moved from after it): the current position's location glyph (`location_on` while location
    /// is allowed, else `location_off`) unless the place loads. On S03 and S04 a tap opens the settings; on S05 it is inert
    /// (`switchToLocationSettings` is ForecastCtrl's, A10).
    private func titleLeading(_ currentPosition: Bool, colors: ShellColors, tappable: Bool) -> AnyView? {
        guard currentPosition, !session.loadingSelected else { return nil }
        let glyph = Text(Self.locationEnabled ? Glyphs.locationOn : Glyphs.locationOff)
            .font(Glyphs.material(24)).foregroundStyle(colors.headerText.color)
            .padding(.trailing, 2)
        guard tappable else { return AnyView(glyph.accessibilityIdentifier("air-location")) }
        return AnyView(Button { [weak self] in self?.locationGlyphTapped() } label: { glyph }
            .buttonStyle(.plain)
            .accessibilityLabel("location")
            .accessibilityIdentifier("forecast-location"))
    }

    /// After the title: the spinner (O17) while the place loads, then the search button (#3180), which opens S02's
    /// search from `tab`. The button keeps a 44 × 44 pt touch area (CODEX-3195-6).
    private func titleAccessory(_ tab: ShellTab, colors: ShellColors) -> AnyView {
        let spinner = session.loadingSelected
        let search = linkTexts.search
        return AnyView(HStack(spacing: 0) {
            if spinner {
                BubblesSpinner().padding(.leading, 4)
                    .accessibilityIdentifier(tab == .air ? "air-spinner" : "forecast-spinner")
            }
            Button { [weak self] in self?.onSearch(tab) } label: {
                Text(Glyphs.iosSearch)
                    .font(Glyphs.ionicons(22)).foregroundStyle(colors.headerText.color)
                    .outlined(colors.headerOutline)
                    .frame(width: 44, height: ShellMetrics.headerHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(search)
            .accessibilityIdentifier("forecast-search")
        })
    }

    /// The bell, or the star of an unsaved place (#3180), and share.
    private func barActions(_ hasPush: Bool, state: AppState, colors: ShellColors) -> AnyView {
        AnyView(WeatherBarActions(hasPush: hasPush, colors: colors, unsaved: isUnsaved(state), starLabel: linkTexts.addFavorite,
                                  onBell: { [weak self] in self?.onBell() }, onShare: { [weak self] in self?.onShare() },
                                  onStar: { [weak self] in self?.onStar() }))
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
        case .airInfo(let code):
            // `goAirInfoPage(code)`: `/tab/air?code=…`, a new visit of the Air tab on the pollutant.
            airLink = code.isEmpty ? nil : code
            if shell.selected == .air { visitTab = nil }
            shell.select(.air)
            update()
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
        let popup = Popup(title: texts["LOC_ERROR"], lines: [texts["LOC_FAIL_TO_GET_WEATHER_INFO"]], buttons: [
            Popup.Button(text: texts["LOC_CLOSE"]) { [weak self] in
                self?.retryShown = false
                self?.session.closeRetry()
            },
            Popup.Button(text: texts["LOC_OK"], style: .positive) { [weak self] in
                self?.retryShown = false
                self?.session.confirmRetry()
            },
        ])
        retryPopupID = popup.id
        shell.show(popup)
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
