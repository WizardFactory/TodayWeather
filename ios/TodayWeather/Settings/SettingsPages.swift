import SwiftUI
import TWDomain
import TWStorage

/// What S07 and S08 show, from the state (units.html, setting-radio.html).
struct SettingsPageContent: Equatable {
    struct Row: Equatable {
        var id: String
        var label: String
        /// S07: the unit's value at the right (`float: right`).
        var value: String?
        /// S08: the choice is the stored value (the check mark).
        var checked = false
    }

    var title: String
    var rows: [Row]

    /// S07: the units in `Units.getAllUnits()` order with their names and values (`getUnitNameStr`, `getUnitValueStr`).
    static func units(_ units: UnitSettings, catalog: Catalog) -> SettingsPageContent {
        SettingsPageContent(title: catalog("LOC_UNITS"), rows: SettingLists.units.map { name in
            Row(id: name, label: catalog(SettingLists.unitName(name)),
                value: SettingLists.unitValue(name, units.value(name)).map { catalog($0) } ?? "")
        })
    }

    /// S08: the list's title and choices, the stored value checked.
    static func list(_ name: String, value: String?, catalog: Catalog) -> SettingsPageContent {
        let list = SettingLists.list(name)
        return SettingsPageContent(title: catalog(list.title), rows: list.choices.map { choice in
            Row(id: choice.value, label: catalog(choice.label), checked: value == choice.value)
        })
    }
}

/// The settings page on top (`SettingsScreens.top`) over the tabs, in the window's insets.
struct SettingsPageView: View {
    let screens: SettingsScreens
    let insets: ShellInsets

    var body: some View {
        if let page = screens.top {
            SettingsPageFrame(content: screens.content(page), theme: screens.shell.theme, insets: insets,
                              onBack: { screens.back() }, onRow: { id in screens.tap(page, row: id) })
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(page.identifier)
        }
    }
}

extension SettingsPage {
    var identifier: String {
        switch self {
        case .units: "settings-units"
        case .list(let name): "settings-list-\(name)"
        }
    }
}

extension SettingsScreens {
    /// What `page` shows now.
    func content(_ page: SettingsPage) -> SettingsPageContent {
        let units = shell.holder.state?.units ?? .defaults(region: shell.locale.region)
        switch page {
        case .units: return .units(units, catalog: catalog)
        case .list(let name): return .list(name, value: actions.value(name), catalog: catalog)
        }
    }

    /// A tap on a row of `page`: S07 opens the unit's list, S08 chooses the value.
    func tap(_ page: SettingsPage, row: String) {
        switch page {
        case .units: openList(row)
        case .list: choose(row)
        }
    }
}

/// A settings page (`ion-view` in the side menu's content, the `setting` state): the status bar and the header bar in
/// the theme's plain colors (`applyIOSStatusBar(theme, 'setting')`, the menu's bar), the back arrow
/// (`ion-ios-arrow-back`) and the title, then Ionic's list: plain items with the value at the right (S07) or radio items
/// with the check mark (`ion-checkmark`) at the right of the stored choice (S08), in the menu's list colors
/// (`.setting .main-content`). Rows follow Dynamic Type and the list scrolls when it does not fit (the Cordova page did
/// not scroll; its fixed text size always fit). `scrolls: false` lays the rows out at the top without a scroll view (the
/// screenshot tests render it, as `SideMenu(scrolls: false)`).
struct SettingsPageFrame: View {
    let content: SettingsPageContent
    let theme: Theme
    let insets: ShellInsets
    var scrolls = true
    let onBack: () -> Void
    let onRow: (String) -> Void
    @ScaledMetric(relativeTo: .body) private var rowText = ShellMetrics.menuText
    @ScaledMetric(relativeTo: .body) private var rowLine = ShellMetrics.menuLine

    var body: some View {
        let colors = ShellColors.menu(theme)
        VStack(spacing: 0) {
            colors.statusBar.color.frame(height: insets.statusBar)
            BarFrame(colors: colors, title: content.title, insets: insets, titleIdentifier: "settings-title",
                     titleOffset: SettingsMetrics.titleBaseline) {
                BarButton(glyph: Glyphs.arrowBack, colors: colors, width: SettingsMetrics.backWidth, action: onBack)
                    .accessibilityLabel("back")
                    .accessibilityIdentifier("settings-back")
            } trailing: {
                EmptyView()
            }
            let rows = SettingsRows(content: content, colors: colors, rowText: rowText, rowLine: rowLine, onRow: onRow)
                .padding(.leading, insets.leading).padding(.trailing, insets.trailing)
                .padding(.bottom, insets.bottom)
            if scrolls {
                ScrollView { rows }.background(colors.menuList.color)
            } else {
                rows.frame(minHeight: 0, maxHeight: .infinity, alignment: .top).clipped()
            }
        }
        .background(colors.menuList.color)
    }
}

/// Ionic's `.list` of a settings page: `.item` rows of 16 pt text on a 22 pt line with 16 pt padding, sharing 1 pt
/// borders.
struct SettingsRows: View {
    let content: SettingsPageContent
    let colors: ShellColors
    let rowText: CGFloat
    let rowLine: CGFloat
    let onRow: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(content.rows, id: \.id) { row in
                Button { onRow(row.id) } label: {
                    VStack(spacing: 0) {
                        colors.menuBorder.color.frame(height: 1)
                        HStack(alignment: .center, spacing: 8) {
                            Text(row.label)
                                .font(.system(size: rowText))
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                // A radio item's label sits in `.item-content` on a 20 pt line, 2/3 pt above S07's.
                                .offset(y: row.value == nil ? SettingsMetrics.choiceBaseline : 0)
                            if let value = row.value {
                                Text(value)
                                    .font(.system(size: rowText))
                                    .multilineTextAlignment(.trailing)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if row.checked {
                                // `.radio-icon`: 14 pt padding inside the row's right edge, its glyph 2 pt lower than
                                // the label's center.
                                Text(Glyphs.checkmark).font(Glyphs.ionicons(SettingsMetrics.checkSize))
                                    .offset(x: SettingsMetrics.checkInset, y: SettingsMetrics.checkDrop)
                                    .accessibilityLabel("selected")
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
                .accessibilityIdentifier("settings-row-\(row.id)")
                .accessibilityAddTraits(row.checked ? .isSelected : [])
            }
            colors.menuBorder.color.frame(height: 1)
        }
    }
}

extension Glyphs {
    static let checkmark = "\u{F122}"        // ion-checkmark (the radio icon of `ion-radio`)
}

/// Sizes of the Cordova iOS settings pages in points, measured in the captures
/// (TodayWeatherTests/SettingsReference/settings-<lang>-<state>.json).
enum SettingsMetrics {
    static let titleBaseline: CGFloat = ShellMetrics.titleBaseline
    static let backWidth: CGFloat = 32
    static let checkSize: CGFloat = 24
    static let choiceBaseline: CGFloat = -2.0 / 3
    static let checkInset: CGFloat = 2
    static let checkDrop: CGFloat = 2
}
