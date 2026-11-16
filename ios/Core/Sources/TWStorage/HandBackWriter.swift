import Foundation
import TWModel

/// The App Group suite as the hand-back writes and reads it: `UserDefaults(suiteName: CordovaMigration.suiteName)`,
/// or a double in tests.
public protocol HandBackSuite: AnyObject {
    func object(forKey defaultName: String) -> Any?
    func set(_ value: Any?, forKey defaultName: String)
    func removeObject(forKey defaultName: String)
}

extension UserDefaults: HandBackSuite {}

/// Writes the rollback hand-back (`CordovaHandBack`, IN-17) into the suite after each state the app saved
/// (`AppStateHolder`'s `onSaved`: the first load, every change and update) and after each write of the analytics
/// choice (`rewrite`). The Android writer commits every key and the marker at once; `UserDefaults` has no multi-key
/// commit, so the writer keeps this order (`writes`), in which every prefix leaves the suite in a state the fallback
/// build either takes whole or ignores:
///
/// 1. the marker of the next generation, incomplete (`"complete":false`): from here until step 3 a fallback build keeps
///    its own WebView state (`_readHandBack` refuses the marker), and a native start does not take it for a claim;
/// 2. each owned key whose stored value differs from the state's text, set as a string or removed, in `CordovaHandBack.keys`
///    order (a key that already holds its text is not written, so most changes write one key);
/// 3. the same marker, complete.
///
/// A process that ends during steps 1–2 leaves an incomplete marker; the next start's first load writes the whole
/// hand-back again with the generation after it. Writes reach `cfprefsd` in the order they are made. Step 1 is left out
/// when no key differs, and nothing is written when the suite already holds every text under a complete native marker.
public final class HandBackWriter: @unchecked Sendable {
    /// One suite operation: `text` nil removes `key`.
    public struct Write: Equatable, Sendable {
        public let key: String
        public let text: String?

        public init(_ key: String, _ text: String?) {
            self.key = key
            self.text = text
        }
    }

    private let suite: any HandBackSuite
    private let consent: @Sendable () -> String?
    private let lock = NSLock()
    private var last: AppState?

    /// `consent` reads the stored analytics choice (`"true"`, `"false"` or nil) when a hand-back is written.
    public init(suite: any HandBackSuite, consent: @escaping @Sendable () -> String?) {
        self.suite = suite
        self.consent = consent
    }

    /// Hands `state` back (each state the app saved).
    public func write(_ state: AppState) {
        lock.lock()
        defer { lock.unlock() }
        last = state
        write(texts: CordovaHandBack.texts(state, consent: consent()))
    }

    /// Hands the last saved state back again after a write of the analytics choice; nothing before the first one.
    public func rewrite() {
        lock.lock()
        defer { lock.unlock() }
        guard let last else { return }
        write(texts: CordovaHandBack.texts(last, consent: consent()))
    }

    /// Writes `texts` in the contract's order (`writes`).
    func write(texts: [(key: String, text: String?)]) {
        for write in Self.writes(texts, stored: { suite.object(forKey: $0) }) {
            if let text = write.text { suite.set(text, forKey: write.key) } else { suite.removeObject(forKey: write.key) }
        }
    }

    /// The suite operations, in order, that hand `texts` back over the suite's current values (`stored`).
    public static func writes(_ texts: [(key: String, text: String?)], stored: (String) -> Any?) -> [Write] {
        let markerText = (stored(CordovaHandBack.marker) as? String)
        let current = CordovaHandBack.parse(markerText)
        let changed = texts.filter { !holds(stored($0.key), $0.text) }.map { Write($0.key, $0.text) }
        if changed.isEmpty, let current, current.schema == CordovaHandBack.schema, current.complete,
           JSString.equal(current.writer, CordovaHandBack.native) {
            return []
        }
        let generation = (current?.generation ?? 0) + 1
        let complete = Write(CordovaHandBack.marker, CordovaHandBack.markerText(generation: generation, writer: CordovaHandBack.native))
        if changed.isEmpty { return [complete] }
        let started = Write(CordovaHandBack.marker,
                            CordovaHandBack.markerText(generation: generation, writer: CordovaHandBack.native, complete: false))
        return [started] + changed + [complete]
    }

    /// The suite holds `text` as a string (by UTF-16 code units), or holds nothing when `text` is nil.
    static func holds(_ value: Any?, _ text: String?) -> Bool {
        guard let text else { return value == nil }
        guard let stored = value as? String else { return false }
        return JSString.equal(stored, text)
    }
}

/// The analytics choice after a rollback and a return (IN-17; the Android `HandBackConsent` of AN-17): a native grant
/// stands at the start only while the suite's choice, which every hand-back writes and a fallback Cordova build mirrors
/// from its own choices, says `"true"`. So a withdrawal made there holds, also when that build could not read the
/// hand-back and so did not claim the state, and a failed mirror there (which writes a withdrawal) withdraws. Before
/// anything was handed over (no readable marker), the grant stands; a grant made there is not carried over, as the first
/// migration carries none.
public enum HandBackConsent {
    public static func grantStands(in suite: any HandBackSuite) -> Bool {
        guard CordovaHandBack.parse(suite.object(forKey: CordovaHandBack.marker) as? String) != nil else { return true }
        return (suite.object(forKey: CordovaHandBack.consentKey) as? String) == "true"
    }
}
