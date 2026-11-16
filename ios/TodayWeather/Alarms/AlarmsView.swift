import SwiftUI
import TWData
import TWDomain
import TWStorage
import UIKit

/// What S09 shows (setting-push.html), from a visit's `AlarmSettings`.
struct AlarmsContent: Equatable {
    struct Row: Equatable {
        /// The alarm's index in the list (`onOpenTimePicker($index)`).
        var index: Int
        var text: String
    }

    var title: String
    var alertOn: Bool
    /// The hour bar shows (`ng-hide="alert.enable === false"`).
    var barShown: Bool
    var from: Double
    var to: Double
    var days: [Bool]
    /// The enabled alarms.
    var rows: [Row]
    /// The add row `HH:MM` (`canMakeNewAlarm()`).
    var canAdd: Bool
    /// The index the add row opens the picker with (`alarmList.length`).
    var addIndex: Int

    @MainActor static func of(_ page: AlarmPage, zone: TimeZone = .current) -> AlarmsContent? {
        guard let s = page.settings else { return nil }
        return AlarmsContent(title: page.title, alertOn: s.alertOn, barShown: s.barShown, from: s.startHour, to: s.endHour,
                             days: s.days, rows: s.rows(zone: zone).map { Row(index: $0.index, text: AlarmRow.text($0.seconds)) },
                             canAdd: s.canAdd, addIndex: s.alarms.count)
    }
}

/// The taps of S09.
struct AlarmsActions {
    var back: () -> Void = {}
    var save: () -> Void = {}
    var setAlert: (Bool) -> Void = { _ in }
    var setHours: (Double, Double) -> Void = { _, _ in }
    var toggleDay: (Int) -> Void = { _ in }
    var openPicker: (Int) -> Void = { _ in }
}

/// The page's colors (`.push` and `.dark-theme.push` in ionic.app.scss; the photo and old themes use the light page under
/// their plain header bar).
struct AlarmsColors: Equatable {
    var page: CssColor
    var card: CssColor
    var text: CssColor
    var description: CssColor
    var descriptionText: CssColor
    var border: CssColor
    var dayText: CssColor
    var dayActiveText: CssColor
    var cancel: CssColor

    static func of(_ theme: Theme) -> AlarmsColors {
        if theme == .dark {
            return AlarmsColors(page: CssColor(0x171717), card: CssColor(0x1C1C1D), text: CssColor(0xFFFFFF),
                                description: CssColor(0x444444), descriptionText: CssColor(0xDDDDDD), border: CssColor(0x111111),
                                dayText: CssColor(0xFFFFFF), dayActiveText: CssColor(0x000000), cancel: CssColor(0xFFFFFF))
        }
        return AlarmsColors(page: CssColor(0xF5F5F5), card: CssColor(0xFFFFFF), text: CssColor(0x444444),
                            description: CssColor(0xF4F4F4), descriptionText: CssColor(0x444444), border: CssColor(0xDDDDDD),
                            dayText: CssColor(0x000000), dayActiveText: CssColor(0x000000), cancel: CssColor(0x444444))
    }
}

/// Sizes of the Cordova iOS S09 in points, measured in the captures (TodayWeatherTests/AlarmsReference).
enum AlarmsMetrics {
    static let padding: CGFloat = 16
    /// A card's title row as far as the description that follows it (the item is 46 pt; the description starts 1 pt
    /// higher).
    static let titleRow: CGFloat = 45
    static let titleText: CGFloat = 17
    static let titleLine: CGFloat = 22
    static let itemTop: CGFloat = 12
    static let descriptionText: CGFloat = 14
    static let descriptionLine: CGFloat = 18
    static let descriptionTop: CGFloat = 8
    static let cardGap: CGFloat = 5
    static let sliderRow: CGFloat = 85
    /// The weekday row's item as far as the alarm row after it (78 pt with its bottom border, which the next row's top
    /// border covers).
    static let dayRow: CGFloat = 78
    static let dayHeight: CGFloat = 44
    static let dayMargin: CGFloat = 4
    static let dayText: CGFloat = 15
    static let alarmRow: CGFloat = 45
    static let alarmText: CGFloat = 16
    static let alarmLine: CGFloat = 20
    static let iconSize: CGFloat = 32
    static let iconX: CGFloat = 350
    static let buttonsHeight: CGFloat = 47
    static let buttonText: CGFloat = 15
    static let buttonLine: CGFloat = 19
    /// Measured: the text 1 px (at 3x) under the line box's centered place.
    static let buttonTop: CGFloat = 13.5 + 1.0 / 3
}

