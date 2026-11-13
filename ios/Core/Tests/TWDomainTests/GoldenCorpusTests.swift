import CryptoKit
import Foundation
import Testing
import TWDomain
import TWModel
import TWResources

/// Compares the Swift weather core with outputs of the Cordova client code (android/tools/corpus/generate.mjs, copied
/// by ios/tools/import_corpus.py); port of the Android `GoldenCorpusTest`. Every case in the corpus must match exactly.
struct GoldenCorpusTests {
    @Test func conversionMatchesCordova() throws {
        let names = try Corpus.conversionNames()
        #expect(names.count >= 29, "corpus has \(names.count) conversion cases")
        for name in names {
            let c = try Corpus.read("conversion/\(name)")
            let input = try c["input"] ?? Corpus.read(try #require(s(c["inputFile"])))
            let actual = try WeatherConverter.convert(input)
            let expected = c["expected"]
            if expected == nil || expected!.isNull {
                #expect(actual == nil, "\(name): Cordova returned null")
            } else {
                let a = try #require(actual, "\(name): Swift returned nil")
                expectJSON(expected, .object(a), name)
            }
        }
    }

    @Test func functionsMatchCordova() throws {
        let functions = try Corpus.read("functions.json")
        func str(_ e: JSONValue) -> String { s(e)! }

        for (args, expected) in cases(functions["shortenAddress"]) {
            #expect(sameText(AddressFormat.shorten(str(args[0])), str(expected)), "shortenAddress \(args)")
        }
        for (args, expected) in cases(functions["addressArray"]) {
            #expect(sameText(AddressFormat.split(str(args[0])), expected.arrayValue!.map(str)), "addressArray \(args)")
        }
        for (args, expected) in cases(functions["townFromAddress"]) {
            let town = AddressFormat.town(AddressFormat.split(str(args[0])))
            #expect(town == Town(str(expected["first"]!), str(expected["second"]!), str(expected["third"]!)), "townFromAddress \(args)")
        }
        for (args, expected) in cases(functions["weatherEmoji"]) {
            #expect(sameText(ForecastText.weatherEmoji(str(args[0])), str(expected)), "weatherEmoji \(args)")
        }
        for (args, expected) in cases(functions["geolocationNormalize"]) {
            let n = GeoLocation.normalize(lat: double(args[0]["lat"]), long: double(args[0]["long"]))
            #expect(n.lat == double(expected["lat"]), "lat \(args)")
            #expect(n.long == double(expected["long"]), "long \(args)")
        }
        let en = try yesterdayText("en")
        let ko = try yesterdayText("ko")
        for (args, expected) in cases(functions["diffTodayYesterday"]) {
            let text = str(args[0]) == "ko" ? ko : en
            let current = args[2]["t1h"]
            let yesterday = args[3].objectValue
            #expect(sameText(ForecastText.diffTodayYesterday(current, yesterday, fahrenheit: str(args[1]) == "F", text: text), str(expected)),
                    "diff \(args)")
        }
        for (args, expected) in cases(functions["rainSnowFall"]) {
            expectJSON(expected, ForecastText.rainSnowFall(args[0].objectValue!), "rainSnowFall \(args)")
        }
        for (args, expected) in cases(functions["rainSnowFallSymbol"]) {
            #expect(sameText(ForecastText.rainSnowFallSymbol(args[0].objectValue!), str(expected)), "symbol \(args)")
        }
        for (args, expected) in cases(functions["updateTime"]) {
            #expect(sameText(UpdateTime.of(args[0]), (expected.isNull ? nil : str(expected))), "updateTime \(args)")
        }
        for (args, expected) in cases(functions["todayPosition"]) {
            let city = try #require(try WeatherConverter.convert(Corpus.read("inputs/\(str(args[0])).json")))
            let position = ChartPosition.todayOffset(str(args[1]), bodyWidth: double(args[2]), city: city)
            #expect(abs(position - double(expected)) <= 1e-9, "todayPosition \(args)")
        }
    }

