import SwiftUI
import TWDomain
import TWResources
import UIKit

/// What a tab shows in the shell: its header bar's title and buttons, and its page. IN-08 and later fill them; the
/// shell's own default shows the selected place's name over an empty page.
struct TabContent {
    var title: String = ""
    /// What precedes the title inside it (#3180: the current position's location glyph).
    var titleLeading: AnyView? = nil
    /// What follows the title inside it (IN-08: the loading spinner; #3180: the search button).
    var titleAccessory: AnyView? = nil
    /// The room the centered title leaves on each side for the bar's buttons (#3180: the weather pages' title with its
    /// search button gives way before the bell and share); 0 keeps the Cordova margins.
    var titleClearance: CGFloat = 0
    var actions: AnyView = AnyView(EmptyView())
    var page: AnyView = AnyView(Color.clear)
    /// What fills the header bar after the menu button instead of the title (IN-11: S02's search field and mode button,
    /// `ion-nav-title` with `p.title.search-header`).
    var titleView: AnyView? = nil
    /// Drawn over the whole shell under the popups (IN-11: `$ionicLoading` of S02).
    var overlay: AnyView? = nil
}

extension EnvironmentValues {
    /// The shell's insets for a tab's page, which lies under the header bar (IN-11: S02 starts its list under it).
    @Entry var shellInsets: ShellInsets = .zero
}

/// The insets of the Cordova iOS layout. The WebView starts under the status bar (`StatusBarOverlaysWebView` false),
/// so the status bar's height is outside it and the rest of the top safe area (5 pt on an iPhone with a Dynamic Island,
/// whose safe area is taller than its status bar) is the WebView's `env(safe-area-inset-top)`, which Ionic adds to the
/// header bar. The bottom and side insets are inside the WebView (`viewport-fit=cover`).
struct ShellInsets: Equatable {
    var statusBar: CGFloat
    var top: CGFloat
    var bottom: CGFloat
    var leading: CGFloat
    var trailing: CGFloat

    static let zero = ShellInsets(statusBar: 0, top: 0, bottom: 0, leading: 0, trailing: 0)

    /// From the window's safe area and the status bar's height (0 while it is hidden, as in landscape on an iPhone).
    @MainActor static func live(_ safe: EdgeInsets) -> ShellInsets {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let bar = min(scene?.statusBarManager?.statusBarFrame.height ?? safe.top, safe.top)
        return ShellInsets(statusBar: bar, top: safe.top - bar, bottom: safe.bottom, leading: safe.leading,
                           trailing: safe.trailing)
    }
}

/// The app's root (IN-07, #2956): the launch image until the Cordova migration has finished, then S01 while
/// `startVersion` asks for it, otherwise the shell.
struct RootView: View {
    let launch: AppLaunch
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if let shell = launch.shell {
                switch shell.screen {
                case .start:
                    // S01 (IN-10), created with the shell while the start gate holds.
                    if let start = launch.startPage { StartView(page: start) } else { SplashView() }
                case .tab: ShellView(model: shell, content: { launch.tabContent($0) },
                                     banner: Monetization.shared.bannerView,
                                     page: launch.pageView)
                        .environment(\.forecastNativeAds, launch.pageScreen == nil ? Monetization.shared.nativeAds : nil)
                        .environment(\.forecastChartRead, { tab in Monetization.shared.chartRead(tab) })
                }
            } else {
                SplashView()
            }
        }
        .onChange(of: phase, initial: true) { _, phase in
            if phase == .active {
                Monetization.shared.refreshEligibility()
                Monetization.shared.nativeAds?.prepareSpare()
            }
        }
        // #3211: a new width loads a new anchored banner.
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { Monetization.shared.windowWidthChanged($0) }
        .task { launch.start(); Monetization.shared.uiStarted() }
    }
}

