import Foundation
import TWModel

/// The weather photo feed of the photo theme (`loadWeatherPhotos` and `findWeatherPhoto` in
/// client/www/js/service.weatherutil.js): photos grouped by their joined tags, and a photo for a sky icon. Port of the
/// Android `WeatherPhotos`; checked against corpus/photos.json from the Cordova code.
public struct WeatherPhotos: Sendable {
    /// The groups in `findWeatherPhoto`'s order.
    public static let keys = ["lightning", "rain", "snow", "sun_smallcloud", "sun_bigcloud", "sun", "moon_smallcloud",
                              "moon_bigcloud", "moon", "cloud"]

    /// The photos of each group, in feed order.
    public let groups: [String: [JSONObject]]

    /// Groups the items of `feed`, the response body (a JSON array). Items without a `tags` array are skipped; a null
    /// item ends the grouping (reading its tags throws in the Cordova loop, after the groups were set).
    public static func parse(_ feed: JSONValue) -> WeatherPhotos {
        var groups = Dictionary(uniqueKeysWithValues: keys.map { ($0, [JSONObject]()) })
        for item in feed.arrayValue ?? [] {
            if item.isNull { break }
            guard let photo = item.objectValue, let tags = photo["tags"]?.arrayValue else { continue }
            let tag = join(tags)
            func has(_ s: String) -> Bool { JSString.includes(tag, s) }
            let key: String? =
                if has("lightning") { "lightning" }
                else if has("rain") { "rain" }
                else if has("snow") { "snow" }
                else if has("sun") { has("smallcloud") ? "sun_smallcloud" : has("bigcloud") ? "sun_bigcloud" : "sun" }
                else if has("moon") { has("smallcloud") ? "moon_smallcloud" : has("bigcloud") ? "moon_bigcloud" : "moon" }
                else if has("cloud") { "cloud" }
                else { nil }
            if let key { groups[key]!.append(photo) }
        }
        return WeatherPhotos(groups: groups)
    }

    /// `findWeatherPhoto`: the first group whose key is in `skyIcon` and has photos, and its photo at
    /// `floor(random * (count - 1))`, so the last photo of a group is never chosen. `random` is in [0, 1).
    public func find(skyIcon: String?, random: Double) -> String? {
        guard let skyIcon, !skyIcon.isEmpty else { return nil }
        for key in Self.keys where JSString.includes(skyIcon, key) {
            let photos = groups[key] ?? []
            if !photos.isEmpty {
                let photo = photos[Int((random * Double(photos.count - 1)).rounded(.down))]
                return photo["twUrls"]?["regular"]?.stringValue
            }
        }
        return nil
    }

    /// `Array.prototype.join('_')`: null and undefined join as "", arrays as their own `join(',')`.
    private static func join(_ values: [JSONValue], separator: String = "_") -> String {
        values.map { value -> String in
            switch value {
            case .null: ""
            case .array(let inner): join(inner, separator: ",")
            default: Js.string(value)
            }
        }.joined(separator: separator)
    }
}
