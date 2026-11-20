import Foundation
import TWDomain

// Same bytes and query for each pair. Decode stays outside the cached control's timer.
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let bytes = try Data(contentsOf: url)
let cached = TownSearch(towns: BundledTown.list(bytes)!)
struct TownFields: Decodable {
    let first: String
    let second: String
    let third: String
    let lat: Double
    let long: Double

    var town: BundledTown {
        BundledTown(first: first, second: second, third: third, lat: lat, long: long)
    }
}

func typedList(_ data: Data) throws -> [BundledTown] {
    try JSONDecoder().decode([TownFields].self, from: data).map(\.town)
}

let candidate = try typedList(bytes)
precondition(candidate == cached.towns)
let word = "서울"
let expected = cached.search(word)
let second = cached.search(word, from: expected.next)
precondition(cached.towns.count == 4206 && expected.towns.count == 10 && second.towns.count == 10)
precondition(second.towns != expected.towns && second.next > expected.next)

func sample(_ action: String, _ batch: Int, _ run: Int, _ expected: TownPage, _ perform: () -> TownPage) {
    let start = DispatchTime.now().uptimeNanoseconds
    let result = perform()
    let elapsed = DispatchTime.now().uptimeNanoseconds - start
    let valid = result == expected
    print("\(batch),\(run),\(action),\(Double(elapsed) / 1e6),\(valid)")
    precondition(valid)
}

print("batch,run,action,ms,valid")
for batch in 0...2 {
    for run in 1...(batch == 0 ? 1 : 10) {
        let actions = run.isMultiple(of: 2) ? ["typed-first", "first", "cached"] : ["cached", "first", "typed-first"]
        for action in actions {
            sample(action, batch, run, expected) {
                if action == "cached" { return cached.search(word) }
                let data = try! Data(contentsOf: url)
                let list = action == "first" ? BundledTown.list(data)! : try! typedList(data)
                return TownSearch(towns: list).search(word)
            }
        }
        sample("second-page", batch, run, second) { cached.search(word, from: expected.next) }
        sample("no-match", batch, run, TownPage(towns: [], next: -1)) { cached.search("tw3029-missing") }
    }
}
