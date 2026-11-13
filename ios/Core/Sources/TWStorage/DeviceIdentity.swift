import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// `Device-Id` sent to the legacy server: the `device.uuid` of cordova-plugin-device 3.0.0
/// (`CDVDevice.uniqueAppInstanceIdentifier`). The plugin keeps it in standard `UserDefaults` under `CDVUUID`, set on
/// first use from `identifierForVendor`. The native app reads that value and creates it the same way only when
/// it is absent.
public enum DeviceIdentity {
    public static let key = "CDVUUID"

    /// The stored identifier (`stringForKey:`), or a new one from `vendorIdentifier` stored under `CDVUUID`; nil
    /// when neither exists (the vendor identifier can be unavailable before the first unlock).
    public static func deviceId(defaults: UserDefaults, vendorIdentifier: () -> UUID?) -> String? {
        if let stored = defaults.string(forKey: key) { return stored }
        guard let uuid = vendorIdentifier() else { return nil }
        let id = uuid.uuidString
        defaults.set(id, forKey: key)
        return id
    }

    #if canImport(UIKit)
    @MainActor
    public static func deviceId() -> String? {
        deviceId(defaults: .standard) { UIDevice.current.identifierForVendor }
    }
    #endif
}
