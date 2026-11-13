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
    /// when neither exists (the vendor identifier can be unavailable before the first unlock). `preferencesFile` is
    /// the standard defaults' file: when it exists but cannot be read now, `UserDefaults` answers "no value" for a
    /// stored identifier, so this throws instead of replacing it (CODEX-IN03-1).
    public static func deviceId(defaults: UserDefaults, preferencesFile: URL,
                                vendorIdentifier: () -> UUID?) throws -> String? {
        if let stored = defaults.string(forKey: key) { return stored }
        if try FileProbe.exists(preferencesFile) { try FileProbe.checkReadable(preferencesFile) }
        guard let uuid = vendorIdentifier() else { return nil }
        let id = uuid.uuidString
        defaults.set(id, forKey: key)
        return id
    }

    #if canImport(UIKit)
    @MainActor
    public static func deviceId() throws -> String? {
        let file = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Preferences/\(Bundle.main.bundleIdentifier ?? "").plist")
        return try deviceId(defaults: .standard, preferencesFile: file) { UIDevice.current.identifierForVendor }
    }
    #endif
}
