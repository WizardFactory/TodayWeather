import SwiftUI

/// The optional settings link at the end of the three weather pages uses the current card theme.
struct TrackingNotice: View {
    let catalog: Catalog
    let colors: WeatherColors
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text(catalog("LOC_TRACKING_NOTICE"))
                .font(.footnote)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("tracking-notice-text")
            Button(catalog("LOC_TRACKING_OPEN_SETTINGS"), action: openSettings)
                .buttonStyle(.bordered)
                .accessibilityIdentifier("tracking-open-settings")
        }
        .foregroundStyle(colors.text.color)
        .tint(colors.text.color)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(colors.card.color)
        .cardShadow()
        .padding(.vertical, WeatherMetrics.gap)
    }
}
