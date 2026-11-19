import Foundation
import TWModel

/// Both processes project the same converted v000903 weather record. All temperatures
/// already use the units in the request. Keep local forecast dates/hours in the place's time.
enum WidgetWeatherProjection {
    static func make(_ record: JSONObject, updatedAt: Date) -> WidgetWeather? {
        guard let current = record["currentWeather"]?.objectValue,
              let currentTemperature = degrees(current["t1h"]) else { return nil }
        let today = current["today"]
        let days = record["dayChart"]?.arrayValue?.first?["values"]?.arrayValue ?? []
        let daily = days.compactMap { row -> WidgetForecast? in
            guard let offset = row["fromToday"]?.numberValue?.double, offset >= 0,
                  let date = row["date"]?.stringValue, date.count == 8,
                  let month = Int(date.dropFirst(4).prefix(2)), let day = Int(date.suffix(2)),
                  let high = degrees(row["tmx"]), let low = degrees(row["tmn"]) else { return nil }
            return WidgetForecast(label: "\(month)/\(day)", temperature: "\(high)/\(low)", symbol: symbol(row["skyIcon"]))
        }
        let hourly = hourlyForecast(record, current: current)
        let pollution = current["arpltn"]
        let worst = ["khai", "pm10", "pm25"].compactMap { key -> (Double, String)? in
            guard let grade = pollution?[key + "Grade"]?.numberValue?.double,
                  let label = pollution?[key + "Str"]?.stringValue, !label.isEmpty else { return nil }
            return (grade, label)
        }.max { $0.0 < $1.0 }
        return WidgetWeather(date: updatedAt, temperature: currentTemperature, symbol: symbol(current["skyIcon"]),
                             high: degrees(today?["tmx"]) ?? "–", low: degrees(today?["tmn"]) ?? "–",
                             air: worst?.1 ?? "", daily: Array(daily.prefix(6)), hourly: Array(hourly.prefix(6)),
                             airGrade: worst?.0)
    }

    // The service supplies place-local dates and hours. A fixed calendar keeps those wall-clock
    // labels independent of the device time zone and treats 24:00 as the next day's 00:00.
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()

    private static func localHour(_ row: JSONObject) -> Date? {
        guard let date = row["date"]?.stringValue, date.count == 8,
              let year = Int(date.prefix(4)), let month = Int(date.dropFirst(4).prefix(2)),
              let day = Int(date.suffix(2)), let raw = row["time"]?.numberValue?.double,
              let hour = Int(exactly: raw), (0...24).contains(hour) else { return nil }
        let parts = DateComponents(year: year, month: month, day: day)
        guard parts.isValidDate(in: calendar), let midnight = calendar.date(from: parts) else { return nil }
        return calendar.date(byAdding: .hour, value: hour, to: midnight)
    }

    private static func hourlyForecast(_ record: JSONObject, current: JSONObject) -> [WidgetForecast] {
        guard let now = localHour(current) else { return [] }
        let series = record["timeChart"]?.arrayValue?.first { $0["name"]?.stringValue == "yesterday" }
        var previous: [Date: String] = [:]
        for entry in series?["values"]?.arrayValue ?? [] {
            guard let row = entry["value"]?.objectValue, let hour = localHour(row), hour <= now,
                  let value = row["t3h"], let temperature = degrees(value) else { continue }
            if record["source"]?.stringValue == "KMA",
               (value.numberValue?.double ?? value.stringValue.flatMap(Double.init)) == -50 { continue }
            previous[hour] = temperature
        }
        let rows = record["timeTable"]?.arrayValue ?? []
        return rows.compactMap { entry in
            guard let row = entry.objectValue, let hour = localHour(row), hour > now,
                  let temperature = degrees(row["t3h"]) else { return nil }
            let label = String(format: "%02d:00", calendar.component(.hour, from: hour))
            let yesterday = calendar.date(byAdding: .day, value: -1, to: hour)
            return WidgetForecast(label: label, temperature: temperature, symbol: symbol(row["skyIcon"]),
                                  previousTemperature: yesterday.flatMap { previous[$0] })
        }
    }

    private static func degrees(_ value: JSONValue?) -> String? {
        guard let number = value?.numberValue?.double ?? value?.stringValue.flatMap(Double.init),
              number.isFinite, (-200...250).contains(number) else { return nil }
        return String(Int(number.rounded())) + "°"
    }

    private static func symbol(_ value: JSONValue?) -> String {
        let icon = value?.stringValue?.lowercased() ?? ""
        if icon.contains("lightning") { return "cloud.bolt.rain.fill" }
        if icon.contains("rainsnow") { return "cloud.sleet.fill" }
        if icon.contains("rain") { return "cloud.rain.fill" }
        if icon.contains("snow") { return "cloud.snow.fill" }
        if icon.contains("fog") || icon.contains("mist") { return "cloud.fog.fill" }
        if icon.contains("moon") { return icon.contains("cloud") ? "cloud.moon.fill" : "moon.fill" }
        if icon.contains("sun") { return icon.contains("cloud") ? "cloud.sun.fill" : "sun.max.fill" }
        if icon.contains("cloud") { return "cloud.fill" }
        return "questionmark.circle"
    }
}
