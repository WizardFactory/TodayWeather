import CoreText
import CryptoKit
import Foundation
import Testing
import TWResources

/// The copies from client/ match their provenance record, byte for byte, in the built bundle: nothing is
/// missing, changed or unlisted. The record names each file's source path, last commit and both hashes.
struct ImportedClientAssetsTests {
    struct Record: Decodable {
        let source: String
        let commit: String
        let source_sha256: String
        let output: String
        let output_sha256: String
    }

    struct Provenance: Decodable {
        let tool: String
        let files: [Record]
    }

    static let iosDir = URL(fileURLWithPath: #filePath)  // ios/Core/Tests/TWResourcesTests/<file>
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
    static let resourcesPrefix = "Core/Sources/TWResources/Client/"

    func provenance() throws -> Provenance {
        let data = try Data(contentsOf: Self.iosDir.appendingPathComponent("provenance/client-assets.json"))
        return try JSONDecoder().decode(Provenance.self, from: data)
    }

    func sha256(_ url: URL) throws -> String {
        SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
    }

    /// ASCII `0-9a-f` only, checked on UTF-8 bytes: `Character` ranges would also admit graphemes such as `1️⃣`.
    func isLowercaseHex(_ text: String, length: Int) -> Bool {
        text.utf8.count == length && text.utf8.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
    }

    func bundledFiles() -> Set<String> {
        let root = TWResources.root.standardizedFileURL
        var files = Set<String>()
        let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey])!
        for case let url as URL in walker where (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true {
            files.insert(String(url.standardizedFileURL.path.dropFirst(root.path.count + 1)))
        }
        return files
    }

    @Test func everyRecordHasACommitAndValidHashes() throws {
        let records = try provenance().files
        #expect(records.count > 300)
        for r in records {
            #expect(isLowercaseHex(r.commit, length: 40), "\(r.output)")
            #expect(isLowercaseHex(r.source_sha256, length: 64) && isLowercaseHex(r.output_sha256, length: 64), "\(r.output)")
        }
        #expect(Set(records.map(\.output)).count == records.count, "duplicate outputs")
    }

    @Test func hexCheckRejectsNonHexText() {
        #expect(isLowercaseHex(String(repeating: "0a", count: 20), length: 40))
        #expect(!isLowercaseHex(String(repeating: "x", count: 40), length: 40))
        #expect(!isLowercaseHex(String(repeating: "A", count: 40), length: 40))
        #expect(!isLowercaseHex(String(repeating: "1\u{FE0F}\u{20E3}", count: 40), length: 40))  // keycap 1️⃣
        #expect(!isLowercaseHex(String(repeating: "a", count: 39), length: 40))
    }

    @Test func bundledResourcesMatchTheRecord() throws {
        let records = try provenance().files.filter { $0.output.hasPrefix(Self.resourcesPrefix) }
        let listed = Set(records.map { String($0.output.dropFirst(Self.resourcesPrefix.count)) })
        let bundled = bundledFiles()
        #expect(listed.subtracting(bundled).sorted() == [], "listed but not bundled")
        #expect(bundled.subtracting(listed).sorted() == [], "bundled but not listed")
        for r in records {
            let rel = String(r.output.dropFirst(Self.resourcesPrefix.count))
            let url = try #require(TWResources.url(rel), "\(rel)")
            #expect(try sha256(url) == r.output_sha256, "\(rel)")
        }
    }

    @Test func filesOutsideTheBundleMatchTheRecord() throws {
        for r in try provenance().files where !r.output.hasPrefix(Self.resourcesPrefix) {
            let url = Self.iosDir.appendingPathComponent(r.output)
            #expect(try sha256(url) == r.output_sha256, "\(r.output)")
        }
    }

    @Test func everyCatalogLoadsWithTheAppName() throws {
        for (code, _) in TWResources.catalogs {
            let strings = try #require(TWResources.strings(catalog: code), "\(code)")
            let name = strings.localizedString(forKey: "LOC_TODAYWEATHER", value: "<missing>", table: nil)
            #expect(name != "<missing>" && name != "LOC_TODAYWEATHER", "\(code)")
        }
        let ko = try #require(TWResources.strings(catalog: "ko"))
        #expect(ko.localizedString(forKey: "LOC_TODAYWEATHER", value: nil, table: nil) == "오늘날씨")
        // A key that is not a valid identifier survives the conversion unchanged.
        let en = try #require(TWResources.strings(catalog: "en"))
        #expect(en.localizedString(forKey: "LOC_TODAY_THAN_YESTERDAY?", value: "<missing>", table: nil) != "<missing>")
    }