/// The launch image as the Cordova splash shows it after the launch screen, until the first view: the status bar white
/// with dark content (its state before the theme applies) over the image `Splash`, which fills the screen with aspect
/// fill (cordova-ios CDVLaunchScreen), as captured from the Cordova build (shell-<lang>-splash.png).
struct SplashView: View {
    var body: some View {
        GeometryReader { geometry in
            SplashFrame(size: geometry.size, insets: .live(geometry.safeAreaInsets)).ignoresSafeArea()
        }
        .statusBarStyle(lightContent: false)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("splash")
    }
}

/// `SplashView` for a window of `size` (without the safe area) and `insets`.
struct SplashFrame: View {
    let size: CGSize
    let insets: ShellInsets

    var body: some View {
        let width = size.width + insets.leading + insets.trailing
        let height = size.height + insets.statusBar + insets.top + insets.bottom
        // The image fills the whole screen (the splash view covers the window); the status bar's white background
        // covers its top.
        ZStack(alignment: .top) {
            Image("Splash").resizable().aspectRatio(contentMode: .fill)
                .frame(width: width, height: height).clipped()
            Color.white.frame(height: insets.statusBar)
        }
        .frame(width: width, height: height)
        .background(Color.white)
    }
}

/// Cordova used fixed CSS sizes in the forecast summary and navigation bars.
struct CordovaChromeTextSize: ViewModifier {
    @Environment(\.dynamicTypeSize) private var size

    func body(content: Content) -> some View {
        content.environment(\.dynamicTypeSize, size.isAccessibilitySize ? size : min(size, .large))
    }
}

/// The frame every screen shares (IN-07): the page of the selected tab under its header bar, the bottom tab bar, the
/// full-screen side menu, the popups, laid out as the Cordova iOS
/// build: the status bar in the theme's color (`applyIOSStatusBar`) above the WebView's area; the tab bar reaching the
/// bottom edge with the home indicator's inset inside it (Ionic `.tabs` `padding-bottom: env(safe-area-inset-bottom)`);
/// the header bar keeping the side insets clear.
struct ShellView: View {
    let model: ShellModel
    /// The page of a tab; IN-08 and later give it. Nil (or nil for a tab): the shell's default.
    var content: ((ShellTab) -> TabContent?)? = nil
    /// The anchored banner while it shows (#3211, as IN-15 placed it). The slot is under the tab bar, above the home
    /// indicator, as the AdMob plugin put it (`EmiBannerManager.updateBannerLayout`: the WebView ends at the banner's
    /// top, the banner sits on the home indicator's inset, black below and beside it). Nil: no slot and no reserved space.
    var banner: AnyView? = nil
    /// A page over the tabs and the tab bar, from the status bar down, in the given insets (IN-12's settings pages); nil
    /// while none shows.
    var page: ((ShellInsets) -> AnyView?)? = nil

    var body: some View {
        GeometryReader { geometry in
            ShellFrame(model: model, insets: .live(geometry.safeAreaInsets), content: content, banner: banner, page: page)
                .ignoresSafeArea()
        }
        // `KeyboardResize` false (config.xml): the keyboard covers the page; the tab bar and the layout stay.
        .ignoresSafeArea(.keyboard)
        .statusBarStyle(lightContent: ShellColors.of(model.theme, tab: model.selected).statusBarLightContent)
    }
}

/// The shell for given insets; `ShellView` gives the window's, the screenshot tests their own.
struct ShellFrame: View {
    let model: ShellModel
    let insets: ShellInsets
    var content: ((ShellTab) -> TabContent?)? = nil
    var banner: AnyView? = nil
    var page: ((ShellInsets) -> AnyView?)? = nil
    /// The banner with the strip below it (#3211).
    @State private var bannerHeight: CGFloat = 0

    /// The insets inside the WebView: with a banner the WebView no longer reaches the home indicator.
    private var webViewInsets: ShellInsets {
        banner == nil ? insets : ShellInsets(statusBar: insets.statusBar, top: insets.top, bottom: 0, leading: insets.leading,
                                             trailing: insets.trailing)
    }

    /// The space the banner takes at the bottom, 0 without one.
    private var bannerSpace: CGFloat { banner == nil ? 0 : bannerHeight }