extension Glyphs {
    static let gearOutline = "\u{F43C}"   // ion-ios-gear-outline
    static let plusEmpty = "\u{F489}"     // ion-ios-plus-empty
    static let chevronUp = "\u{F126}"     // ion-chevron-up
    static let chevronDown = "\u{F123}"   // ion-chevron-down
}

/// S09 over the tabs and the tab bar, from the status bar down (the Cordova `setting-push` state is outside the tabs): the
/// status bar and header bar in the theme's plain colors (`applyIOSStatusBar(theme, 'push')`, as the settings pages), the
/// back arrow and the place's name, then the two cards and Cancel / Save in Ionic's scrolling content. Text follows
/// Dynamic Type: rows grow and the content scrolls. `scrolls: false` lays the content out at the top without a scroll view
/// (the screenshot tests render it, as `SettingsPageFrame(scrolls: false)`).
struct AlarmsPageFrame: View {
    let content: AlarmsContent
    let theme: Theme
    let catalog: Catalog
    let insets: ShellInsets
    var scrolls = true
    var actions = AlarmsActions()

    var body: some View {
        let bar = ShellColors.menu(theme)
        let colors = AlarmsColors.of(theme)
        VStack(spacing: 0) {
            bar.statusBar.color.frame(height: insets.statusBar)
            BarFrame(colors: bar, title: content.title, insets: insets, titleIdentifier: "alarms-title",
                     titleOffset: SettingsMetrics.titleBaseline) {
                BarButton(glyph: Glyphs.arrowBack, colors: bar, width: SettingsMetrics.backWidth, action: actions.back)
                    .accessibilityLabel("back")
                    .accessibilityIdentifier("alarms-back")
            } trailing: {
                EmptyView()
            }
            let cards = AlarmsCards(content: content, colors: colors, catalog: catalog, actions: actions)
                .padding(.leading, insets.leading).padding(.trailing, insets.trailing)
                .padding(.bottom, insets.bottom)
            if scrolls {
                ScrollView { cards }.scrollBounceBehavior(.basedOnSize)
            } else {
                cards.frame(minHeight: 0, maxHeight: .infinity, alignment: .top).clipped()
            }
        }
        .background(colors.page.color)
    }
}

/// The content of S09: the alert card (title and switch, description, hour bar), the alarm card (title, description,
/// weekdays, alarms, add row) and Cancel / Save.
struct AlarmsCards: View {
    let content: AlarmsContent
    let colors: AlarmsColors
    let catalog: Catalog
    let actions: AlarmsActions

    var body: some View {
        VStack(spacing: 0) {
            card {
                titleRow(catalog("LOC_WEATHER_ALERT")) {
                    AlarmToggle(on: content.alertOn) { actions.setAlert(!content.alertOn) }
                        .padding(.trailing, AlarmsMetrics.padding).padding(.top, AlarmsMetrics.itemTop)
                }
                description(catalog("LOC_ALERT_DESCRIPTION"))
                if content.barShown {
                    item(height: AlarmsMetrics.sliderRow) {
                        HourBar(from: content.from, to: content.to, onChange: actions.setHours)
                            .padding(.horizontal, AlarmsMetrics.padding).padding(.top, AlarmsMetrics.itemTop)
                    }
                    .padding(.top, -1)
                } else {
                    colors.card.color.frame(height: 1)
                }
            }
            card {
                titleRow(catalog("LOC_WEATHER_ALARM")) { EmptyView() }
                description(catalog("LOC_ALARM_DESCRIPTION"))
                item(height: AlarmsMetrics.dayRow) { days }.padding(.top, -1)
                ForEach(content.rows, id: \.index) { row in
                    alarmRow(row.text, glyph: Glyphs.gearOutline, identifier: "alarms-row-\(row.index)",
                             last: !content.canAdd && row.index == content.rows.last?.index) { actions.openPicker(row.index) }
                }
                if content.canAdd {
                    alarmRow("HH:MM", glyph: Glyphs.plusEmpty, identifier: "alarms-add", last: true) { actions.openPicker(content.addIndex) }
                }
            }
            HStack(spacing: 0) {
                bottomButton(catalog("LOC_CANCEL"), color: colors.cancel, identifier: "alarms-cancel", action: actions.back)
                bottomButton(catalog("LOC_SAVE"), color: CssColor(0xEF473A), identifier: "alarms-save", action: actions.save)
            }
            .frame(height: AlarmsMetrics.buttonsHeight)
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    /// `.list.card`: white, 2 pt corners, a shadow under it, 5 pt below.
    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 0) { content() }
            .background(colors.card.color)
            .clipShape(RoundedRectangle(cornerRadius: 2))
            .background(RoundedRectangle(cornerRadius: 2).fill(colors.card.color).shadow(color: .black.opacity(0.3), radius: 1.5, y: 1))
            .padding(.bottom, AlarmsMetrics.cardGap)
    }

