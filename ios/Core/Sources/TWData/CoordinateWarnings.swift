import Foundation
import TWModel

public struct CoordinateWarnings: Sendable {
    public enum State: String, Sendable {
        case current, unavailable, unsupported
    }

    public struct Source: Sendable {
        public let issuer: String
        public let state: State
        public let asOf: Date?
        public let freshUntil: Date?
        public let payload: JSONValue
    }

    public struct Warning: Sendable {
        public let issuer: String
        public let id: String
        public let event: String
        public let effectiveAt: Date
        public let expiresAt: Date
        public let endsAt: Date?
        public let payload: JSONValue
    }

    public let lat: Double
    public let lon: Double
    public let checkedAt: Date
    public let sources: [Source]
    public let warnings: [Warning]

    /// Validate coverage and expiry whenever the caller reads a saved response.
    public func current(at now: Date) -> Self {
        let available = sources.map { source in
            guard source.state == .current, let expiry = source.freshUntil, expiry <= now else { return source }
            return Source(issuer: source.issuer, state: .unavailable, asOf: source.asOf,
                          freshUntil: source.freshUntil, payload: source.payload)
        }
        let issuers = Set(available.filter { $0.state == .current }.map(\.issuer))
        return Self(lat: lat, lon: lon, checkedAt: checkedAt, sources: available,
                    warnings: warnings.filter { issuers.contains($0.issuer) && $0.effectiveAt <= now &&
                        $0.expiresAt > now && ($0.endsAt ?? .distantFuture) > now })
    }

    static func decode(_ json: JSONValue, lat: Double, lon: Double, parser: ISO8601DateFormatter) -> Self? {
        func date(_ row: JSONValue, _ key: String) -> Date? {
            row[key]?.stringValue.flatMap(parser.date(from:))
        }
        guard json["location"]?["lat"]?.numberValue?.double == lat,
              json["location"]?["lon"]?.numberValue?.double == lon,
              let checkedAt = date(json, "checkedAt"), let rawSources = json["sources"]?.arrayValue,
              !rawSources.isEmpty, let rawWarnings = json["warnings"]?.arrayValue
        else { return nil }

        var sources: [Source] = []
        for row in rawSources {
            guard let issuer = row["issuer"]?.stringValue, let rawState = row["state"]?.stringValue,
                  let state = State(rawValue: rawState) else { return nil }
            let asOf = date(row, "asOf"), freshUntil = date(row, "freshUntil")
            if state == .current && (asOf == nil || freshUntil == nil) { return nil }
            sources.append(Source(issuer: issuer, state: state, asOf: asOf, freshUntil: freshUntil, payload: row))
        }

        var warnings: [Warning] = []
        for row in rawWarnings {
            guard let issuer = row["issuer"]?.stringValue, let id = row["id"]?.stringValue,
                  let event = row["event"]?.stringValue, let effectiveAt = date(row, "effectiveAt"),
                  let expiresAt = date(row, "expiresAt")
            else { return nil }
            let endsAt = date(row, "endsAt")
            if row["endsAt"] != nil && endsAt == nil { return nil }
            warnings.append(Warning(issuer: issuer, id: id, event: event, effectiveAt: effectiveAt,
                                    expiresAt: expiresAt, endsAt: endsAt, payload: row))
        }
        return Self(lat: lat, lon: lon, checkedAt: checkedAt, sources: sources, warnings: warnings)
    }
}
