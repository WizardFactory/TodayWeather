import SwiftUI

/// The weather pages' header buttons (the iOS template): the bell (`ion-ios-bell` with alarms, else `-outline`) and share
/// (`ion-ios-upload-outline`), each with `padding: 0 4px`, share with `margin-right: 4px`.
struct WeatherBarActions: View {
    let hasPush: Bool
    let colors: ShellColors
    var onBell: () -> Void = {}
    var onShare: () -> Void = {}

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            BarButton(glyph: hasPush ? Glyphs.bell : Glyphs.bellOutline, colors: colors, width: 36, action: onBell)
                .accessibilityLabel("notifications")
                .accessibilityIdentifier("forecast-bell")
            BarButton(glyph: Glyphs.upload, colors: colors, width: 32, action: onShare)
                .accessibilityLabel("share")
                .accessibilityIdentifier("forecast-share")
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