    /// `.item.item-title` (no border): 17 pt medium text 12 pt down, with a control at the right.
    private func titleRow<Trailing: View>(_ text: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        ZStack(alignment: .topTrailing) {
            CssTextLine(text: text, size: AlarmsMetrics.titleText, weight: .medium, color: colors.text, height: AlarmsMetrics.titleLine)
                .padding(.leading, AlarmsMetrics.padding).padding(.top, AlarmsMetrics.itemTop)
                .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .frame(minHeight: AlarmsMetrics.titleRow, alignment: .top)
    }

    /// `.item-desc`: 14 pt text on 18 pt lines, 8 pt and 16 pt padding, the description's own gray.
    private func description(_ text: String) -> some View {
        WebKitParagraph(text: text, size: AlarmsMetrics.descriptionText, line: AlarmsMetrics.descriptionLine, color: colors.descriptionText)
            .padding(.horizontal, AlarmsMetrics.padding)
            .padding(.vertical, AlarmsMetrics.descriptionTop)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(colors.description.color)
    }

    /// An `.item` whose top border overlaps the block before it.
    private func item<C: View>(height: CGFloat, @ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 0) {
            colors.border.color.frame(height: 1)
            content().frame(maxWidth: .infinity, minHeight: height - 1, alignment: .topLeading)
        }
        .background(colors.card.color)
    }

