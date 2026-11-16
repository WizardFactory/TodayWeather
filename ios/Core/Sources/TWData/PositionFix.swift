import Foundation
import TWStorage

/// What the location manager delivers while the app waits for a position.
public enum PositionEvent: Sendable, Equatable {
    /// A fix and the time it was taken (`CLLocation.timestamp`).
    case fix(Location, at: Date)
    /// A location error (`locationManager(_:didFailWithError:)`).
    case failed
}

/// `WeatherUtil.getCurrentPosition` on iOS (#2959): `watchPosition` with `{timeout: 60000, maximumAge: 60000,
/// enableHighAccuracy: true}`, cleared at the first position. The first fix taken at most `maximumAge` before now counts;
/// an older one (CoreLocation delivers its last known fix first) is passed over, as the option asks, and the wait goes
/// on. A location error ends it without a position, as the geolocation plugin reported every error of a running watch;
/// so does `timeout` without an acceptable fix.
public enum PositionFix {
    public static let maximumAge = Duration.seconds(60)
    public static let timeout = Duration.seconds(60)

    /// Whether a fix taken `at` is recent enough at `now`.
    public static func accepts(_ at: Date, now: Date, maximumAge: Duration = maximumAge) -> Bool {
        let age = now.timeIntervalSince(at)
        let limit = Double(maximumAge.components.seconds) + Double(maximumAge.components.attoseconds) / 1e18
        return age <= limit
    }

    /// The first acceptable fix of `events`, or nil.
    public static func first(_ events: AsyncStream<PositionEvent>, clock: any AppClock = SystemClock(),
                             maximumAge: Duration = maximumAge, timeout: Duration = timeout) async -> Location? {
        await withTaskGroup(of: Location??.self) { group in
            group.addTask {
                for await event in events {
                    switch event {
                    case .fix(let location, let at):
                        if accepts(at, now: clock.now, maximumAge: maximumAge) { return .some(location) }
                    case .failed:
                        return .some(nil)
                    }
                }
                return .some(nil)
            }
            group.addTask {
                do { try await clock.sleep(for: timeout) } catch { return nil }
                return .some(nil)
            }
            var result: Location?
            while let next = await group.next() {
                if let settled = next {
                    result = settled
                    break
                }
            }
            group.cancelAll()
            return result
        }
    }
}