    var body: some View {
        let colors = ShellColors.of(model.theme, tab: model.selected)
        let catalog = Catalog(code: model.locale.catalog)
        let tab = content.flatMap { $0(model.selected) } ?? defaultContent(model.selected)
        // A page over the tabs is in the WebView too: with a banner it ends at the banner's top.
        let over = page.flatMap { $0(webViewInsets) }
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                colors.statusBar.color.frame(height: insets.statusBar)
                ZStack(alignment: .top) {
                    tab.page.modifier(ForecastNativeVisitHost()).id(model.adVisit).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .environment(\.shellInsets, insets)
                        .accessibilityIdentifier("shell-page-\(model.selected.rawValue)")
                    HeaderBar(colors: colors, title: tab.title, titleLeading: tab.titleLeading, titleAccessory: tab.titleAccessory,
                              titleClearance: tab.titleClearance, titleView: tab.titleView,
                              insets: insets, onMenu: model.openMenu) { tab.actions }
                }
                .frame(maxHeight: .infinity)
                // The WebView's area: a page scrolled up must not draw over the status bar (IN-18, seen in the manual's
                // captures of S03 and S05 scrolled down).
                .clipped()
                TabBar(selected: model.selected, colors: colors, catalog: catalog, insets: webViewInsets,
                       onTap: model.tapTab)
                    .modifier(CordovaChromeTextSize())
                if let banner {
                    // Black below the banner, over the home indicator's inset (the plugin's root view).
                    banner.frame(maxWidth: .infinity).padding(.bottom, insets.bottom).background(Color.black)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bannerHeight = $0 }
                        .accessibilityIdentifier("shell-banner")
                }
            }
            .accessibilityHidden(over != nil)
            if let over { over.padding(.bottom, bannerSpace) }
            // The menu covers the WebView's area; the status bar keeps the tab's color (Cordova does not change it).
            GeometryReader { area in
                SideMenu(model: model, catalog: catalog, insets: webViewInsets)
                    .offset(x: model.menuOpen ? 0 : -area.size.width)
                    .animation(.easeInOut(duration: 0.2), value: model.menuOpen)
                    .accessibilityHidden(!model.menuOpen)
            }
            .padding(.top, insets.statusBar)
            .padding(.bottom, bannerSpace)
            if let overlay = tab.overlay {
                overlay.padding(.top, insets.statusBar).padding(.bottom, bannerSpace)
            }
            if let notice = model.notice {
                // The star's short notice (#3180), above the tab bar.
                VStack {
                    Spacer()
                    Text(notice)
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Capsule().fill(Color.black.opacity(0.8)))
                        .padding(.horizontal, 24)
                        .padding(.bottom, ShellMetrics.tabBarHeight + webViewInsets.bottom + bannerSpace + 16)
                }
                .frame(maxWidth: .infinity)
                .allowsHitTesting(false)
                .accessibilityIdentifier("shell-notice")
                .transition(.opacity)
            }
            if let popup = model.popups.first {
                IonicPopupView(popup: popup, onTap: model.tapPopupButton).padding(.top, insets.statusBar)
                    .padding(.bottom, bannerSpace)
            }
        }
        .background(CssColor(0xF5F5F5).color)
    }

    /// The shell's own content: the selected place's name in the header bar of the weather and air tabs.
    private func defaultContent(_ tab: ShellTab) -> TabContent {
        guard tab != .search, let state = model.shownState() ?? model.holder.state, state.places.indices.contains(state.placeIndex) else {
            return TabContent()
        }
        let place = state.places[state.placeIndex]
        return TabContent(title: place.name ?? place.address ?? "")
    }
}

