import SwiftUI
import UIKit

/// The status bar's content style as the Cordova app sets it (`StatusBar.styleLightContent()` or `styleDefault()`,
/// which cordova-plugin-statusbar 4.0.0 maps to dark content on iOS 13 and later, whatever the system appearance).
/// The app's Info.plist turns view-controller-based status bar appearance off (as the plugin's
/// `UIViewControllerBasedStatusBarAppearance` false), so the style is the application's, as in the Cordova build; the
/// background behind the status bar is drawn by the shell (`ShellColors.statusBar`).
private struct StatusBarStyle: ViewModifier {
    let lightContent: Bool

    func body(content: Content) -> some View {
        content
            .onAppear { apply() }
            .onChange(of: lightContent) { apply() }
    }

    private func apply() {
        UIApplication.shared.applyStatusBarStyle(lightContent ? .lightContent : .darkContent)
    }
}

extension View {
    func statusBarStyle(lightContent: Bool) -> some View {
        modifier(StatusBarStyle(lightContent: lightContent))
    }
}

extension UIApplication {
    /// The application-wide status bar style (deprecated API, still the one that applies while
    /// `UIViewControllerBasedStatusBarAppearance` is false).
    @available(iOS, deprecated: 9.0)
    func applyStatusBarStyle(_ style: UIStatusBarStyle) {
        setStatusBarStyle(style, animated: false)
    }
}