    /// The weekday buttons (`.col.day-button`), the active ones gray.
    private var days: some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { day in
                let on = content.days.indices.contains(day) && content.days[day]
                Button { actions.toggleDay(day) } label: {
                    CssTextLine(text: catalog(Self.dayKeys[day]), size: AlarmsMetrics.dayText, weight: .medium,
                                color: on ? colors.dayActiveText : colors.dayText, height: AlarmsMetrics.dayHeight - 2)
                        .offset(x: -1.0 / 3)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: AlarmsMetrics.dayHeight - 2)
                        .padding(1)
                        .background(on ? CssColor(0xE5E5E5).color : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder((on ? CssColor(0xA2A2A2) : CssColor(0xCCCCCC)).color, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(AlarmsMetrics.dayMargin)
                .accessibilityIdentifier("alarms-day-\(day)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.horizontal, AlarmsMetrics.padding)
        // Measured: WebKit puts the buttons 2 px (at 3x) higher than this stack would.
        .padding(.top, AlarmsMetrics.itemTop - 2.0 / 3)
    }

    static let dayKeys = ["LOC_SUN", "LOC_MON", "LOC_TUE", "LOC_WED", "LOC_THU", "LOC_FRI", "LOC_SAT"]

    /// An alarm row or the add row: 16 pt text, the 32 pt glyph at the right. The card's last item has no bottom border.
    private func alarmRow(_ text: String, glyph: String, identifier: String, last: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            item(height: AlarmsMetrics.alarmRow + (last ? 0 : 1)) {
                ZStack(alignment: .topLeading) {
                    CssTextLine(text: text, size: AlarmsMetrics.alarmText, color: colors.text, height: AlarmsMetrics.alarmLine)
                        .padding(.leading, AlarmsMetrics.padding).padding(.top, AlarmsMetrics.itemTop)
                        .padding(.bottom, AlarmsMetrics.itemTop)
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        FixedCssLine(text: glyph, size: AlarmsMetrics.iconSize, color: colors.text, height: AlarmsMetrics.alarmRow - 1,
                                     face: .ionicons)
                            .frame(width: AlarmsMetrics.iconSize)
                            .padding(.trailing, 393 - AlarmsMetrics.iconX - AlarmsMetrics.iconSize)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, -1)
        .accessibilityIdentifier(identifier)
    }

    /// A half of `.buttons-bottom`: 15 pt bold, centered, no fill.
    private func bottomButton(_ text: String, color: CssColor, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            CssTextLine(text: text, size: AlarmsMetrics.buttonText, weight: .bold, color: color, height: AlarmsMetrics.buttonLine)
                .padding(.top, AlarmsMetrics.buttonTop)
                .frame(maxWidth: .infinity, minHeight: AlarmsMetrics.buttonsHeight, alignment: .top)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(0.87)
        .accessibilityIdentifier(identifier)
    }
}

/// One line of system text in a line box of `height`, its baseline where WebKit puts it (`FixedCssLine`), growing to
/// more lines with larger text sizes.
struct CssTextLine: View {
    let text: String
    let size: CGFloat
    var weight: Font.Weight = .regular
    let color: CssColor
    let height: CGFloat
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        if scale <= 1.001 {
            FixedCssLine(text: text, size: size, weight: weight, color: color, height: height)
        } else {
            Text(text).font(.system(size: size * scale, weight: weight)).foregroundStyle(color.color)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: height * scale)
        }
    }
}

/// A paragraph as WebKit wraps it: Korean breaks between syllables, the lines `line` apart, the first line's text
/// centered in its line box.
struct WebKitParagraph: View {
    @Environment(\.cssFallbackLanguage) private var fallbackLanguage
    let text: String
    let size: CGFloat
    let line: CGFloat
    let color: CssColor
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let fontSize = size * scale
        let font = fallbackLanguage.map { CssLine.system(fontSize, .regular, language: $0) } ?? .system(size: fontSize)
        let natural = UIFont.systemFont(ofSize: fontSize).lineHeight
        let pitch = line * scale
        SnapHeight(unit: pitch) {
            Text(IonicPopupView.syllableBreaks(text)).font(font).foregroundStyle(color.color)
                .lineSpacing(max(0, pitch - natural))
                .padding(.top, max(0, (pitch - natural) / 2))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Lays its child out at the top and takes a height of whole `unit`s (the lines of a paragraph `unit` apart), so text
/// layout's fractions do not move what follows.
struct SnapHeight: Layout {
    let unit: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let size = subviews.first?.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil)) ?? .zero
        return CGSize(width: size.width, height: max(1, (size.height / unit).rounded()) * unit)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
}

/// The switch (`.toggle.toggle-search`): a 38x14 track, blue when on, and a 20 pt white handle with its shadows.
struct AlarmToggle: View {
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topLeading) {
                Capsule().fill(on ? CssColor(0x387EF5).color : CssColor(0x9E9E9E, alpha: 0.8).color)
                    .frame(width: 38, height: 14)
                    .offset(x: 5, y: 6)
                Circle().fill(Color.white)
                    .frame(width: 20, height: 20)
                    .shadow(color: .black.opacity(0.35), radius: 3.5, y: 2)
                    .shadow(color: .black.opacity(0.15), radius: 0.5, y: 1)
                    .offset(x: on ? 23 : 5, y: 3)
            }
            .frame(width: 48, height: 30, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("alarms-alert")
        .accessibilityValue(on ? "1" : "0")
        .accessibilityAddTraits(.isToggle)
    }
}

/// The hour bar (ion.rangeSlider 2.x, flat skin, `type: 'double'`, 0–24 in whole hours, a grid, no min and max labels): the
/// gray line, the red bar between the handles, the handles' red lines, the hour labels above them (one label `7 — 22`
/// when they would touch) and the grid of 21 ticks with 0, 6, 12, 18 and 24. A drag moves the nearer handle; the
/// handles do not cross. `onChange` gets the hours when they change.
struct HourBar: View {
    let from: Double
    let to: Double
    let onChange: (Double, Double) -> Void
    @State private var dragging: Int?
    @Environment(\.cssFallbackLanguage) private var fallbackLanguage

