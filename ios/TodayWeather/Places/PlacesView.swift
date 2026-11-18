import SwiftUI
import TWDomain
import TWResources
import UIKit

/// Sizes of tab-search.html in the Cordova iOS build (Ionic 1.3.5 with the app's SCSS), measured in the captures
/// (TodayWeatherTests/PlacesReference/places-<lang>-<state>.json), in points.
enum PlacesMetrics {
    // The header (`p.title.search-header` in the 44 pt bar): the field from 50 pt, 5 pt down, 33 pt high, 4 pt corners,
    // 8 pt inside; `ion-ios-search` 14 pt on a 20 pt line with 6 pt after it; the input's 34 pt box from 0.5 pt above
    // the field with 2 pt and 5.1 pt of padding; the mode button 10.66 pt after the field, 8 pt inside a 1 pt border,
    // 17 pt text on a 32 pt line, ending 10 pt before the bar's end.
    static let fieldTop: CGFloat = 5
    static let fieldHeight: CGFloat = 33
    static let fieldCorner: CGFloat = 4
    static let fieldPadding: CGFloat = 8
    static let glyphSize: CGFloat = 14
    static let glyphLine: CGFloat = 20
    static let glyphGap: CGFloat = 6
    /// The input's start in the field (the glyph's 10.5 pt box and its 6 pt after the 8 pt padding; measured).
    static let inputLeading: CGFloat = 24.5
    /// WebKit draws the Ionicons of the bell and ⊗ 2/3 pt higher in their 34 pt cell than their line box puts them
    /// (measured in the captures).
    static let iconRaise: CGFloat = 2.0 / 3
    static let inputText: CGFloat = 17
    static let inputBox: CGFloat = 34
    static let inputPaddingTop: CGFloat = 2
    static let inputPaddingBottom: CGFloat = 5.1
    static let modeGap: CGFloat = 10.65625
    static let modePadding: CGFloat = 8
    static let modeLine: CGFloat = 32
    static let modeText: CGFloat = 17
    // The list (`.list.list-inset`): 10 pt in from the sides, its first item 9 pt under the bar; items with a 1 pt
    // border shared with the next one, 16 pt of padding, 2 pt corners on the outer ones.
    static let listInset: CGFloat = 10
    static let listTop: CGFloat = 9
    static let itemPadding: CGFloat = 16
    static let corner: CGFloat = 2
    // A row's cells: the name 40 % of the content with a temperature, the 48 pt sky image, the temperature centered in
    // the rest, a 48 pt cell for the bell, the switch or ⊗. Content heights: 48 with a temperature, 37 for the current
    // position's switch, 34 for a bell or ⊗ alone, 22 a line of the name.
    static let nameShare: CGFloat = 0.4
    static let image: CGFloat = 48
    static let lastCell: CGFloat = 48
    static let nameText: CGFloat = 17
    static let rangeText: CGFloat = 12
    static let iconText: CGFloat = 28
    static let iconCell: CGFloat = 34
    static let switchCell: CGFloat = 37
    // Search mode: 현재위치로 지역찾기 10 pt under the bar (47 pt, 1 pt #ddd border, 4 pt corners, bold 17 pt on a 42 pt
    // line), the results' first item 9 pt under it; the dividers 8 pt inside (Google's logo 40 pt high).
    static let findTop: CGFloat = 10
    static let findHeight: CGFloat = 47
    static let findLine: CGFloat = 42
    static let resultsTop: CGFloat = 9
    static let dividerPadding: CGFloat = 8
    static let googleDivider: CGFloat = 40
    static let googleLogo: CGFloat = 144
}

/// S02's colors (`.search` and `.dark-theme.search`): the light page and rows, or the dark theme's.
struct PlacesColors {
    let page: CssColor
    let row: CssColor
    let border: CssColor
    let text: CssColor
    let button: CssColor

    static func of(_ theme: Theme) -> PlacesColors {
        theme == .dark
            ? PlacesColors(page: CssColor(0x171717), row: CssColor(0x1C1C1D), border: CssColor(0x8F8F8F), text: CssColor(0xDDDDDD),
                           button: CssColor(0x3B3B3B))
            : PlacesColors(page: CssColor(0xF5F5F5), row: CssColor(0xFFFFFF), border: CssColor(0xDDDDDD), text: CssColor(0x444444),
                           button: CssColor(0xFFFFFF))
    }
}

extension Glyphs {
    static let iosSearch = "\u{F4A5}"            // ion-ios-search
    static let notificationsNone = "\u{F399}"    // ion-android-notifications-none
    static let notifications = "\u{F39B}"        // ion-android-notifications
    static let iosCloseOutline = "\u{F405}"      // ion-ios-close-outline
}

