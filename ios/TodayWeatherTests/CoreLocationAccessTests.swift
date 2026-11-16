import CoreLocation
import Foundation
import Testing
import TWDomain
@testable import TodayWeather

/// `CoreLocationAccess` with the system's authorization and the location services switch as doubles (IN-10, #2959).
@MainActor
struct CoreLocationAccessTests {
    @MainActor final class System { var status = CLAuthorizationStatus.notDetermined }

    /// The services probe of a check: each call waits until `open()`; `entered` counts the calls waiting or done.
    final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var opened = false
        private var waiting: [CheckedContinuation<Void, Never>] = []
        private var calls = 0
        var entered: Int { lock.withLock { calls } }

        func wait() async {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                let go = lock.withLock {
                    calls += 1
                    if !opened { waiting.append(c) }
                    return opened
                }
                if go { c.resume() }
            }
        }

        func open() {
            let resumed = lock.withLock {
                opened = true
                defer { waiting = [] }
                return waiting
            }
            for c in resumed { c.resume() }
        }
    }

    static func wait(_ seconds: Double = 10, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    /// CODEX-IN10-1: a `checkLocationMode` whose services check answers after the user allowed location must record
    /// the status as it is then, not the one from before the prompt; otherwise the start page asks again and again.
    @Test func aCheckThatAnswersLateKeepsTheAllowAnswer() async {
        let system = System()
        let gate = Gate()
        let access = CoreLocationAccess(systemStatus: { system.status }, servicesProbe: { await gate.wait(); return true })
        let late = Task { await access.checkNow() }
        #expect(await Self.wait { gate.entered >= 2 }, "the start's check and this one wait for the services answer")
        // The location manager reports its status once at its creation; the plugin's handler records only changes after it.
        #expect(await Self.wait { access.record.reported == .notDetermined }, "the first report")
        // The user allows location while the checks wait: the location manager reports it.
        system.status = .authorizedWhenInUse
        access.locationManagerDidChangeAuthorization(CLLocationManager())
        #expect(await Self.wait { access.recorded == .authorizedWhenInUse })
        gate.open()
        await late.value
        #expect(access.recorded == .authorizedWhenInUse, "the late check records the status as it is now")
        #expect(await access.request() == .authorizedWhenInUse)
        #expect(access.recorded == .authorizedWhenInUse)
    }
}
