import Foundation
import Testing

/// The parity checklist (`ios/parity.md`, AC1 of #2967) stays complete and resolvable, as the Android
/// `ParityChecklistTest` (AN-18) keeps `android/parity.md`: every screen, dialog, app-wide element and iOS-only branch
/// has its row; a row gives native evidence, or is marked not built; its links and anchors resolve; and every test it
/// names exists. The checklist and the test sources are read from the repository's `ios/` directory. Links into
/// `client/`, `android/`, `tw.ios/`, `ta.ios/` and `applewatch/` are not followed: the iOS tests never read those
/// directories (CI runs them without).
struct ParityChecklistTests {
    static let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    static let checklist = ios.appendingPathComponent("parity.md")
    static let excluded = ["client/", "android/", "tw.ios/", "ta.ios/", "applewatch/"]
    /// Test targets, which the checklist names as places, not suites.
    static let targets: Set<String> = ["TodayWeatherTests", "TodayWeatherUITests", "TWDataTests", "TWDomainTests",
                                       "TWStorageTests", "TWModelTests", "TWResourcesTests"]

    static func text() throws -> String { try String(contentsOf: checklist, encoding: .utf8) }

    /// The table rows (not headers or rules), as their cells.
    static func rows() throws -> [[String]] {
        try text().split(separator: "\n").map(String.init)
            .filter { $0.hasPrefix("| ") && !$0.hasPrefix("| ---") && !$0.hasPrefix("| ID |") }
            .map { line in
                var trimmed = line.trimmingCharacters(in: .whitespaces)
                trimmed.removeFirst()
                if trimmed.hasSuffix("|") { trimmed.removeLast() }
                return trimmed.components(separatedBy: " | ").map { $0.trimmingCharacters(in: .whitespaces) }
            }
    }

    @Test func everyScreenDialogElementAndBranchHasARowThatSaysWhereItsEvidenceIs() throws {
        let rows = try Self.rows()
        let expected = (1...16).map { String(format: "S%02d", $0) } + (1...19).map { String(format: "O%02d", $0) }
            + (1...11).map { "X\($0)" } + (1...12).map { "I\($0)" }
        #expect(rows.map { $0[0] }.sorted() == expected.sorted())
        for row in rows {
            #expect(row.count == 6, "\(row[0]): ID, what, Cordova reference, native evidence, accepted differences, status")
            guard row.count == 6 else { continue }
            let (id, evidence, status) = (row[0], row[3], row[5])
            let built = status != "Not built"
            #expect(status == "Covered" || status.hasPrefix("Covered; part 2 adds") || status.hasPrefix("Covered (") || !built,
                    "\(id): status '\(status)'")
            if built {
                #expect(!evidence.isEmpty && !evidence.hasPrefix("None"), "\(id): no native evidence")
            } else {
                #expect(evidence.hasPrefix("None"), "\(id): not built, so no evidence")
            }
        }
    }

    @Test func everyLinkResolves() throws {
        let text = try Self.text()
        let links = text.matches(of: /\[[^\]]*\]\(([^)\s]+)\)/).map { String($0.1) }.filter { !$0.hasPrefix("http") }
        #expect(links.count > 50, "the checklist links its references")
        var broken: [String] = []
        let root = Self.ios.deletingLastPathComponent().standardizedFileURL.path + "/"
        for target in links {
            let parts = target.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            let path = parts[0], anchor = parts.count > 1 ? parts[1] : nil
            let file = path.isEmpty ? Self.checklist : Self.ios.appendingPathComponent(path).standardizedFileURL
            let relative = file.path.hasPrefix(root) ? String(file.path.dropFirst(root.count)) : file.path
            if Self.excluded.contains(where: relative.hasPrefix) { continue }
            var directory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: file.path, isDirectory: &directory) else {
                broken.append(target)
                continue
            }
            if let anchor, !directory.boolValue, !(try Self.anchors(file)).contains(anchor) { broken.append(target) }
        }
        #expect(broken == [])
    }

    @Test func everyNamedTestExists() throws {
        let sources = Self.testSources()
        // The suites each file declares, and their test functions.
        var files: [String: [String]] = [:]
        for (_, code) in sources {
            for m in code.matches(of: /(?m)^\s*(?:@[A-Za-z]+(?:\([^)]*\))?\s+)*(?:final\s+)?(?:struct|class)\s+([A-Za-z0-9_]+(?:Tests|UITests))\b/) {
                files[String(m.1), default: []].append(code)
            }
        }
        var missing: [String] = []
        var named = 0
        for line in try Self.text().split(separator: "\n") {
            for token in String(line).matches(of: /`([^`]+)`/).map({ String($0.1) }) {
                guard let m = token.wholeMatch(of: /([A-Za-z0-9_]+Tests)(?:\.([A-Za-z0-9_]+))?/),
                      !Self.targets.contains(String(m.1)) else { continue }
                named += 1
                let suite = String(m.1)
                guard let codes = files[suite] else {
                    missing.append(suite)
                    continue
                }
                if let method = m.2.map(String.init),
                   !codes.contains(where: { $0.contains("func \(method)(") }) {
                    missing.append("\(suite).\(method)")
                }
            }
        }
        #expect(named > 150, "the checklist names its tests: \(named)")
        #expect(missing == [])
    }

    /// The Swift test sources of the app-hosted, UI and package tests.
    static func testSources() -> [(String, String)] {
        var out: [(String, String)] = []
        for root in ["TodayWeatherTests", "TodayWeatherUITests", "Core/Tests"] {
            guard let walker = FileManager.default.enumerator(at: ios.appendingPathComponent(root), includingPropertiesForKeys: nil)
            else { continue }
            for case let file as URL in walker where file.pathExtension == "swift" {
                out.append((file.path, (try? String(contentsOf: file, encoding: .utf8)) ?? ""))
            }
        }
        return out
    }

    /// The anchors GitHub gives the headings of `file`: lower case, punctuation dropped, spaces as hyphens, repeats
    /// numbered.
    static func anchors(_ file: URL) throws -> Set<String> {
        var seen: [String: Int] = [:]
        var out = Set<String>()
        for line in try String(contentsOf: file, encoding: .utf8).split(separator: "\n") {
            guard let m = String(line).wholeMatch(of: /#{1,6}\s+(.*?)\s*/) else { continue }
            let slug = String(String(m.1).lowercased().unicodeScalars.filter { scalar in
                scalar == " " || scalar == "-" || scalar == "_" || CharacterSet.letters.contains(scalar)
                    || CharacterSet.decimalDigits.contains(scalar) || CharacterSet.nonBaseCharacters.contains(scalar)
            }.map(Character.init)).replacingOccurrences(of: " ", with: "-")
            let n = seen[slug, default: 0]
            seen[slug] = n + 1
            out.insert(n == 0 ? slug : "\(slug)-\(n)")
        }
        return out
    }
}
