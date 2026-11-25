import SwiftUI
import TWData
import TWDomain
import UIKit

/// Shows the system share sheet with a message.
@MainActor
protocol SharePresenting {
    func present(_ message: String)
}

/// The share button of S03, S04 and S05 (TabCtrl's `doTabShare`, O16; IN-16, #2965): the selected place's Cordova message
/// (`ShareMessage`, V20) in the system share sheet, as the socialsharing plugin showed it on iOS (a
/// `UIActivityViewController` with the text as its only item). Without a selected place or its location nothing is shared;
/// Cordova opens the start choice O02 there (`startPopup`), which IN-10 connects through `onNoLocation`. Port of the
/// Android `WeatherShare` (AN-16).
@MainActor
final class WeatherShare {
    static let shared = WeatherShare(presenter: SystemSharePresenter())

    private let presenter: any SharePresenting
    /// `$scope.startPopup()` (O02, IN-10).
    var onNoLocation: () -> Void = {}

    init(presenter: any SharePresenting) {
        self.presenter = presenter
    }

    /// Connects to the app's launch: each new shell's weather pages get the share button. The previous `onShell` hook keeps
    /// running first.
    func connect(_ launch: AppLaunch) {
        let previous = launch.onShell
        // The hook keeps this share (which holds neither the launch nor the screens) alive.
        launch.onShell = { [weak launch] shell in
            previous(shell)
            if let weather = launch?.weather { self.attach(weather) }
        }
    }

    /// The share button of `screens`' pages shares from them (the button's action keeps this share).
    func attach(_ screens: WeatherScreens) {
        screens.onShare = { [weak screens] in
            guard let screens else { return }
            self.share(from: screens)
        }
    }

    /// `doTabShare`: the selected place's record (`WeatherInfo.getCityOfIndex(getCityIndex())`) with the shell's catalog,
    /// ending with the `link.todayweather.ai` link of the tab shared from (the Air tab with its pollutant; #3097).
    func share(from screens: WeatherScreens) {
        let catalog = Catalog(code: screens.shell.locale.catalog)
        let record = screens.session.selected.map { screens.session.record($0) }
        let view: WeatherView = switch screens.shell.selected {
        case .dailyforecast: .daily
        case .air: .air
        default: .hourly
        }
        guard let message = ShareMessage.build(record, texts: ShareMessage.Texts { catalog($0) }, view: view,
                                               pollutant: view == .air ? screens.airScope?.aqiCode : nil)
        else {
            onNoLocation()
            return
        }
        presenter.present(message)
    }
}

/// The system share sheet over the top view controller of the tapped share button's window (with several windows on
/// iPad, the one the user tapped in, as the Android chooser opens from the calling activity; CODEX-IN16-1). On iPad the
/// sheet is a popover whose arrow points at that button (`ShareAnchor`), and it follows the button when the window turns
/// or is resized.
/// The Cordova plugin (cordova-plugin-x-socialsharing 6.0.4, `getIPadPopupCoordinates` returning nil since 5.5.0) anchored
/// it at the bottom center of the WebView instead (a 400×400 rect below the WebView's bottom edge); that rect remains the
/// fallback when no share button is in a window.
@MainActor
struct SystemSharePresenter: SharePresenting {
    func present(_ message: String) {
        let anchor = ShareAnchor.tapped.flatMap { $0.window == nil ? nil : $0 }
        let window = anchor?.window ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first { $0.isKeyWindow }
        guard var top = window?.rootViewController else { return }
        while let presented = top.presentedViewController, !presented.isBeingDismissed { top = presented }
        top.present(Self.sheet(message, anchor: anchor, fallback: top.view), animated: true)
    }

    /// The plugin's `UIActivityViewController(activityItems: [message])`, anchored at `anchor`, else at the plugin's rect
    /// of `fallback`.
    static func sheet(_ message: String, anchor: UIView?, fallback: UIView) -> UIActivityViewController {
        let sheet = UIActivityViewController(activityItems: [message], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            if let anchor {
                popover.sourceView = anchor
                popover.sourceRect = anchor.bounds
            } else {
                popover.sourceView = fallback
                popover.sourceRect = CGRect(x: fallback.bounds.width / 2 - 200, y: fallback.bounds.height, width: 400, height: 400)
            }
        }
        return sheet
    }
}

/// The view behind the share button that was tapped last, for the share sheet's window and popover
/// (`popoverPresentationController.sourceView`). The button's action sets it before it shares.
@MainActor
enum ShareAnchor {
    static weak var tapped: UIView?
}

/// Holds one header's anchor view, so that header's share button can name it when tapped.
@MainActor
final class ShareAnchorBox {
    weak var view: UIView?
}

/// Placed behind the share button: a transparent view without touches or accessibility, kept in its header's
/// `ShareAnchorBox`. Kept at zero opacity so a rendering of the header (`ImageRenderer` in the screenshot tests, which
/// draws no UIKit view) shows nothing of it.
struct ShareAnchorView: UIViewRepresentable {
    let box: ShareAnchorBox

    func makeUIView(context: Context) -> AnchorView {
        let view = AnchorView()
        box.view = view
        return view
    }

    func updateUIView(_ uiView: AnchorView, context: Context) { box.view = uiView }

    final class AnchorView: UIView {
        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            isAccessibilityElement = false
            backgroundColor = .clear
        }

        required init?(coder: NSCoder) { nil }

        /// Never the share button's identifier: the button is the element a tap or VoiceOver reaches.
        override var accessibilityIdentifier: String? {
            get { nil }
            set {}
        }
    }
}