    /// units.json: each unit variant with zero, missing, sentinel and string values; hashes of canonical JSON.
    @Test func unitVariantsMatchCordova() throws {
        let units = try Corpus.read("units.json")
        let mutations = try #require(units["mutations"]?.objectValue)
        let list = try #require(units["cases"]?.arrayValue)
        #expect(list.count == 32)
        for c in list {
            let name = s(c["name"]) ?? "?"
            let data = try #require(try Corpus.read(s(c["inputFile"])!).objectValue)
            let input = mutate(data, try #require(mutations[s(c["mutation"])!]?.objectValue))
            let actual = try WeatherConverter.convert(.object(input))
            if let expected = c["expectedSha256"], !expected.isNull {
                let a = try #require(actual, "\(name): Swift returned nil")
                #expect(sameText(sha256(JSONValue.object(a).canonicalText), s(expected)), "\(name)")
            } else {
                #expect(actual == nil, "\(name)")
            }
        }
    }

    /// The generator's declarative value mutations (`applyValueMutation`).
    private func mutate(_ data: JSONObject, _ spec: JSONObject) -> JSONObject {
        func apply(_ row: JSONObject, _ spec: JSONObject) -> JSONObject {
            var r = row
            for k in (spec["keys"]?.arrayValue ?? []).compactMap(\.stringValue) {
                if spec["delete"] != nil {
                    r[k] = nil
                } else if spec["stringify"] != nil {
                    if case .number(let n)? = r[k] { r[k] = .string(Js.numberToString(n.double)) }
                } else if spec["onlyPresent"] != nil && !r.contains(k) {
                    continue
                } else {
                    r[k] = spec["set"]!
                }
            }
            if let also = spec["also"]?.objectValue { return apply(r, also) }
            return r
        }
        func mapRows(_ arr: JSONValue?) -> JSONValue? {
            guard case .array(let rows)? = arr else { return nil }
            return .array(rows.map { row in row.objectValue.map { .object(apply($0, spec)) } ?? row })
        }
        var out = data
        if case .string("KMA")? = data["source"] {
            if let current = data["current"]?.objectValue { out["current"] = .object(apply(current, spec)) }
            if let short = mapRows(data["short"]) { out["short"] = short }
            if let mid = data["midData"]?.objectValue, let days = mapRows(mid["dailyData"]) {
                out["midData"] = .object(mid.setting("dailyData", days))
            }
        } else {
            for k in ["thisTime", "hourly", "daily"] {
                if let rows = mapRows(data[k]) { out[k] = rows }
            }
        }
        return out
    }

    private func sha256(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// V09 (A01): the Cordova code applies a late response to the place selected when it completes. The native apps
    /// tie it to the requesting place (AN-06 decision, #2948 decision 2), so the iOS differences list names it.
    @Test func lateResponseIsAListedDifference() throws {
        let c = try #require(try Corpus.read("weather-info.json").arrayValue?.first)
        #expect(try Corpus.read("weather-info.json").arrayValue?.count == 1)
        #expect(int(c["requestedForIndex"]) == 0)
        #expect(int(c["appliedToIndex"]) == 1, "Cordova applies late responses to the new selection")
        let differences = try String(contentsOf: Corpus.iosDir.appendingPathComponent("tools/corpus/differences.md"), encoding: .utf8)
        #expect(differences.contains("A01"), "A01 must be listed in ios/tools/corpus/differences.md")
    }

    /// The imported Cordova catalog strings (TWResources), not copies in the test.
    private func yesterdayText(_ catalog: String) throws -> YesterdayText {
        let bundle = try #require(TWResources.strings(catalog: catalog))
        func get(_ key: String) -> String { bundle.localizedString(forKey: key, value: "<missing>", table: nil) }
        return YesterdayText(same: get("LOC_SAME_AS_YESTERDAY"), than: get("LOC_THAN_YESTERDAY"))
    }
}