/// The header of S02 (`p.title.search-header`): the `#eee` field with `ion-ios-search` and the input, and the mode
/// button (편집, 취소 while searching, 확인 while editing). A focus on the input enters search mode.
struct PlacesHeader: View {
    let screens: PlacesScreens
    let colors: ShellColors
    /// False: the input drawn as its text (the screenshot tests render it; `ImageRenderer` cannot draw a text field).
    var live = true
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let catalog = screens.catalog
        let label = catalog(screens.editing ? "LOC_OK" : screens.searching ? "LOC_CANCEL" : "LOC_EDIT")
        let mode = [CssRun(text: label, size: PlacesMetrics.modeText * scale)]
        let modeWidth = CssLine.width(mode) + 2 * PlacesMetrics.modePadding + 2
        HStack(alignment: .top, spacing: 0) {
            field(catalog)
            Color.clear.frame(width: PlacesMetrics.modeGap, height: 1)
            Button { screens.modeTapped() } label: {
                FixedCssLine(text: label, size: PlacesMetrics.modeText * scale, color: colors.headerText,
                             height: PlacesMetrics.modeLine * scale)
                    .padding(.horizontal, PlacesMetrics.modePadding + 1)
                    .padding(.top, 1)
                    .frame(width: modeWidth, height: PlacesMetrics.fieldHeight * scale, alignment: .top)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("places-mode")
        }
        .padding(.top, PlacesMetrics.fieldTop)
        .onChange(of: focused) { _, now in screens.focusChanged(now) }
        .onChange(of: screens.focusRequest) { _, _ in focused = false }
    }

    private func field(_ catalog: Catalog) -> some View {
        let text = PlacesMetrics.inputText * scale
        let lineHeight = CssLine.metrics([CssRun(text: "", size: text)])
        let content = PlacesMetrics.inputBox * scale - PlacesMetrics.inputPaddingTop - PlacesMetrics.inputPaddingBottom
        // The input's text is centered in its content box, which starts 0.5 pt above the field plus its 2 pt padding.
        let textTop = -0.5 + PlacesMetrics.inputPaddingTop + (content - (lineHeight.ascent + lineHeight.descent)) / 2
        let glyphTop = (PlacesMetrics.fieldHeight * scale - PlacesMetrics.glyphLine) / 2
        let inputLeading = PlacesMetrics.inputLeading
        let binding = Binding(get: { screens.query.word }, set: { screens.wordChanged($0) })
        return ZStack(alignment: .topLeading) {
            CssColor(0xEEEEEE).color
            FixedCssLine(text: Glyphs.iosSearch, size: PlacesMetrics.glyphSize, color: CssColor(0x444444), height: PlacesMetrics.glyphLine,
                         face: .ionicons)
                .offset(x: PlacesMetrics.fieldPadding, y: glyphTop)
                .accessibilityHidden(true)
            Group {
                if screens.query.word.isEmpty {
                    CssLine(runs: [CssRun(text: catalog("LOC_ENTER_CITY"), size: text)], color: StartMetrics.placeholder)
                        .accessibilityHidden(true)
                } else if !live {
                    CssLine(runs: [CssRun(text: screens.query.word, size: text)], color: StartMetrics.inputColor)
                }
            }
            .offset(x: inputLeading, y: textTop)
            if live {
                TextField("", text: binding)
                    .font(.system(size: text))
                    .foregroundStyle(StartMetrics.inputColor.color)
                    .focused($focused)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .frame(height: lineHeight.ascent + lineHeight.descent)
                    .padding(.leading, inputLeading)
                    .padding(.trailing, PlacesMetrics.fieldPadding)
                    .offset(y: textTop)
                    .accessibilityLabel(catalog("LOC_ENTER_CITY"))
                    .accessibilityIdentifier("places-input")
            }
        }
        // The field takes the room the mode button leaves, also when its placeholder is wider (larger text in a narrow
        // window): the input clips its placeholder, as WebKit's does, rather than widening the header.
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: PlacesMetrics.fieldHeight * scale, maxHeight: PlacesMetrics.fieldHeight * scale,
               alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: PlacesMetrics.fieldCorner))
    }
}

/// The page of S02 under the header bar: the list of places, or in search mode 현재위치로 지역찾기 and the results.
struct PlacesPageView: View {
    let screens: PlacesScreens
    let theme: Theme
    /// False: the content at the top without a scroll view (the screenshot tests render it).
    var scrolls = true
    @Environment(\.shellInsets) private var insets
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1
    @State private var scrolling = false

