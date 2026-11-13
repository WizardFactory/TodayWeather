import Foundation
import Testing
import TWModel

/// The JSON tree keeps what the corpus comparison needs: member order, number texts, JavaScript's number printing.
struct JSONValueTests {
    @Test func membersKeepJavaScriptOrder() throws {
        let v = try JSONValue.parse(#"{"b":1,"a":2,"10":3,"2":4,"02":5,"b":6}"#)
        let o = try #require(v.objectValue)
        // Array-index keys first in ascending order, then the others in insertion order; a repeated name keeps its
        // first position and the last value, as JSON.parse does.
        #expect(o.keys == ["2", "10", "b", "a", "02"])
        #expect(o["b"] == 6)
        #expect(v.jsonText == #"{"2":4,"10":3,"b":6,"a":2,"02":5}"#)
        var changed = o
        changed["a"] = "x"
        changed["c"] = .null
        #expect(changed.keys == ["2", "10", "b", "a", "02", "c"], "replacing keeps the position, adding appends")
        #expect(o.removing("b").keys == ["2", "10", "a", "02"])
    }

    @Test func numbersKeepTheirText() throws {
        let v = try JSONValue.parse("[1, 1.0, -0, 1e3, 2.50, 37.5665]")
        let numbers = try #require(v.arrayValue).map { $0.numberValue! }
        #expect(numbers.map(\.text) == ["1", "1.0", "-0", "1e3", "2.50", "37.5665"])
        #expect(numbers.map(\.isInteger) == [true, false, true, false, false, false])
        #expect(numbers[0] != numbers[1], "an integer and a fractional number differ, as in the corpus comparison")
        #expect(numbers[0].double == numbers[1].double)
        #expect(numbers[3].double == 1000)
    }

    @Test func stringsAndLiterals() throws {
        let v = try JSONValue.parse(#"{"s":"a\"b\\c\né🌧\/","t":true,"f":false,"n":null,"e":[],"o":{}}"#)
        #expect(v["s"] == .string("a\"b\\c\né🌧/"))
        #expect(v["t"] == true && v["f"] == false && v["n"] == .null)
        #expect(v["missing"] == nil, "absent is undefined, not null")
        #expect(v.jsonText == #"{"s":"a\"b\\c\né🌧/","t":true,"f":false,"n":null,"e":[],"o":{}}"#)
    }

    @Test func invalidJSONThrows() {
        for text in ["", "{", "[1,]", #"{"a" 1}"#, "01", "1.", "-", "tru", #""\x""#, "[1] 2", "\"a\u{01}\""] {
            #expect(throws: JSONParseError.self, "\(text)") { try JSONValue.parse(text) }
        }
    }

    /// Number.prototype.toString() results of V8 and JavaScriptCore for the same doubles.
    @Test(arguments: [
        (0.0, "0"), (-0.0, "0"), (1.0, "1"), (-12.0, "-12"), (0.1, "0.1"), (0.1 + 0.2, "0.30000000000000004"),
        (123.456, "123.456"), (37.5665, "37.5665"), (1e21, "1e+21"), (1e20, "100000000000000000000"),
        (123456789012345680000.0, "123456789012345680000"), (1.5e300, "1.5e+300"), (1e-6, "0.000001"),
        (1e-7, "1e-7"), (1.234e-7, "1.234e-7"), (0.000001234, "0.000001234"), (5e-324, "5e-324"),
        (1.7976931348623157e308, "1.7976931348623157e+308"), (-2.5e-8, "-2.5e-8"), (9007199254740993.0, "9007199254740992"),
        (.nan, "NaN"), (.infinity, "Infinity"), (-.infinity, "-Infinity"), (228.57142857142858, "228.57142857142858"),
    ])
    func javaScriptNumberText(value: Double, text: String) {
        #expect(JSNumberFormat.string(value) == text)
        #expect(JSONNumber(value).text == text)
    }

    @Test func canonicalTextSortsKeysAndPrintsNumbersAsJavaScript() throws {
        let v = try JSONValue.parse(#"{"b":[1.50,{"z":1,"y":"\u0001"}],"a":1e2,"B":null}"#)
        #expect(v.canonicalText == #"{"B":null,"a":100,"b":[1.5,{"y":"\u0001","z":1}]}"#)
    }

    @Test func viewsKeepRawValues() throws {
        let row = WeatherPoint(json: try #require(try JSONValue.parse(#"{"t1h":-50,"pop":" 30 ","rn1":"x","reh":null,"wdd":"NE","fromToday":true}"#).objectValue))
        #expect(row.t1h == -50)
        #expect(row.pop == 30, "a number sent as a string reads as the number")
        #expect(row.raw("pop") == .string(" 30 "), "raw keeps the string")
        #expect(row.rn1 == nil && row.reh == nil && row.s06 == nil)
        #expect(row.raw("reh") == .null && row.raw("s06") == nil)
        #expect(row.fromToday == nil, "a boolean is not a number")
        #expect(row.wdd == "NE")
    }
}