/// A header bar (`.bar.bar-header`, iOS): `env(safe-area-inset-top)` plus 44 pt, with a hairline at the bottom; inside,
/// 5 pt from the edges, the icon buttons at the left and right; the title (17 pt, medium, on a 44 pt line) centered
/// over the whole bar with 10 pt margins (the app's `.title { left: 0; right: 0 }`).
struct BarFrame<Leading: View, Trailing: View>: View {
    let colors: ShellColors
    let title: String
    var titleLeading: AnyView? = nil
    var titleAccessory: AnyView? = nil
    /// The room the title leaves on each side (`TabContent.titleClearance`); the Cordova margins when smaller.
    var titleClearance: CGFloat = 0
    /// Instead of the title: a view from 50 pt to 10 pt before the bar's end (S02's search header, IN-11).
    var titleView: AnyView? = nil
    let insets: ShellInsets
    let titleIdentifier: String
    var usesCordovaTitleSize = false
    /// How far WebKit puts the title below where SwiftUI centers it on the 44 pt line (measured: 1 pt in a tab's
    /// `ion-header-bar`, -1/3 pt in the menu's `header.bar`).
    var titleOffset: CGFloat = ShellMetrics.titleBaseline
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing
    @Environment(\.dynamicTypeSize) private var dynamicType
    @ScaledMetric(relativeTo: .headline) private var titleSize = ShellMetrics.titleSize

    private var displayedTitleSize: CGFloat {
        usesCordovaTitleSize && !dynamicType.isAccessibilitySize ? min(titleSize, ShellMetrics.titleSize) : titleSize
    }

    var body: some View {
        ZStack(alignment: .top) {
            if let titleView {
                titleView
                    .frame(maxWidth: .infinity, minHeight: ShellMetrics.headerHeight, alignment: .topLeading)
                    .padding(.leading, 50).padding(.trailing, 10)
            } else {
                HStack(spacing: 0) {
                    if let titleLeading { titleLeading }
                    // The name gives way with an ellipsis; the glyph and the buttons beside it keep their size (#3180).
                    Text(title)
                        .font(.system(size: displayedTitleSize, weight: .medium))
                        .foregroundStyle(colors.headerText.color)
                        .outlined(colors.headerOutline)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .layoutPriority(-1)
                        // On the name only: the glyph and buttons beside it keep their own identifiers (#3180).
                        .accessibilityIdentifier(titleIdentifier)
                    if let titleAccessory { titleAccessory }
                }
                    // WebKit puts the baseline of a 44 pt line 1 pt lower than SwiftUI centers the text (measured).
                    .offset(y: titleOffset)
                    .frame(maxWidth: .infinity, minHeight: ShellMetrics.headerHeight)
                    .padding(.horizontal, max(ShellMetrics.titleMargin, titleClearance))
            }
            HStack(alignment: .top, spacing: 0) {
                leading()
                Spacer(minLength: 0)
                trailing()
            }
            .padding(.horizontal, ShellMetrics.barPadding)
        }
        .padding(.top, insets.top)
        .padding(.leading, insets.leading)
        .padding(.trailing, insets.trailing)
        .frame(maxWidth: .infinity)
        .background(alignment: .bottom) {
            ZStack(alignment: .bottom) {
                colors.headerBar.color
                if let line = colors.headerLine { line.color.frame(height: ShellMetrics.hairline) }
            }
        }
    }
}

/// The header bar of a tab: the menu button (`ion-navicon`) at the left and the page's buttons at the right.
struct HeaderBar<Actions: View>: View {
    let colors: ShellColors
    let title: String
    var titleLeading: AnyView? = nil
    var titleAccessory: AnyView? = nil
    var titleClearance: CGFloat = 0
    var titleView: AnyView? = nil
    let insets: ShellInsets
    let onMenu: () -> Void
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        BarFrame(colors: colors, title: title, titleLeading: titleLeading, titleAccessory: titleAccessory,
                 titleClearance: titleClearance, titleView: titleView, insets: insets,
                 titleIdentifier: "shell-title", usesCordovaTitleSize: true) {
            BarButton(glyph: Glyphs.navicon, colors: colors, width: 40, action: onMenu)
                .accessibilityLabel("menu")
                .accessibilityIdentifier("shell-menu-button")
        } trailing: {
            HStack(alignment: .top, spacing: 0) { actions() }
        }
    }
}