    var body: some View {
        let colors = PlacesColors.of(theme)
        let content = VStack(spacing: 0) {
            Color.clear.frame(height: insets.top + ShellMetrics.headerHeight)
            if screens.searching { searchContent(colors) } else { list(colors) }
        }
        .padding(.horizontal, PlacesMetrics.listInset)
        .padding(.leading, insets.leading).padding(.trailing, insets.trailing)
        .environment(\.startScale, scale)
        Group {
            if scrolls {
                // `on-scroll="OnScrollResults()"`: each scroll of the list brings the next ten towns, as Cordova's scroll
                // events did (the first ten show without one).
                ScrollView(.vertical, showsIndicators: false) { content }.scrollDismissesKeyboard(.never)
                    .simultaneousGesture(DragGesture(minimumDistance: 10).onChanged { _ in
                        if !scrolling {
                            scrolling = true
                            screens.query.moreTowns()
                        }
                    }.onEnded { _ in scrolling = false })
            } else {
                content.frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .background(colors.page.color, ignoresSafeAreaEdges: [])
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("places-page")
    }

    // MARK: The list

    private func list(_ colors: PlacesColors) -> some View {
        let rows = screens.rows
        let shown = rows.indices.filter { !rows[$0].disabled || screens.editing }
        return VStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element) { n, i in
                PlaceRowView(row: rows[i], index: i, theme: theme, colors: colors, editing: screens.editing,
                             first: n == 0, last: n == shown.count - 1, screens: screens)
            }
        }
        .padding(.top, PlacesMetrics.listTop)
        .padding(.bottom, PlacesMetrics.listInset)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("places-list")
    }

    // MARK: Search mode

    private func searchContent(_ colors: PlacesColors) -> some View {
        let towns = screens.query.townResults?.page.towns ?? []
        let places: [String] = screens.page.found.map { [$0["address"]?.stringValue ?? ""] }
            ?? (screens.query.predictions?.list.map(\.fullText) ?? [])
        let count = towns.count + (towns.isEmpty ? 0 : 1) + places.count + (places.isEmpty ? 0 : 1)
        return VStack(spacing: 0) {
            Color.clear.frame(height: PlacesMetrics.findTop)
            FindButton(label: screens.catalog("LOC_FIND_BY_LOCATION"), colors: colors) { screens.findByLocation() }
            if count > 0 {
                VStack(spacing: 0) {
                    ForEach(Array(towns.enumerated()), id: \.offset) { i, town in
                        ResultItem(text: [town.first, town.second, town.third].joined(separator: " "), colors: colors,
                                   first: i == 0, last: false, identifier: "places-town-\(i)") { screens.addTown(town) }
                    }
                    if !towns.isEmpty {
                        Divider(colors: colors, first: false, last: places.isEmpty, height: nil, identifier: "places-town-divider") {
                            CssLine(runs: [CssRun(text: "powered by TodayWeather", size: 16 * scale, weight: .medium)], color: colors.text)
                        }
                    }
                    ForEach(Array(places.enumerated()), id: \.offset) { i, text in
                        ResultItem(text: text, colors: colors, first: towns.isEmpty && i == 0, last: false,
                                   identifier: screens.page.found != nil ? "places-found" : "places-prediction-\(i)") {
                            screens.addPlace(i)
                        }
                    }
                    if !places.isEmpty {
                        Divider(colors: colors, first: false, last: true, height: PlacesMetrics.googleDivider,
                                identifier: "places-google-divider") { GoogleLogoImage() }
                    }
                }
                .padding(.top, PlacesMetrics.resultsTop)
                .padding(.bottom, PlacesMetrics.listInset)
            }
        }
    }
}

/// An `.item` of a `.list-inset`: a 1 pt border shared with its neighbours, the outer corners rounded.
private struct ItemBox: ViewModifier {
    let colors: PlacesColors
    let background: CssColor
    let first: Bool
    let last: Bool

    func body(content: Content) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: first ? PlacesMetrics.corner : 0,
                                           bottomLeadingRadius: last ? PlacesMetrics.corner : 0,
                                           bottomTrailingRadius: last ? PlacesMetrics.corner : 0,
                                           topTrailingRadius: first ? PlacesMetrics.corner : 0)
        content
            .background(background.color)
            .clipShape(shape)
            .overlay(shape.strokeBorder(colors.border.color, lineWidth: 1))
            .padding(.top, first ? 0 : -1)
    }
}

