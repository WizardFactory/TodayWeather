import Foundation

/// The time the data layer reads and waits on: the wall clock for the ten-minute gate (`new Date()` in WeatherInfo)
/// and sleeps for the retry timers, the attempt timeouts and the refresh timer (`setTimeout`). The app uses
/// `SystemClock`; tests give a virtual clock, so no test hook or mode exists in the app.
public protocol AppClock: Sendable {
    /// The current wall-clock time.
    var now: Date { get }
    /// Returns after `duration`, or throws `CancellationError` when the task is cancelled first.
    func sleep(for duration: Duration) async throws
}

/// The system clock: `Date()` and `Task.sleep`.
public struct SystemClock: AppClock {
    public init() {}
    public var now: Date { Date() }
    public func sleep(for duration: Duration) async throws { try await Task.sleep(for: duration) }
}
