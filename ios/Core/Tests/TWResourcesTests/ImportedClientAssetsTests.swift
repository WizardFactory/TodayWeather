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
            #expect(r.commit.count == 40, "\(r.output)")
            #expect(r.source_sha256.count == 64 && r.output_sha256.count == 64, "\(r.output)")
        }
        #expect(Set(records.map(\.output)).count == records.count, "duplicate outputs")
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