/// A row of the list (tab-search.html): the name cell (the current position's `location_on`), the sky image, the
/// temperature over today's range, and the bell, or in edit mode the current position's switch or ⊗.
private struct PlaceRowView: View {
    let row: PlaceRow
    let index: Int
    let theme: Theme
    let colors: PlacesColors
    let editing: Bool
    let first: Bool
    let last: Bool
    let screens: PlacesScreens
    @Environment(\.startScale) private var scale

    var body: some View {
        let temperature = row.temperature != nil
        let nameLines = CGFloat(min(row.lines.count, 2)) * line(PlacesMetrics.nameText)
        let cell: CGFloat = editing && row.currentPosition ? PlacesMetrics.switchCell : PlacesMetrics.iconCell
        let height = max(temperature ? PlacesMetrics.image : cell, nameLines, temperature ? 2 * line(PlacesMetrics.nameText) : 0)
        GeometryReader { g in
            let width = g.size.width
            HStack(spacing: 0) {
                name
                    .frame(width: temperature ? width * PlacesMetrics.nameShare : max(0, width - PlacesMetrics.lastCell),
                           height: height, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { screens.selectRow(index) }
                if temperature {
                    sky.frame(width: PlacesMetrics.image, height: height)
                        .contentShape(Rectangle()).onTapGesture { screens.selectRow(index) }
                    degrees.frame(maxWidth: .infinity).frame(height: height)
                        .contentShape(Rectangle()).onTapGesture { screens.selectRow(index) }
                }
                lastCell.frame(width: PlacesMetrics.lastCell, height: height)
            }
        }
        .frame(height: height)
        .padding(PlacesMetrics.itemPadding + 1)
        .modifier(ItemBox(colors: colors, background: colors.row, first: first, last: last))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("places-row-\(index)")
    }

    private func line(_ size: CGFloat) -> CGFloat {
        let m = CssLine.metrics([CssRun(text: "", size: size * scale)])
        return m.ascent + m.descent
    }

    /// The label lines (`address[0]`, `<br>`, `address[1]`), each one line with an ellipsis; the current position's
    /// glyph 3 pt left and 2 pt down of its place, its -4 pt letter spacing pulling the label in.
    private var name: some View {
        let size = PlacesMetrics.nameText * scale
        let glyphAdvance = CssLine.width([CssRun(text: Glyphs.locationOn, size: size, face: .material)]) - 4
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(row.lines.prefix(2).enumerated()), id: \.offset) { i, text in
                HStack(spacing: 0) {
                    if i == 0 && row.currentPosition {
                        CssLine(runs: [CssRun(text: Glyphs.locationOn, size: size, face: .material)], color: colors.text, strut: size)
                            .offset(x: -3, y: 2)
                            .frame(width: glyphAdvance, alignment: .leading)
                    }
                    CssLine(runs: [CssRun(text: text, size: size, weight: .medium)], color: colors.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .clipped()
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { screens.selectRow(index) }
        .accessibilityIdentifier("places-name-\(index)")
    }

    private var sky: some View {
        let path = theme.weather + "/" + row.skyIcon + ".png"
        return Group {
            if let ui = TWResources.url(path).flatMap({ UIImage(contentsOfFile: $0.path) }) {
                Image(uiImage: ui).resizable().interpolation(.high)
                    .frame(width: PlacesMetrics.image, height: PlacesMetrics.image * ui.size.height / max(ui.size.width, 1))
            } else {
                Color.clear.frame(width: PlacesMetrics.image, height: 1)
            }
        }
        .accessibilityHidden(true)
    }

    /// `<span>t1h˚</span><br><span 12px>min˚/max˚</span>`, centered on the cell's 17 pt lines.
    private var degrees: some View {
        let size = PlacesMetrics.nameText * scale
        return VStack(spacing: 0) {
            CssLine(runs: [CssRun(text: row.temperature ?? "", size: size, weight: .medium)], color: colors.text)
            CssLine(runs: [CssRun(text: row.minMax ?? "", size: PlacesMetrics.rangeText * scale, weight: .medium)], color: colors.text,
                    strut: size)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("places-degrees-\(index)")
    }

    @ViewBuilder private var lastCell: some View {
        if !editing {
            Button { screens.bellTapped(index) } label: {
                FixedCssLine(text: row.hasPush ? Glyphs.notifications : Glyphs.notificationsNone, size: PlacesMetrics.iconText,
                             color: colors.text, height: PlacesMetrics.iconCell, face: .ionicons)
                    .offset(y: -PlacesMetrics.iconRaise)
                    .frame(width: PlacesMetrics.lastCell, height: PlacesMetrics.iconCell)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(row.hasPush ? "alarm on" : "alarm off")
            .accessibilityIdentifier("places-bell-\(index)")
        } else if row.currentPosition {
            SearchToggle(on: !row.disabled) { screens.page.setCurrentPosition($0) }
                .accessibilityIdentifier("places-toggle")
        } else {
            Button { screens.page.delete(index) } label: {
                FixedCssLine(text: Glyphs.iosCloseOutline, size: PlacesMetrics.iconText, weight: .bold, color: colors.text,
                             height: PlacesMetrics.iconCell, face: .ionicons)
                    .offset(y: -PlacesMetrics.iconRaise)
                    .frame(width: PlacesMetrics.lastCell, height: PlacesMetrics.iconCell)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("delete")
            .accessibilityIdentifier("places-delete-\(index)")
        }
    }
}

/// `.toggle.toggle-search`: a 38 x 14 track with 8 pt corners (gray off, #387ef5 on), 5 pt in from the cell, and the
/// white 20 pt handle with Ionic's shadow at the track's left (off) or right (on).
private struct SearchToggle: View {
    let on: Bool
    let change: (Bool) -> Void

    var body: some View {
        Button { change(!on) } label: {
            ZStack(alignment: .topLeading) {
                Color.clear.frame(width: PlacesMetrics.lastCell, height: PlacesMetrics.switchCell)
                RoundedRectangle(cornerRadius: 8)
                    .fill(on ? CssColor(0x387EF5).color : Color(.sRGB, red: 158 / 255, green: 158 / 255, blue: 158 / 255, opacity: 0.8))
                    .frame(width: 38, height: 14)
                    .offset(x: 5, y: 13)
                Circle().fill(Color.white)
                    .frame(width: 20, height: 20)
                    .shadow(color: .black.opacity(0.35), radius: 3.5, y: 2)
                    .shadow(color: .black.opacity(0.15), radius: 0.5, y: 1)
                    .offset(x: on ? 23 : 5, y: 10)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("current location")
        .accessibilityValue(on ? "1" : "0")
    }
}

/// 현재위치로 지역찾기 (`button` in a 10 pt padded block): bold 17 pt on a 42 pt line, centered, a 1 pt border with 4 pt
/// corners.
private struct FindButton: View {
    let label: String
    let colors: PlacesColors
    let action: () -> Void
    @Environment(\.startScale) private var scale

    var body: some View {
        Button(action: action) {
            FixedCssLine(text: label, size: PlacesMetrics.nameText * scale, weight: .bold, color: colors.text,
                         height: PlacesMetrics.findLine * scale)
                // Measured: the label's line box 2 2/3 pt below the button's top.
                .padding(.top, 2 + 2.0 / 3)
                .frame(maxWidth: .infinity, minHeight: PlacesMetrics.findHeight * scale, alignment: .top)
                .background(colors.button.color)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(colors.border.color, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("places-find")
    }
}

/// A search result: its text in 17 pt medium on one line (`.search-item`), 16 pt inside the item.
private struct ResultItem: View {
    let text: String
    let colors: PlacesColors
    let first: Bool
    let last: Bool
    let identifier: String
    let action: () -> Void
    @Environment(\.startScale) private var scale

    var body: some View {
        Button(action: action) {
            CssLine(runs: [CssRun(text: text, size: PlacesMetrics.nameText * scale, weight: .medium)], color: colors.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .clipped()
                .padding(PlacesMetrics.itemPadding + 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .modifier(ItemBox(colors: colors, background: colors.row, first: first, last: last))
        .accessibilityIdentifier(identifier)
    }
}

/// `.item.item-divider`: #f5f5f5, 8 pt above and below and 16 pt at the start inside its border.
private struct Divider<Content: View>: View {
    let colors: PlacesColors
    let first: Bool
    let last: Bool
    let height: CGFloat?
    let identifier: String
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.leading, PlacesMetrics.itemPadding + 1)
            .padding(.vertical, PlacesMetrics.dividerPadding + 1)
            .frame(maxWidth: .infinity, minHeight: height, alignment: .topLeading)
            .modifier(ItemBox(colors: colors, background: CssColor(0xF5F5F5), first: first, last: last))
            .accessibilityIdentifier(identifier)
    }
}

/// `img/powered_by_google_on_white.png` at 144 pt wide.
private struct GoogleLogoImage: View {
    var body: some View {
        if let url = TWResources.url("img/powered_by_google_on_white.png"), let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image).resizable().interpolation(.high)
                .frame(width: PlacesMetrics.googleLogo, height: PlacesMetrics.googleLogo * image.size.height / image.size.width)
                .accessibilityLabel("powered by Google")
        }
    }
}
