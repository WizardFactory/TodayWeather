import SwiftUI

struct TemperatureCurve: View {
    let items: [WidgetForecast]
    let hourly: Bool

    static let warm = Color(red: 1, green: 0.75, blue: 0.43)
    static let cool = Color(red: 0.63, green: 0.86, blue: 0.96)

    static let lavender = Color(red: 197 / 255, green: 178 / 255, blue: 235 / 255)
    private static let yesterdayStroke = StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round, dash: [4, 3])

    var body: some View {
        let samples = items.compactMap { WidgetTemperatureSample($0, hourly: hourly) }
        if !samples.isEmpty {
            let upper = samples.map(\.upper)
            let lower = samples.compactMap(\.lower)
            let previous = samples.compactMap(\.previous)
            let temperatures = upper + lower + previous
            let minT = temperatures.min() ?? 0
            let maxT = temperatures.max() ?? minT
            VStack(spacing: 1) {
                if !previous.isEmpty {
                    HStack(spacing: 10) {
                        legend("Forecast", color: Self.warm, stroke: StrokeStyle(lineWidth: 1.7))
                        legend("Previous day", color: Self.lavender, stroke: Self.yesterdayStroke)
                    }.frame(maxWidth: .infinity, alignment: .trailing)
                }
                GeometryReader { geometry in
                    let width = geometry.size.width / CGFloat(samples.count)
                    let plotHeight = max(0, geometry.size.height - 26)
                    let point: (Int, Double) -> CGPoint = { index, temp in
                        let fraction = maxT == minT ? 0.5 : (maxT - temp) / (maxT - minT)
                        return CGPoint(x: (CGFloat(index) + 0.5) * width, y: 13 + plotHeight * fraction)
                    }
                    series(upper, point: point, color: Self.warm) { i in
                        upper[i] >= (samples[i].previous ?? upper[i])
                    }
                    if !previous.isEmpty {
                        previousSeries(samples, point: point)
                    }
                    series(lower, point: point, color: Self.cool) { _ in false }
                }
                HStack(spacing: 0) {
                    ForEach(samples.indices, id: \.self) { i in
                        Text(verbatim: samples[i].label).frame(maxWidth: .infinity)
                    }
                }.font(.system(size: 10, weight: .medium))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(items.map { item in
                let forecast = "\(item.label) \(item.temperature)"
                guard hourly, let previous = item.previousTemperature else { return forecast }
                return "\(forecast), \(String(localized: "Previous day")) \(previous)"
            }.joined(separator: ", "))
        }
    }

    private func legend(_ label: LocalizedStringKey, color: Color, stroke: StrokeStyle) -> some View {
        HStack(spacing: 4) {
            Path { line in
                line.move(to: CGPoint(x: 0, y: 2))
                line.addLine(to: CGPoint(x: 15, y: 2))
            }.stroke(color, style: stroke).frame(width: 15, height: 4)
            Text(label).font(.system(size: 10, weight: .medium))
        }
    }

    private func previousSeries(_ samples: [WidgetTemperatureSample],
                                point: @escaping (Int, Double) -> CGPoint) -> some View {
        ZStack(alignment: .topLeading) {
            Path { line in
                var connected = false
                for (i, sample) in samples.enumerated() {
                    guard let value = sample.previous else { connected = false; continue }
                    if connected { line.addLine(to: point(i, value)) } else { line.move(to: point(i, value)) }
                    connected = true
                }
            }.stroke(Self.lavender, style: Self.yesterdayStroke)
            ForEach(samples.indices, id: \.self) { i in
                if let value = samples[i].previous {
                    let p = point(i, value)
                    Circle().strokeBorder(Self.lavender, lineWidth: 1)
                        .frame(width: 4.5, height: 4.5).position(p)
                    if value != samples[i].upper {
                        Text(verbatim: "\(Int(value.rounded()))°")
                            .font(.system(size: 9, weight: .medium)).foregroundStyle(Self.lavender)
                            .position(x: p.x, y: p.y + (value > samples[i].upper ? -8 : 8))
                    }
                }
            }
        }
    }

    private func series(_ values: [Double], point: @escaping (Int, Double) -> CGPoint,
                        color: Color, labelAbove: @escaping (Int) -> Bool) -> some View {
        ZStack(alignment: .topLeading) {
            Path { line in
                for (i, val) in values.enumerated() {
                    if i == 0 { line.move(to: point(i, val)) } else { line.addLine(to: point(i, val)) }
                }
            }.stroke(color, style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))
            ForEach(values.indices, id: \.self) { i in
                let p = point(i, values[i])
                Circle().fill(color).frame(width: 4, height: 4).position(p)
                Text(verbatim: "\(Int(values[i].rounded()))°")
                    .font(.system(size: 10, weight: .bold)).foregroundStyle(color)
                    .position(x: p.x, y: p.y + (labelAbove(i) ? -8 : 8))
            }
        }
    }
}
