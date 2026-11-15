import Foundation

/// Holds the events that open the app (the launch, a return to the foreground, notification taps, links) until the
/// Cordova data migration has finished, then hands them to the handler in arrival order, on the main actor. Events
/// that arrive later go to the handler at once, after those held. Port of the Android `EntryIntents`.
@MainActor
public final class EntryQueue<Event: Sendable> {
    private var held: [Event] = []
    private var handler: ((Event) -> Void)?
    private var draining = false

    public init() {}

    /// Whether `open` was called (the migration has finished).
    public var isOpen: Bool { handler != nil }

    /// An event, held until `open`, else handled now (after any event still being handed out).
    public func submit(_ event: Event) {
        held.append(event)
        drain()
    }

    /// The migration has finished: the held events go to `handler` in order, and so does every later event. A second
    /// call keeps the first handler.
    public func open(_ handler: @escaping (Event) -> Void) {
        guard self.handler == nil else { return }
        self.handler = handler
        drain()
    }

    /// Hands out the held events in order; an event submitted by the handler waits for the ones before it.
    private func drain() {
        guard let handler, !draining else { return }
        draining = true
        defer { draining = false }
        while !held.isEmpty {
            handler(held.removeFirst())
        }
    }
}
