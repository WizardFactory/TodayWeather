import Foundation
import Observation
import SwiftUI
import TWData
import TWDomain
import UIKit

/// The weather pages' hand-offs of IN-10 (#2959) over IN-08's `WeatherScreens`: the start choice O02 (TabCtrl's
/// `startPopup`, opened with no enabled place by a weather page's visit or a tap on a weather or Air tab) and O03's
/// position variants (`showRetryConfirm(…, 'forecast')` after a failed lookup of the current position), shown through
/// the shell's popups. The previous `onTabTap` hook keeps running when no start choice is needed.
@MainActor
final class CurrentPositionPopups {
    private let session: WeatherSession
    private let shell: ShellModel
    private let catalog: Catalog
    private let openURL: (URL) -> Void
    private var startPopupID: UUID?
    private var retryPopupID: UUID?
    private var shownRetry: RetryConfirm?

    init(session: WeatherSession, shell: ShellModel, openURL: @escaping (URL) -> Void = { UIApplication.shared.open($0) }) {
        self.session = session
        self.shell = shell
        self.openURL = openURL
        catalog = Catalog(code: shell.locale.catalog)
        let previous = shell.onTabTap
        shell.onTabTap = { [weak self] tab in
            // `doTabForecast` (Hourly, Daily, Air): with no enabled place the start choice instead.
            if tab != .search, let self, self.enabledCount == 0 {
                self.session.openStartPopup()
                return true
            }
            return previous(tab)
        }
        observe()
    }

    private var enabledCount: Int { PlaceIndex.enabledCount(shell.holder.state?.places.map(\.disable) ?? []) }

    private func observe() {
        withObservationTracking {
            _ = session.startPopup
            _ = session.positionRetry
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observe() }
        }
        update()
    }

    private func update() {
        if session.startPopup && startPopupID == nil { showStartChoice() }
        if !session.startPopup, let id = startPopupID {
            shell.dismiss(id)
            startPopupID = nil
        }
        if let confirm = session.positionRetry, confirm != shownRetry || retryPopupID == nil {
            if let id = retryPopupID { shell.dismiss(id) }
            showRetry(confirm)
        } else if session.positionRetry == nil, let id = retryPopupID {
            // Closed by the session (a weather failure's confirmation replaced it), or by its own button.
            shell.dismiss(id)
            retryPopupID = nil
            shownRetry = nil
        }
    }

    /// O02: the two radio rows on `data.autoSearch` (Cordova's inverted values kept, A07) and OK. OK's answer true
    /// enables the current position and loads it on Hourly; false opens the Locations tab (S02, IN-11).
    private func showStartChoice() {
        let popup = Popup(title: "", lines: [], buttons: [], custom: AnyView(StartChoiceView(session: session, catalog: catalog) { [weak self] in
            self?.answerStartChoice()
        }))
        startPopupID = popup.id
        shell.show(popup)
    }

    private func answerStartChoice() {
        if let id = startPopupID { shell.dismiss(id) }
        startPopupID = nil
        if session.startChoice() {
            shell.select(.forecast)
        } else {
            shell.select(.search)
        }
    }

    /// O03 `forecast`: `LOC_ERROR`, the message's lines and the variant's buttons.
    private func showRetry(_ confirm: RetryConfirm) {
        let popup = Popup(title: catalog("LOC_ERROR"), lines: confirm.lines.map(catalog.callAsFunction),
                          buttons: confirm.buttons.map { button in
                              Popup.Button(text: catalog(button.key), style: button.positive ? .positive : .standard) { [weak self] in
                                  self?.retryButton(button)
                              }
                          })
        retryPopupID = popup.id
        shownRetry = confirm
        shell.show(popup)
    }

    private func retryButton(_ button: RetryButton) {
        retryPopupID = nil
        shownRetry = nil
        switch button {
        case .close:
            session.closePositionRetry()
        case .search:
            // `disableCity(true)` and `/tab/search`.
            session.searchInsteadOfPosition()
            shell.select(.search)
        case .settings:
            session.closePositionRetry()
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        case .retry:
            session.confirmPositionRetry()
        }
    }
}

/// O02 (`.ionic_popup`: no head, 280 pt, white): two `ion-radio` rows and OK. A row is 16 pt #444 with 16 pt around and
/// room for the check mark at the right (`ion-checkmark` 24 pt, 14 pt in); the chosen row is #f7f7f7. The buttons'
/// row has no padding and is 44 pt high: one positive OK.
struct StartChoiceView: View {
    let session: WeatherSession
    let catalog: Catalog
    let onOK: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            row(catalog("LOC_USE_YOUR_CURRENT_LOCATION"), value: false)
            row(catalog("LOC_FIND_LOCATION_BY_NAME"), value: true)
            Button(action: onOK) {
                FixedCssLine(text: catalog("LOC_OK"), size: 15, weight: .bold, color: CssColor(0xFFFFFF), height: 20)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(CssColor(0x387EF5).color)
                    .opacity(0.87)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("start-choice-ok")
        }
        .frame(width: 280)
        .background(Color.white)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("start-choice")
    }

    private func row(_ label: String, value: Bool) -> some View {
        let checked = session.autoSearch == value
        return Button { session.chooseAutoSearch(value) } label: {
            ZStack(alignment: .trailing) {
                Text(label).font(.system(size: 16)).foregroundStyle(CssColor(0x444444).color)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 16).padding(.trailing, 64).padding(.vertical, 16)
                if checked {
                    Text(Glyphs.checkmark).font(Glyphs.ionicons(24)).foregroundStyle(CssColor(0x444444).color)
                        .padding(.trailing, 14)
                }
            }
            .frame(minHeight: 52)
            .background(checked ? CssColor(0xF7F7F7).color : Color.white)
            .overlay(alignment: .bottom) { CssColor(0xDDDDDD).color.frame(height: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("start-choice-\(value)")
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
