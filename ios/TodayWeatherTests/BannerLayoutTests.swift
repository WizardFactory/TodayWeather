import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

/// Where the banner sits (IN-15, #2964), as the AdMob plugin laid it out on iOS (`EmiBannerManager.updateBannerLayout`,
/// `position: 'bottom-center'`, `isOverlapping: false`): the banner's bottom on the home indicator's inset, black below
/// it; the WebView ends at the banner's top, so the tab bar loses the home indicator's padding, and the side menu and
/// the popups end there too. A 61 pt view stands in for the ad.
extension HostedShellTests {
@MainActor
struct BannerLayoutTests {
    static let size = CGSize(width: 393, height: 852)
    /// An iPhone 16's insets: a 54 pt status bar, 5 pt more top safe area, the 34 pt home indicator.
    static let insets = ShellInsets(statusBar: 54, top: 5, bottom: 34, leading: 0, trailing: 0)
    static let bannerHeight: CGFloat = 61

    static func frame(_ shell: ShellModel, banner: Bool) -> some View {
        let ad = Text("ad").frame(maxWidth: .infinity, minHeight: bannerHeight, maxHeight: bannerHeight)
            .background(Color.red)
        return ShellFrame(model: shell, insets: insets, banner: banner ? AnyView(ad) : nil).ignoresSafeArea()
    }

    @Test func theBannerSitsAboveTheHomeIndicatorAndTheWebViewEndsAtItsTop() async throws {
        let shell = ShellFixture.shell()
        let hosted = try HostedView(Self.frame(shell, banner: true), size: Self.size)
        defer { hosted.close() }
        try await hosted.settle()
        let bannerTop = Self.size.height - Self.insets.bottom - Self.bannerHeight
        // The shell's banner element: the ad and the black strip over the home indicator's inset below it.
        let slot = try #require(hosted.element("shell-banner")).accessibilityFrame
        #expect(abs(slot.minY - bannerTop) < 0.5 && abs(slot.maxY - Self.size.height) < 0.5, "\(slot)")
        let tab = try #require(hosted.element("shell-tab-forecast")).accessibilityFrame
        #expect(abs(tab.maxY - bannerTop) < 1, "the tab bar ends at the banner without the home indicator's padding: \(tab)")

        shell.openMenu()
        #expect(try await hosted.menuInPlace())
        let menu = try #require(hosted.element("shell-menu")).accessibilityFrame
        #expect(abs(menu.maxY - bannerTop) < 0.5, "\(menu)")

        shell.show(Popup(title: "TodayWeather", lines: ["text"], buttons: [.init(text: "OK")]))
        try await hosted.settle()
        let popup = try #require(hosted.element("popup")).accessibilityFrame
        #expect(abs(popup.midY - (Self.insets.statusBar + bannerTop) / 2) < 1, "centered in the WebView's area: \(popup)")
    }

    @Test func withoutABannerTheTabBarKeepsTheHomeIndicatorPadding() async throws {
        let shell = ShellFixture.shell()
        let hosted = try HostedView(Self.frame(shell, banner: false), size: Self.size)
        defer { hosted.close() }
        try await hosted.settle()
        #expect(hosted.element("shell-banner") == nil)
        let tab = try #require(hosted.element("shell-tab-forecast")).accessibilityFrame
        #expect(abs(tab.maxY - (Self.size.height - Self.insets.bottom)) < 1, "\(tab)")
        shell.openMenu()
        #expect(try await hosted.menuInPlace())
        let menu = try #require(hosted.element("shell-menu")).accessibilityFrame
        #expect(abs(menu.maxY - Self.size.height) < 0.5, "\(menu)")
    }
}
}
