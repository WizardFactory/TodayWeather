import Foundation

/// Files copied from the Cordova client (`client/`) by `ios/tools/import_client_assets.py`, with their
/// provenance in `ios/provenance/client-assets.json`. The app reads only these copies, never `client/`.
///
/// Layout inside the bundle (`Client/`): `img/**` (the Cordova images, same relative paths),
/// `data/towns.json` (the bundled town list), `fonts/*.ttf` and one `<lproj>/Localizable.strings` per
/// Cordova catalog.
public enum TWResources {
    /// The Cordova catalogs (`client/www/locales/<code>.json`) and the `.lproj` each is converted to.
    /// The Cordova app registers these and falls back to English.
    public static let catalogs: [(code: String, lproj: String)] = [
        ("en", "en"), ("ko", "ko"), ("ja", "ja"), ("de", "de"), ("zh-CN", "zh-Hans"), ("zh-TW", "zh-Hant"),
    ]

    /// The bundle that holds the copies.
    public static var bundle: Bundle { .module }

    /// The `Client` directory inside ``bundle``.
    public static var root: URL {
        bundle.resourceURL!.appendingPathComponent("Client", isDirectory: true)
    }

    /// The URL of a copied file, by its path below `Client/` (for example `img/sun.png`).
    public static func url(_ relativePath: String) -> URL? {
        let url = root.appendingPathComponent(relativePath)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// The strings of one Cordova catalog, by its code (`en`, `ko`, `zh-CN`, …).
    public static func strings(catalog code: String) -> Bundle? {
        guard let lproj = catalogs.first(where: { $0.code == code })?.lproj else { return nil }
        return Bundle(url: root.appendingPathComponent("\(lproj).lproj", isDirectory: true))
    }
}
