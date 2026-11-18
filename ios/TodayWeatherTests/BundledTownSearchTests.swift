import CryptoKit
import Foundation
import Testing
import TWDomain
import TWResources
@testable import TodayWeather

@MainActor
struct BundledTownSearchTests {
    private actor ReadGate {
        private(set) var reads = 0
        private(set) var readOnMain = false
        let stream: AsyncStream<TownSearch?>
        let release: AsyncStream<TownSearch?>.Continuation

        init() {
            (stream, release) = AsyncStream.makeStream()
        }

        func read(onMainThread: Bool = false) async -> TownSearch? {
            reads += 1
            readOnMain = onMainThread
            var iterator = stream.makeAsyncIterator()
            return await iterator.next() ?? nil
        }
    }

    private nonisolated static func isMainThread() -> Bool { Thread.isMainThread }

    private let match = BundledTown(first: "서울", second: "중구", third: "회현동", lat: 37.56, long: 126.98)
    private let busan = BundledTown(first: "부산", second: "", third: "", lat: 35.17, long: 129.07)

    private func wait(_ condition: () async -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(3)
        while !(await condition()) && .now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        try #require(await condition())
    }

    @Test func editsAndResetDoNotPublishStaleTownsWhileBothConsumersShareTheRead() async throws {
        let gate = ReadGate()
        defer { gate.release.finish() }
        let loader = BundledTownLoader(read: {
            let onMainThread = Self.isMainThread()
            return await gate.read(onMainThread: onMainThread)
        })
        let start = PlaceQuery(search: nil, towns: loader, scansTowns: true, keepsLastTowns: true)
        let google = TestPlaceSearch(["서울": [Prediction(fullText: "서울, 대한민국", firstMatch: 0)]])
        let saved = PlaceQuery(search: google, towns: loader, scansTowns: true, keepsLastTowns: false)
        saved.predictionDelay = .zero

        #expect(await gate.reads == 0)
        start.change("서울")
        #expect(start.word == "서울" && start.townResults == nil)
        try await wait { await gate.reads == 1 }
        start.change("부산")
        saved.change("서울")
        try await wait { saved.predictions?.word == "서울" }
        #expect(start.word == "부산" && start.townResults == nil && saved.townResults == nil)
        #expect(await gate.reads == 1)
        #expect(await !gate.readOnMain)

        saved.show(word: "서울")
        gate.release.yield(TownSearch(towns: [match, busan]))
        try await wait { start.townResults?.page.towns == [busan] }
        #expect(saved.word == "서울" && saved.townResults == nil && saved.predictions == nil)
        start.change("no match")
        #expect(start.townResults?.page.towns == [busan])
        saved.change("부산")
        #expect(saved.townResults?.page.towns == [busan])
        saved.change("no match")
        #expect(saved.townResults == nil)
        start.clear()
        #expect(start.word.isEmpty && start.townResults == nil)
        #expect(await gate.reads == 1)
    }

    @Test func googleOnlyStartDoesNotRequestTowns() async throws {
        let gate = ReadGate()
        defer { gate.release.finish() }
        let google = TestPlaceSearch(["Lon": [Prediction(fullText: "London", firstMatch: 0)]])
        let fixture = try StartFixture(location: TestLocation(system: .denied), search: google,
                                       towns: BundledTownLoader(read: { await gate.read() }))
        fixture.page.predictionDelay = .zero
        fixture.page.change(" ")
        fixture.page.change("Lon")
        try await wait { fixture.page.query.predictions?.word == "Lon" }
        #expect(google.words == ["Lon"])
        #expect(await gate.reads == 0)
    }

    @Test func failureRetriesAndAnEmptySuccessIsReused() async throws {
        let gate = ReadGate()
        defer { gate.release.finish() }
        let loader = BundledTownLoader(read: { await gate.read() })
        gate.release.yield(nil)
        #expect(await loader.load() == nil)
        #expect(loader.cached == nil)
        gate.release.yield(TownSearch(towns: []))
        #expect(await loader.load()?.towns == [])
        #expect(await loader.load()?.towns == [])
        #expect(await gate.reads == 2)
    }

    @Test func typedBundledTownsAndAllRepresentativePagesMatch() throws {
        let url = try #require(TWResources.url("data/towns.json"))
        let data = try Data(contentsOf: url)
        try #require(SHA256.hash(data: data).elementsEqual(BundledTownLoader.verifiedDigest))
        let typed = try JSONDecoder().decode([BundledTown].self, from: data)
        let old = try #require(BundledTown.list(data))
        let new = try #require(BundledTownLoader.decode(data))
        #expect(old.count == 4_206)
        #expect(typed == old)
        #expect(new == old)
        for word in ["서울", "부산", "제주", "회현동", "no match"] {
            let before = TownSearch(towns: old)
            let after = TownSearch(towns: new)
            var index = 0
            while index >= 0 {
                let page = before.search(word, from: index)
                #expect(after.search(word, from: index) == page)
                index = page.next
            }
        }
    }

    @Test(arguments: [
        #"{"first":"서울"}"#,
        #"[{"first":"서울","second":"","third":"","lat":"37.56","long":126.98}]"#,
        #"[{"first":"서울","second":"","third":"","lat":true,"long":126.98}]"#,
        #"[{"first":"서울","second":"","third":"","lat":37.56}]"#,
        #"[{"first":"서울","second":"","third":"","lat":37.56,"long":126.98,}]"#,
        #"[{"first":"서울","first":null,"second":"","third":"","lat":37.56,"long":126.98}]"#,
        #"[{"first":"서울","second":"","third":"","lat":37.56,"long":126.98,"ignored":"\uFFGG"}]"#
    ])
    func malformedDataProducesNoList(_ text: String) {
        #expect(BundledTownLoader.decode(Data(text.utf8)) == nil)
    }
}
