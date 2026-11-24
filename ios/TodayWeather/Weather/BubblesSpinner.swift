import SwiftUI

/// The weather pages' header buttons (the iOS template): the bell (`ion-ios-bell` with alarms, else `-outline`) and share
/// (`ion-ios-upload-outline`), each with `padding: 0 4px`, share with `margin-right: 4px`. An unsaved place (#3180, #3097)
/// has the outline star (`ion-ios-star-outline`) in the bell's position, which saves it.
struct WeatherBarActions: View {
    let hasPush: Bool
    let colors: ShellColors
    var unsaved = false
    var starLabel = "Add to favorites"
    var onBell: () -> Void = {}
    var onShare: () -> Void = {}
    var onStar: () -> Void = {}
    /// This header's share anchor: the tap names it, so the sheet opens in this button's window (IN-16).
    @State private var shareAnchor = ShareAnchorBox()

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if unsaved {
                // The bell's glyph position, in a 44 × 44 pt touch area (CODEX-3195-6).
                Button(action: onStar) {
                    Text(Glyphs.starOutline)
                        .font(Glyphs.ionicons(ShellMetrics.barGlyph))
                        .foregroundStyle(colors.headerText.color)
                        .outlined(colors.headerOutline)
                        .frame(width: 36, height: ShellMetrics.barGlyph)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(0.87)
                .accessibilityLabel(starLabel)
                .accessibilityIdentifier("forecast-star")
            } else {
                BarButton(glyph: hasPush ? Glyphs.bell : Glyphs.bellOutline, colors: colors, width: 36, action: onBell)
                    .accessibilityLabel("notifications")
                    .accessibilityIdentifier("forecast-bell")
            }
            BarButton(glyph: Glyphs.upload, colors: colors, width: 32) {
                ShareAnchor.tapped = shareAnchor.view
                onShare()
            }
                .accessibilityLabel("share")
                .accessibilityIdentifier("forecast-share")
                // The share sheet's popover points at the button on iPad (IN-16, `ShareAnchor`); outside the button's
                // accessibility modifiers, so the anchor takes neither its label nor its identifier.
                .background(ShareAnchorView(box: shareAnchor).opacity(0).accessibilityHidden(true))
                .padding(.trailing, 4)
        }
    }
}

/// Ionic's `<ion-spinner icon="bubbles">` (O17, the header's loading indicator): eight circles on a ring in a 28 pt box,
/// each fading and shrinking in turn over one second, in `.spinner`'s #444.
struct BubblesSpinner: View {
    var color = CssColor(0x444444)

    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1)
            Canvas { gc, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                for i in 0..<8 {
                    let angle = Double(i) / 8 * 2 * .pi
                    // Ionic's bubbles: radius 5 at the start of each one's cycle, shrinking to 0.
                    let phase = (t - Double(i) / 8).truncatingRemainder(dividingBy: 1)
                    let r = 5 * (1 - (phase < 0 ? phase + 1 : phase))
                    let p = CGPoint(x: center.x + 9 * sin(angle), y: center.y - 9 * cos(angle))
                    gc.fill(Path(ellipseIn: CGRect(x: p.x - r / 2, y: p.y - r / 2, width: r, height: r)), with: .color(color.color))
                }
            }
        }
        .frame(width: 28, height: 28)
        .accessibilityLabel("loading")
    }
}