    @Test func everyCatalogIncludesTheTrackingSettingsCopy() throws {
        let keys = ["LOC_TRACKING_PERMISSION", "LOC_TRACKING_ALLOWED", "LOC_TRACKING_NOT_ALLOWED",
                    "LOC_TRACKING_NOTICE", "LOC_TRACKING_OPEN_SETTINGS"]
        for (code, _) in TWResources.catalogs {
            let strings = try #require(TWResources.strings(catalog: code))
            for key in keys {
                let text = strings.localizedString(forKey: key, value: "<missing>", table: nil)
                #expect(!text.isEmpty && text != "<missing>", "\(code) \(key)")
            }
        }
    }

    /// The native app's own texts (`ios/Support/native-strings.json`, 2026-11-24 usage analytics) are in every catalog,
    /// over the client's texts of the same keys, and the provenance names them: a re-run of the import tool keeps them.
    @Test func everyCatalogCarriesTheNativeStrings() throws {
        let native = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: Self.iosDir
            .appendingPathComponent("Support/native-strings.json"))) as? [String: [String: String]])
        #expect(Set(native.keys) == Set(TWResources.catalogs.map(\.code)))
        struct Strings: Decodable {
            let output: String
            let native_source: String?
            let native_sha256: String?
            let native_overrides: [String]?
        }
        struct Files: Decodable { let files: [Strings] }
        let records = try JSONDecoder().decode(Files.self, from: Data(contentsOf: Self.iosDir
            .appendingPathComponent("provenance/client-assets.json"))).files
        let nativeHash = try sha256(Self.iosDir.appendingPathComponent("Support/native-strings.json"))
        for (code, lproj) in TWResources.catalogs {
            let strings = try #require(TWResources.strings(catalog: code))
            for (key, text) in try #require(native[code]) {
                #expect(strings.localizedString(forKey: key, value: "<missing>", table: nil) == text, "\(code) \(key)")
            }
            let record = try #require(records.first { $0.output == "\(Self.resourcesPrefix)\(lproj).lproj/Localizable.strings" })
            #expect(record.native_source == "ios/Support/native-strings.json" && record.native_sha256 == nativeHash, "\(code)")
            // The client catalogs of de, zh-CN and zh-TW carry the consent popup in English; the native texts translate it.
            let consent = ["de", "zh-CN", "zh-TW"].contains(code) ? ["LOC_ANALYTICS_ALLOW", "LOC_ANALYTICS_DENY", "LOC_ANALYTICS_DETAIL"] : []
            #expect(record.native_overrides == (consent + ["LOC_ANALYTICS_ALLOWED", "LOC_ANALYTICS_CHOICE", "LOC_ANALYTICS_DISABLED"]).sorted(),
                    "\(code): the client keys the native texts replace")
        }
        let ko = try #require(TWResources.strings(catalog: "ko"))
        #expect(ko.localizedString(forKey: "LOC_ANALYTICS_CHOICE", value: nil, table: nil) == "이용 통계")
        #expect(ko.localizedString(forKey: "LOC_ANALYTICS_DETAIL", value: nil, table: nil).hasSuffix("별도로 처리됩니다."),
                "the client's consent text stays for the opt-in regions")
    }

    /// Both analytics popups and the row are in every app language (AK, 2026-11-24): no catalog but English shows the
    /// English text of a key, as the client's de, zh-CN and zh-TW catalogs did for the consent popup.
    @Test func theAnalyticsTextsAreTranslatedInEveryLanguage() throws {
        let keys = ["LOC_ANALYTICS_CHOICE", "LOC_ANALYTICS_ALLOWED", "LOC_ANALYTICS_DISABLED", "LOC_ANALYTICS_DETAIL",
                    "LOC_ANALYTICS_DENY", "LOC_ANALYTICS_ALLOW", "LOC_ANALYTICS_DETAIL_ON_BY_DEFAULT", "LOC_ANALYTICS_TURN_OFF",
                    "LOC_ANALYTICS_TURN_ON"]
        let en = try #require(TWResources.strings(catalog: "en"))
        for (code, _) in TWResources.catalogs where code != "en" {
            let strings = try #require(TWResources.strings(catalog: code))
            for key in keys {
                let text = strings.localizedString(forKey: key, value: "<missing>", table: nil)
                #expect(text != "<missing>" && text != en.localizedString(forKey: key, value: nil, table: nil), "\(code) \(key)")
            }
        }
    }

    @Test func townListIsAJSONList() throws {
        let url = try #require(TWResources.url("data/towns.json"))
        let towns = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [Any]
        #expect((towns?.count ?? 0) > 1000)
    }

    @Test func fontsAreUsable() throws {
        for name in ["fonts/MaterialIcons-Regular.ttf", "fonts/ionicons.ttf"] {
            let url = try #require(TWResources.url(name), "\(name)")
            let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]
            #expect((descriptors?.count ?? 0) == 1, "\(name)")
        }
    }
}
