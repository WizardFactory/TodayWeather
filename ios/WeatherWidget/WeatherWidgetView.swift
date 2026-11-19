import SwiftUI
import WidgetKit

private let slate = Color(red: 0.10, green: 0.18, blue: 0.22)

struct WeatherWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.showsWidgetContainerBackground) private var showsBackground
    let entry: WeatherWidgetEntry
    let design: WeatherDesign

    private var isSmall: Bool { family == .systemSmall }
    private var ink: Color { showsBackground ? (design == .curve ? .white : slate) : .primary }

    var body: some View {
        Group {
            switch entry.content {
            case .openApp:
                message("Open TodayWeather and check the weather to resume widget updates.")
            case .unavailable:
                message("Open TodayWeather to check the weather for this place.")
            case let .weather(name, weather, mode):
                VStack(alignment: .leading, spacing: isSmall ? 5 : 3) {
                    HStack {
                        Text(verbatim: name).font(.subheadline.bold())
                        Spacer(minLength: 2)
                        Text(weather.date, style: Calendar.current.isDate(weather.date, inSameDayAs: entry.date) ? .time : .date)
                            .font(.caption2).opacity(0.75)
                    }
                    if isSmall {
                        Spacer(minLength: 1)
                        HStack(spacing: 5) {
                            if design != .sky { glyph(weather.symbol, size: 39) }
                            temperature(weather)
                            if design == .sky { Spacer(minLength: 0); glyph(weather.symbol, size: 48) }
                        }
                        if design == .curve { rangeMeter(weather) } else { range(weather) }
                        Spacer(minLength: 1)
                        air(weather)
                    } else {
                        currentConditions(weather)
                        let items = mode == .hourly ? weather.hourly : weather.daily
                        if !items.isEmpty {
                            if design == .curve {
                                Divider().overlay(ink.opacity(0.25))
                                TemperatureCurve(items: items, hourly: mode == .hourly)
                            } else {
                                if design == .classic { Divider() }
                                forecastRow(items)
                            }
                        }
                    }
                }
            }
        }
        .lineLimit(1).minimumScaleFactor(0.75)
        .foregroundStyle(ink)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { WeatherBackdrop(design: design) }
    }

    private func message(_ key: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("TodayWeather", systemImage: "cloud.sun").font(.headline)
            Text(key).font(.subheadline).lineLimit(nil).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func currentConditions(_ w: WidgetWeather) -> some View {
        HStack(spacing: 7) {
            if design != .sky { glyph(w.symbol, size: 39) }
            temperature(w)
            if design == .sky {
                VStack(alignment: .leading, spacing: 4) { range(w); air(w) }
                Spacer(minLength: 0)
                glyph(w.symbol, size: 49)
            } else {
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 4) { range(w); air(w) }
            }
        }
    }

    private func temperature(_ w: WidgetWeather) -> some View {
        Text(verbatim: w.temperature).font(.system(size: 36, weight: .bold, design: .rounded))
    }

    private func range(_ w: WidgetWeather) -> some View {
        HStack(spacing: 7) {
            Text(verbatim: "↑ \(w.high)")
            Text(verbatim: "↓ \(w.low)")
        }.font(.caption.weight(.semibold))
    }

    @ViewBuilder private func rangeMeter(_ w: WidgetWeather) -> some View {
        if let low = WidgetTemperatureSample.value(w.low), let high = WidgetTemperatureSample.value(w.high),
           high > low, let now = WidgetTemperatureSample.value(w.temperature) {
            VStack(spacing: 3) {
                HStack { Text(verbatim: w.low); Spacer(); Text(verbatim: w.high) }.font(.caption.bold())
                GeometryReader { area in
                    let fraction = min(1, max(0, (now - low) / (high - low)))
                    Capsule().fill(LinearGradient(colors: [TemperatureCurve.cool, TemperatureCurve.warm],
                                                   startPoint: .leading, endPoint: .trailing)).frame(height: 4)
                    Circle().fill(.white).frame(width: 8, height: 8)
                        .position(x: 4 + fraction * max(0, area.size.width - 8), y: 2)
                }.frame(height: 6)
            }
        } else { range(w) }
    }

    @ViewBuilder private func air(_ w: WidgetWeather) -> some View {
        if !w.air.isEmpty {
            let color: Color = switch w.airGrade {
            case 1?: Color(red: 0.08, green: 0.45, blue: 0.30)
            case 2?: Color(red: 0.17, green: 0.48, blue: 0.60)
            case 3?: Color(red: 0.80, green: 0.42, blue: 0.06)
            case 4?: Color(red: 0.76, green: 0.18, blue: 0.18)
            default: .gray
            }
            HStack(spacing: 4) {
                Circle().fill(color).frame(width: 6, height: 6)
                Text(verbatim: w.air).font(.system(size: 10, weight: .semibold))
            }
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(design == .curve ? 0.32 : 0.13), in: Capsule())
        }
    }

    private func forecastRow(_ items: [WidgetForecast]) -> some View {
        HStack(spacing: 1) {
            ForEach(items.indices, id: \.self) { i in
                VStack(spacing: 1) {
                    Text(verbatim: items[i].label)
                    glyph(items[i].symbol, size: 21)
                    Text(verbatim: items[i].temperature).fontWeight(.semibold)
                }.frame(maxWidth: .infinity)
            }
        }
        .font(.system(size: 10))
        .padding(.vertical, 3)
        .background { if design == .sky { RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.66)) } }
    }

    @ViewBuilder private func glyph(_ symbol: String, size: CGFloat) -> some View {
        let asset: String? = switch symbol {
        case "sun.max.fill": "Sun"
        case "moon.fill": "Moon"
        case "cloud.sun.fill": "SunSmallCloud"
        case "cloud.moon.fill": "MoonSmallCloud"
        case "cloud.fill": "Cloud"
        case "cloud.rain.fill": "CloudRain"
        case "cloud.snow.fill": "CloudSnow"
        case "cloud.sleet.fill": "CloudRainSnow"
        case "cloud.bolt.rain.fill": "CloudRainLightning"
        default: nil
        }
        Group {
            if let asset { Image(asset).renderingMode(.original).resizable() }
            else { Image(systemName: symbol).resizable().scaledToFit() }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}

private struct WeatherBackdrop: View {
    let design: WeatherDesign

    var body: some View {
        switch design {
        case .classic: LinearGradient(colors: [.white, Color(red: 0.92, green: 0.95, blue: 0.95)],
                                      startPoint: .topLeading, endPoint: .bottomTrailing)
        case .curve: LinearGradient(colors: [slate, Color(red: 0.06, green: 0.13, blue: 0.19)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing)
        case .sky:
            ZStack {
                LinearGradient(colors: [Color(red: 0.60, green: 0.81, blue: 0.89), Color(red: 0.85, green: 0.93, blue: 0.86),
                                        Color(red: 1, green: 0.89, blue: 0.66)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Hill(level: 0.68).fill(Color.teal.opacity(0.16))
                Hill(level: 0.84).fill(Color.teal.opacity(0.17))
            }
        }
    }
}

private struct Hill: Shape {
    let level: CGFloat

    func path(in rect: CGRect) -> Path {
        Path { p in
            let w = rect.width, h = rect.height, y = h * level
            p.move(to: CGPoint(x: 0, y: y))
            p.addQuadCurve(to: CGPoint(x: w * 0.54, y: y), control: CGPoint(x: w * 0.24, y: y - h * 0.25))
            p.addQuadCurve(to: CGPoint(x: w, y: y - 7), control: CGPoint(x: w * 0.8, y: y + h * 0.22))
            p.addLine(to: CGPoint(x: w, y: h)); p.addLine(to: CGPoint(x: 0, y: h)); p.closeSubpath()
        }
    }
}
