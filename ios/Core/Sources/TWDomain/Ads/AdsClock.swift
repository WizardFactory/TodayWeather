import Foundation

/// A timer of `AdsClock`; cancelling it keeps its action from running.
@MainActor
public protocol AdsTimer: AnyObject {
    func cancel()
}

/// The time and the one-shot timers of the ads and analytics controllers (`Date.now()` and `setTimeout` of the
/// Cordova services). The app uses `MainClock`; tests drive a virtual clock.
@MainActor
public protocol AdsClock: AnyObject {
    /// Milliseconds on a monotonic clock.
    var nowMs: Int64 { get }
    /// Runs `action` on the main actor after `ms` milliseconds, unless the timer is cancelled first.
    func after(_ ms: Int64, _ action: @escaping @MainActor () -> Void) -> AdsTimer
}

/// `AdsClock` on the continuous clock with main-actor tasks.
@MainActor
public final class MainClock: AdsClock {
    private let origin = ContinuousClock.now

    public init() {}

    public var nowMs: Int64 {
        let elapsed = ContinuousClock.now - origin
        return elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000
    }

    public func after(_ ms: Int64, _ action: @escaping @MainActor () -> Void) -> AdsTimer {
        let timer = TaskTimer()
        timer.task = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(max(0, ms)))
            guard !Task.isCancelled else { return }
            action()
        }
        return timer
    }

    @MainActor
    private final class TaskTimer: AdsTimer {
        var task: Task<Void, Never>?

        func cancel() {
            task?.cancel()
            task = nil
        }
    }
}