/// An icon button of a header bar (`.bar .button.button-icon`): 5 pt below the bar's top, a 1 pt transparent border,
/// `padding` at the sides and a 32 pt Ionicons glyph on a 32 pt line, at 0.87 opacity as every `.button` in
/// ionic.app.scss. Glyphs keep their size with larger text, as the Cordova app's did.
struct BarButton: View {
    let glyph: String
    let colors: ShellColors
    /// The width inside the border (the measured button less 2 pt): the glyph is centered in it.
    var width: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(glyph)
                .font(Glyphs.ionicons(ShellMetrics.barGlyph))
                .foregroundStyle(colors.headerText.color)
                .outlined(colors.headerOutline)
                .frame(width: width, height: ShellMetrics.barGlyph)
                .padding(.horizontal, 1)
                .padding(.vertical, 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(0.87)
        .padding(.top, 5)
    }
}

/// `.tabs.tabs-icon-top` (iOS): 49 pt plus the home indicator's inset, a hairline at the top and the items 2 pt below
/// it; each item, up to 150 pt wide and centered on wide windows, has a 32 pt glyph on a 32 pt line over a 10 pt label on
/// a 14 pt line, at 0.7 opacity unless selected. With larger text the labels grow (Dynamic Type) and a label too long
/// for its item takes a second line; the glyphs keep their size.
struct TabBar: View {
    let selected: ShellTab
    let colors: ShellColors
    let catalog: Catalog
    let insets: ShellInsets
    let onTap: (ShellTab) -> Void
    @ScaledMetric(relativeTo: .caption2) private var labelSize = ShellMetrics.tabLabel
    @ScaledMetric(relativeTo: .caption2) private var labelLine = ShellMetrics.tabLabelLine

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(ShellTab.allCases, id: \.self) { tab in
                let on = tab == selected
                let ink = (on ? colors.tabSelected : colors.tabText).color
                Button { onTap(tab) } label: {
                    VStack(spacing: 0) {
                        Text(Glyphs.tab(tab))
                            .font(Glyphs.ionicons(ShellMetrics.tabGlyph))
                            .frame(height: ShellMetrics.tabGlyphLine)
                        Text(catalog(tab.textKey))
                            .font(.system(size: labelSize))
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(minHeight: labelLine)
                            // WebKit's 14 pt line puts the label 2 px (at 3x) higher than SwiftUI centers it.
                            .offset(y: ShellMetrics.tabLabelBaseline)
                    }
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, minHeight: ShellMetrics.tabItemHeight, alignment: .top)
                    .padding(.horizontal, 2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(on ? 1 : 0.7)
                .frame(maxWidth: ShellMetrics.tabItemMaxWidth)
                .overlay(alignment: .top) {
                    if on {
                        Capsule().fill(ink)
                            .frame(width: 24, height: 2.5)
                            .offset(y: -1)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityIdentifier("shell-tab-\(tab.rawValue)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.top, ShellMetrics.tabItemTop)
        .frame(maxWidth: .infinity)
        .frame(minHeight: ShellMetrics.tabBarHeight, alignment: .top)
        .padding(.leading, insets.leading)
        .padding(.trailing, insets.trailing)
        .padding(.bottom, insets.bottom)
        .background(alignment: .top) {
            ZStack(alignment: .top) {
                colors.tabBar.color
                // The lower half of a 1 pt strip at the top (`linear-gradient(0deg, line 50%, transparent 50%)`).
                colors.tabLine.color.frame(height: ShellMetrics.hairline).padding(.top, 1 - ShellMetrics.hairline)
            }
        }
    }
}

/// The full-screen side menu (S06) over the WebView's area: the theme's header bar with the back arrow and the app's
/// name, then the rows in Cordova order. Plain rows (`.item`: 16 pt text on a 22 pt line with 16 pt padding) share
/// 1 pt borders; the analytics, ad privacy, policy and terms rows are blocks (`.item.button.button-block`: 47 pt, bold
/// 15 pt, 4 pt corners, at 0.87 opacity) 9 pt from the plain rows and 10 pt apart. The list scrolls.
struct SideMenu: View {
    let model: ShellModel
    let catalog: Catalog
    let insets: ShellInsets
    /// False: the rows at the top without a scroll view (the screenshot tests render it, as `HourlyChartFrame` does).
    var scrolls = true
    @ScaledMetric(relativeTo: .body) private var rowText = ShellMetrics.menuText
    @ScaledMetric(relativeTo: .body) private var rowLine = ShellMetrics.menuLine
    @ScaledMetric(relativeTo: .body) private var buttonText = ShellMetrics.menuButtonText

    var body: some View {
        let colors = ShellColors.menu(model.theme)
        let rows = MenuRows(model: model, catalog: catalog, colors: colors, rowText: rowText, rowLine: rowLine,
                            buttonText: buttonText)
            .padding(.leading, insets.leading).padding(.trailing, insets.trailing)
            .padding(.bottom, insets.bottom)
        VStack(spacing: 0) {
            BarFrame(colors: colors, title: catalog("LOC_TODAYWEATHER"), insets: insets, titleIdentifier: "shell-menu-title",
                     titleOffset: ShellMetrics.menuTitleBaseline) {
                BarButton(glyph: Glyphs.arrowBack, colors: colors, width: 32, action: model.closeMenu)
                    .accessibilityLabel("back")
                    .accessibilityIdentifier("shell-menu-back")
            } trailing: {
                EmptyView()
            }
            if scrolls {
                ScrollView { rows }.background(colors.menuList.color)
            } else {
                rows.frame(minHeight: 0, maxHeight: .infinity, alignment: .top).clipped()
            }
        }
        .background(colors.menuList.color)
        // `.menu { border-bottom: 1px solid #d2d2d2 }`: a line at the bottom of the panel.
        .overlay(alignment: .bottom) { CssColor(0xD2D2D2).color.frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("shell-menu")
    }
}

/// The rows of the side menu (`.list` in `ion-content.menu-content`).
struct MenuRows: View {
    let model: ShellModel
    let catalog: Catalog
    let colors: ShellColors
    let rowText: CGFloat
    let rowLine: CGFloat
    let buttonText: CGFloat

    var body: some View {
        let rows = model.menuRows
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element) { index, row in
                if row.isButton {
                    Spacer().frame(height: index > 0 && rows[index - 1].isButton ? ShellMetrics.blockGap : ShellMetrics.blockMargin)
                    block(row)
                    // The block's bottom margin before an item, and after the last block, which ends the list (#2990).
                    if index + 1 == rows.count || !rows[index + 1].isButton {
                        Spacer().frame(height: ShellMetrics.blockMargin)
                    }
                } else {
                    item(row)
                    if index + 1 == rows.count || rows[index + 1].isButton {
                        colors.menuBorder.color.frame(height: 1)
                    }
                }
            }
        }
    }

    private func item(_ row: MenuRow) -> some View {
        Button { model.chooseMenuRow(row) } label: {
            VStack(spacing: 0) {
                colors.menuBorder.color.frame(height: 1)
                HStack(alignment: .center, spacing: 8) {
                    Text(catalog(row.textKey))
                        .font(.system(size: rowText))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let value = model.menuValue(row) {
                        Text(valueText(value))
                            .font(.system(size: rowText))
                            .multilineTextAlignment(.trailing)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if row.chevron {
                        Text(Glyphs.chevronRight).font(Glyphs.ionicons(ShellMetrics.menuText))
                    }
                }
                .frame(minHeight: rowLine)
                .foregroundStyle(colors.menuText.color)
                .padding(.horizontal, ShellMetrics.itemPadding)
                .padding(.vertical, ShellMetrics.itemPadding)
                .background(colors.menuItem.color)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("shell-menu-\(row.rawValue)")
    }

    private func block(_ row: MenuRow) -> some View {
        Button { model.chooseMenuRow(row) } label: {
            Text(blockText(row))
                .font(.system(size: buttonText, weight: .bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(colors.menuText.color)
                .padding(.horizontal, 12)
                .padding(.vertical, 2)
                .frame(maxWidth: .infinity, minHeight: ShellMetrics.blockHeight)
                .background(colors.menuItem.color)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(colors.menuBorder.color, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(0.87)
        .accessibilityIdentifier("shell-menu-\(row.rawValue)")
    }

    /// The analytics row shows whether analytics is on after a middle dot (이용 통계 · 켜짐 or · 꺼짐, the native texts of
    /// `LOC_ANALYTICS_CHOICE`, `LOC_ANALYTICS_ALLOWED` and `LOC_ANALYTICS_DISABLED`; IN-15 sets it from the stored choice,
    /// else the region's default).
    private func blockText(_ row: MenuRow) -> String {
        if row == .trackingPermission {
            return "\(catalog(row.textKey)) · \(catalog(model.trackingStatus == .authorized ? "LOC_TRACKING_ALLOWED" : "LOC_TRACKING_NOT_ALLOWED"))"
        }
        guard row == .analytics else { return catalog(row.textKey) }
        return "\(catalog(row.textKey)) · \(catalog(model.analyticsAllowed ? "LOC_ANALYTICS_ALLOWED" : "LOC_ANALYTICS_DISABLED"))"
    }

    private func valueText(_ value: ShellModel.MenuValue) -> String {
        switch value {
        case .key(let key): catalog(key)
        case .text(let text): text
        }
    }
}

/// An Ionic popup (`$ionicPopup.show`): the backdrop darkens the page (40 % black), a 250 pt popup in its middle,
/// white at 90 %: the title (15 pt, medium), the lines (14 pt) and the buttons side by side, each size at the default
/// text size and scaled with Dynamic Type (CODEX-IN07-1). Only its buttons close it.
struct IonicPopupView: View {
    let popup: Popup
    let onTap: (Int) -> Void
    /// False: the lines without a scroll view (the screenshot tests render it, as `SideMenu(scrolls: false)`).
    var scrolls = true
    @ScaledMetric(relativeTo: .headline) private var titleSize: CGFloat = 15
    @ScaledMetric(relativeTo: .body) private var lineSize: CGFloat = 14
    @ScaledMetric(relativeTo: .body) private var buttonSize: CGFloat = 15
    @ScaledMetric(relativeTo: .body) private var buttonHeight: CGFloat = 45

    var body: some View {
        ZStack {
            Color.black.opacity(0.4).contentShape(Rectangle()).onTapGesture {}
            if let custom = popup.custom {
                custom
            } else {
                standard
            }
        }
    }

    private var standard: some View {
            VStack(spacing: 0) {
                if !popup.title.isEmpty {
                    Text(popup.title).font(.system(size: titleSize, weight: .medium)).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 10).padding(.top, 15)
                }
                // `.popup-head` keeps its 15 pt padding above and below an empty title (`$ionicPopup.alert` without one,
                // O13 of IN-14: 31 pt in the capture).
                Color(white: 0.933).frame(height: 1).padding(.top, popup.title.isEmpty ? 30 : 15)
                // WebKit lays the 14 px lines 18 pt apart (measured in the About capture, IN-12), more than the
                // system font's own line height.
                // Each line takes its whole 18 pt line box, the text centered in it, as in WebKit (IN-14: a three-line
                // popup was 4 px shorter than the Cordova one with the spacing between the lines only).
                let gap = max(0, lineSize * 18 / 14 - UIFont.systemFont(ofSize: lineSize).lineHeight)
                let lines = Text(Self.syllableBreaks(popup.lines.joined(separator: "\n"))).font(.system(size: lineSize))
                    .lineSpacing(gap)
                    .padding(.vertical, gap / 2)
                    // WebKit lays text out in 1/64 px units, so a line 0.01 pt wider than the box still fits (IN-14's
                    // English O06 fills its first line to 230.009 pt).
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10).padding(.horizontal, 9.99)
                if scrolls {
                    ScrollView { lines }.fixedSize(horizontal: false, vertical: true)
                } else {
                    lines.fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 5) {
                    ForEach(Array(popup.buttons.enumerated()), id: \.offset) { index, button in
                        Button { onTap(index) } label: {
                            Text(button.text).font(.system(size: buttonSize, weight: .bold))
                                .multilineTextAlignment(.center)
                                .foregroundStyle(button.style == .standard ? CssColor(0x444444).color : .white)
                                .padding(.horizontal, 13)
                                .frame(maxWidth: .infinity, minHeight: buttonHeight)
                                .background(buttonColor(button.style))
                                .clipShape(RoundedRectangle(cornerRadius: 2))
                        }
                        .buttonStyle(.plain)
                        .opacity(0.87)
                        .accessibilityIdentifier("popup-button-\(index)")
                    }
                }
                .padding(10)
            }
            .foregroundStyle(.black)
            .frame(width: 250)
            .background(Color.white.opacity(0.9))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("popup")
    }

    /// WebKit breaks Korean text between any two syllables (the Cordova O01 capture wraps "위 / 해"), where CoreText
    /// keeps a Korean word whole: a zero-width space between two Hangul syllables gives the same break opportunities
    /// (IN-10). Nothing else changes.
    static func syllableBreaks(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        var previousHangul = false
        for scalar in text.unicodeScalars {
            let hangul = (0xAC00...0xD7A3).contains(scalar.value)
            if hangul && previousHangul { out.append("\u{200B}") }
            out.append(scalar)
            previousHangul = hangul
        }
        return String(out)
    }

    private func buttonColor(_ style: Popup.Button.Style) -> Color {
        switch style {
        case .positive: CssColor(0x387EF5).color
        case .dark: CssColor(0x444444).color
        case .standard: CssColor(0xF8F8F8).color
        }
    }
}

/// Sizes of the Cordova iOS shell in points (Ionic 1.3.5 with the app's SCSS), measured in the captures
/// (TodayWeatherTests/ShellReference/shell-<lang>-<theme>.json).
enum ShellMetrics {
    static let headerHeight: CGFloat = 44
    static let barPadding: CGFloat = 5
    static let barGlyph: CGFloat = 32
    static let titleSize: CGFloat = 17
    static let titleMargin: CGFloat = 10
    static let titleBaseline: CGFloat = 1
    static let tabLabelBaseline: CGFloat = -2.0 / 3
    static let menuTitleBaseline: CGFloat = -1.0 / 3
    /// Ionic draws a 1 px border as the half of a 1 pt strip; WebKit paints it on two device rows at 3x (2/3 pt).
    static let hairline: CGFloat = 2.0 / 3
    static let tabBarHeight: CGFloat = 49
    static let tabGlyph: CGFloat = 32
    static let tabGlyphLine: CGFloat = 32
    static let tabLabel: CGFloat = 10
    static let tabLabelLine: CGFloat = 14
    static let tabItemTop: CGFloat = 2
    static let tabItemHeight: CGFloat = 47
    static let tabItemMaxWidth: CGFloat = 150
    static let menuText: CGFloat = 16
    static let menuLine: CGFloat = 22
    static let menuButtonText: CGFloat = 15
    static let itemPadding: CGFloat = 16
    static let blockHeight: CGFloat = 47
    static let blockGap: CGFloat = 10
    static let blockMargin: CGFloat = 9
}

extension View {
    /// The photo theme's outline (`text-shadow` of four 0.5 pt diagonal shadows) when `color` is set.
    @ViewBuilder func outlined(_ color: CssColor?) -> some View {
        if let color {
            self.shadow(color: color.color, radius: 0, x: -0.5, y: -0.5).shadow(color: color.color, radius: 0, x: 0.5, y: -0.5)
                .shadow(color: color.color, radius: 0, x: -0.5, y: 0.5).shadow(color: color.color, radius: 0, x: 0.5, y: 0.5)
        } else {
            self
        }
    }
}
