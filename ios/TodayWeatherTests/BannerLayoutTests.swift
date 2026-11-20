import SwiftUI
import Testing
import TWDomain
import UIKit
@testable import TodayWeather

/// The tab bar keeps its home-indicator inset and menus can use the whole shell.
extension HostedShellTests {
@MainActor
struct BannerLayoutTests {
    static let size = CGSize(width: 393, height: 852)
    /// An iPhone 16's insets: a 54 pt status bar, 5 pt more top safe area, the 34 pt home indicator.
    static let insets = ShellInsets(statusBar: 54, top: 5, bottom: 34, leading: 0, trailing: 0)
    @Test func withoutABannerTheTabBarKeepsTheHomeIndicatorPadding() async throws {
        let shell = ShellFixture.shell()
        let hosted = try HostedView(ShellFrame(model: shell, insets: Self.insets).ignoresSafeArea(), size: Self.size)
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