    static let height: CGFloat = 60
    static let handle: CGFloat = 16
    static let red = CssColor(0xED5565)

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let span = width - Self.handle
            let x: (Double) -> CGFloat = { Self.handle / 2 + span * CGFloat($0 / 24) }
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 4).fill(CssColor(0xE1E4E9).color)
                    .frame(width: width, height: 12).offset(y: 25)
                Self.red.color.frame(width: max(0, x(to) - x(from)), height: 12).offset(x: x(from), y: 25)
                ForEach([from, to].indices, id: \.self) { i in
                    CssColor(0xDA4453).color.frame(width: 2, height: 18).offset(x: x([from, to][i]) - 1, y: 22)
                }
                labels(x: x, width: width)
                grid(x: x)
            }
            .frame(width: width, height: Self.height, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                let hour = min(24, max(0, ((value.location.x - Self.handle / 2) / span * 24).rounded()))
                if dragging == nil {
                    dragging = abs(value.startLocation.x - x(from)) <= abs(value.startLocation.x - x(to)) && !(from == to && value.startLocation.x > x(to)) ? 0 : 1
                }
                let next = dragging == 0 ? (min(hour, to), to) : (from, max(hour, from))
                if next.0 != from || next.1 != to { onChange(next.0, next.1) }
            }.onEnded { _ in dragging = nil })
        }
        .frame(height: Self.height)
        .accessibilityElement()
        .accessibilityIdentifier("alarms-hours")
        .accessibilityValue("\(Int(from))-\(Int(to))")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: if to < 24 { onChange(from, to + 1) }
            case .decrement: if from > 0 { onChange(from - 1, to) }
            @unknown default: break
            }
        }
    }

    private func text(_ s: String, size: CGFloat) -> Font {
        fallbackLanguage.map { CssLine.system(size, .regular, language: $0) } ?? .system(size: size)
    }

    /// The labels over the handles (`.irs-from`, `.irs-to`), or the single one between them when they would touch, each
    /// kept inside the line.
    @ViewBuilder private func labels(x: @escaping (Double) -> CGFloat, width: CGFloat) -> some View {
        let fromText = String(Int(from)), toText = String(Int(to))
        let fromWidth = Self.labelWidth(fromText), toWidth = Self.labelWidth(toText)
        let fromX = Self.clamp(x(from) - fromWidth / 2, fromWidth, width)
        let toX = Self.clamp(x(to) - toWidth / 2, toWidth, width)
        if fromX + fromWidth >= toX {
            let single = "\(fromText) — \(toText)"
            let w = Self.labelWidth(single)
            label(single, at: Self.clamp((x(from) + x(to)) / 2 - w / 2, w, width), width: w)
        } else {
            label(fromText, at: fromX, width: fromWidth)
            label(toText, at: toX, width: toWidth)
        }
    }

    private func label(_ s: String, at x: CGFloat, width: CGFloat) -> some View {
        VStack(spacing: 0) {
            FixedCssLine(text: s, size: 10, color: CssColor(0xFFFFFF), height: 13)
                .frame(width: width, height: 15)
                .background(Self.red.color)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            Triangle().fill(Self.red.color).frame(width: 6, height: 3)
        }
        .offset(x: x)
    }

    /// The grid (`.irs-grid`): ticks every 1.2 hours, 8 pt at the labelled ones, 4 pt between, and the 9 pt labels.
    private func grid(x: @escaping (Double) -> CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<21, id: \.self) { i in
                CssColor(0xE1E4E9).color.frame(width: 1, height: i % 5 == 0 ? 8 : 4)
                    .offset(x: x(Double(i) * 1.2) - 0.5, y: 40)
            }
            ForEach([0, 6, 12, 18, 24], id: \.self) { hour in
                let s = String(hour)
                FixedCssLine(text: s, size: 9, color: CssColor(0x999999), height: 11)
                    .fixedSize()
                    .offset(x: x(Double(hour)) - Self.textWidth(s, size: 9) / 2, y: 49 + 1.0 / 3)
            }
        }
    }

    static func clamp(_ x: CGFloat, _ w: CGFloat, _ width: CGFloat) -> CGFloat { min(max(0, x), width - w) }

    /// A label's width: the text and 5 pt padding at each side.
    static func labelWidth(_ s: String) -> CGFloat { textWidth(s, size: 10) + 10 }

    static func textWidth(_ s: String, size: CGFloat) -> CGFloat {
        CssLine.width([CssRun(text: s, size: size)])
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: rect.minX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
            p.closeSubpath()
        }
    }
}

