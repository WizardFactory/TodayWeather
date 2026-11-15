import Foundation
import TWModel

/// A parameter value of an analytics event as a caller gives it: a string or a number (JavaScript's two types the
/// schema accepts).
public enum AnalyticsValue: Equatable, Sendable {
    case text(String)
    case number(Double)
}

/// A parameter value the SDK receives: a fixed string or a non-negative whole number.
public enum AnalyticsParameter: Equatable, Sendable {
    case text(String)
    case integer(Int)
}

/// The analytics events of `Monetization` (service.monetization.js): no raw error strings, URLs, identifiers or
/// places, only these fields. A field is a list of allowed strings or the largest allowed non-negative integer.
/// Port of the Android `AnalyticsSchema` (AN-15).
public enum AnalyticsSchema {
    /// Added to every event (`emit`).
    public static let measurementVersion = 1

    enum Rule: Equatable {
        case oneOf([String])
        case upTo(Int)
    }

    static let duration = Rule.upTo(600_000)

    /// The events in the schema's order, each with its fields in order.
    static let events: [(name: String, fields: [(key: String, rule: Rule)])] = [
        ("weather_fetch", [("outcome", .oneOf(["success", "network_error", "invalid_input"])), ("duration_ms", duration)]),
        ("weather_load", [("outcome", .oneOf(["success", "network_error", "invalid_response"])), ("duration_ms", duration)]),
        ("favorite_change", [("action", .oneOf(["add", "remove"]))]),
        ("location_permission", [("outcome", .oneOf(["granted", "denied", "unknown"]))]),
        ("ad_lifecycle", [("action", .oneOf(["request", "loaded", "failed", "impression", "show", "hide", "consent_failed"])),
                          ("ad_format", .oneOf(["banner"]))]),
        ("ad_load_error", [("ad_format", .oneOf(["banner"])), ("error_code", .upTo(999))]),
        ("ad_policy_exposure", [("delay_seconds", .upTo(120))]),
    ]

    /// The event names the schema allows.
    public static var eventNames: [String] { events.map(\.name) }

    /// The fixed route names a `screen_view` may carry (`screens`).
    public static let screens = ["start", "guide", "units", "setting-radio", "setting-push", "kma-special", "nation",
                                 "nation-air", "tab", "tab.search", "tab.air", "tab.forecast", "tab.dailyforecast",
                                 "tab.weather"]

    /// The event's own fields in the schema's order, or nil to drop it: an unknown event, a missing or invalid field.
    /// A number must be finite, whole, at least 0 and at most the field's limit (`Math.floor(value) === value`).
    public static func validate(_ name: String, _ params: [String: AnalyticsValue]?) -> [(String, AnalyticsParameter)]? {
        guard let fields = events.first(where: { JSString.equal($0.name, name) })?.fields, let params else { return nil }
        var safe: [(String, AnalyticsParameter)] = []
        for (key, rule) in fields {
            let value = params[key]
            switch rule {
            case .oneOf(let allowed):
                guard case .text(let text)? = value, allowed.contains(where: { JSString.equal($0, text) }) else { return nil }
                safe.append((key, .text(text)))
            case .upTo(let limit):
                guard case .number(let number)? = value, number.isFinite, number >= 0, number <= Double(limit),
                      number.rounded(.down) == number else { return nil }
                safe.append((key, .integer(Int(number))))
            }
        }
        return safe
    }

    /// Whether `name` is a screen the schema allows.
    public static func isScreen(_ name: String) -> Bool {
        screens.contains { JSString.equal($0, name) }
    }
}