/// The time picker O14 (ionic-timepicker 0.5.1 in an Ionic popup without a title): the heading `08 : 00 AM`, the up and
/// down arrows over and under the hours, minutes and meridian boxes with the colons between, and Set, Delete and Close
/// side by side under it.
struct TimePickerView: View {
    let time: TimePicker
    let catalog: Catalog
    var turn: ((TimePicker) -> TimePicker) -> Void = { _ in }
    var set: () -> Void = {}
    var delete: () -> Void = {}
    var close: () -> Void = {}

    static let columns: [CGFloat] = [20, 100.5, 181]

    var body: some View {
        VStack(spacing: 0) {
            // Measured: the heading's text 1/2 pt under the line box's centered place.
            FixedCssLine(text: time.heading, size: 18, weight: .bold, color: CssColor(0x444444), height: 42)
                .offset(y: 0.5)
                .frame(maxWidth: .infinity, minHeight: 42)
                .overlay(Rectangle().strokeBorder(CssColor(0xDDDDDD).color, lineWidth: 1).padding(.vertical, -1))
                .padding(.vertical, 1)
                .accessibilityIdentifier("picker-heading")
            ZStack(alignment: .topLeading) {
                Color.white.frame(width: 250, height: 120)
                column(0, time.hours, up: { $0.increaseHours() }, down: { $0.decreaseHours() })
                column(1, time.minutes, up: { $0.increaseMinutes() }, down: { $0.decreaseMinutes() })
                column(2, time.meridian, up: { $0.changeMeridian() }, down: { $0.changeMeridian() })
                ForEach([72.5, 153] as [CGFloat], id: \.self) { x in
                    FixedCssLine(text: ":", size: 14, weight: .bold, color: CssColor(0x000000), height: 20)
                        .frame(width: 23).offset(x: x, y: 50)
                }
            }
            // The 45 pt buttons in a 44 pt bar (the popup is 208 pt, the buttons reach 1 pt below it).
            HStack(spacing: 1) {
                button(catalog("LOC_SETTING"), "picker-set", set)
                button(catalog("LOC_DELETE"), "picker-delete", delete)
                button(catalog("LOC_CLOSE"), "picker-close", close)
            }
            .frame(height: 44, alignment: .top)
        }
        .frame(width: 250)
        .background(Color.white)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("picker")
    }

    private func column(_ i: Int, _ value: String, up: @escaping (TimePicker) -> TimePicker,
                        down: @escaping (TimePicker) -> TimePicker) -> some View {
        VStack(spacing: 0) {
            Button { turn(up) } label: {
                FixedCssLine(text: Glyphs.chevronUp, size: 16, color: CssColor(0x444444), height: 19, face: .ionicons)
                    .frame(width: 47.5, height: 30, alignment: .top).offset(x: -1.0 / 3, y: 5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(height: 30, alignment: .top)
            .accessibilityIdentifier("picker-up-\(i)")
            FixedCssLine(text: value, size: 16, color: CssColor(0x000000), height: 38)
                .frame(width: 45.5, height: 38)
                .padding(1)
                .overlay(Rectangle().strokeBorder(CssColor(0xDDDDDD).color, lineWidth: 1))
                .accessibilityIdentifier("picker-value-\(i)")
            Button { turn(down) } label: {
                FixedCssLine(text: Glyphs.chevronDown, size: 16, color: CssColor(0x444444), height: 19, face: .ionicons)
                    .frame(width: 47.5, height: 30, alignment: .top).offset(x: -1.0 / 3, y: 5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(height: 30, alignment: .top)
            .accessibilityIdentifier("picker-down-\(i)")
        }
        .offset(x: Self.columns[i], y: 10)
    }

    private func button(_ text: String, _ identifier: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // `.button` with 12 pt padding and 20 pt lines: a word wider than the button breaks (English "Settings").
            Text(text).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineSpacing(max(0, 20 - UIFont.systemFont(ofSize: 15, weight: .bold).lineHeight))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 45)
                .background(CssColor(0x444444).color)
                .clipShape(RoundedRectangle(cornerRadius: 2))
        }
        .buttonStyle(.plain)
        .opacity(0.87)
        .accessibilityIdentifier(identifier)
    }
}
