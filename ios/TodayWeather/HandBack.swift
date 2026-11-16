import Foundation
import TWDomain
import TWStorage

/// The rollback hand-back of the app (IN-17, #2966; ios/README.md "Rollback hand-back to a Cordova build"): the native
/// state written into the App Group suite for a fallback Cordova build (`HandBackWriter`, through `AppLaunch`'s state
/// holder), the fallback build's claim read at the start (`AppStartup.migratedState`), and the analytics choice handed
/// back at every write and checked against the suite before it applies (`HandBackConsentRecords`).
enum AppHandBack {
    /// The Cordova suite, only where the App Group container exists (a build without the entitlement has none: the
    /// migration waits there, and nothing is handed back).
    static func suite() -> UserDefaults? {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: CordovaMigration.suiteName) != nil else {
            return nil
        }
        return UserDefaults(suiteName: CordovaMigration.suiteName)
    }

    /// The app's writer; nil without the suite.
    static let writer: HandBackWriter? = suite().map { suite in
        let directory = AnalyticsConsentFiles.standardDirectory
        return HandBackWriter(suite: suite, consent: { AnalyticsConsentFiles.storedChoice(in: directory) })
    }

    /// The suite's marker text (as the plugin's `fetch` would give it), read at every start.
    static func marker() -> String? {
        suite()?.object(forKey: CordovaHandBack.marker).map(SuiteValue.from)?.text
    }
}

/// The analytics choice records with the hand-back (the Android `HandBackWriter.watchConsent` and `HandBackConsent`):
/// each write or removal of the choice hands the last saved state back at once, on the caller's thread, so a grant
/// made here is in the suite before the next start; and `beforeStart` withdraws a stored grant the suite no longer
/// confirms (`HandBackConsent`). `AppStartup` calls it before the migration, so before this process hands anything back
/// (which would write this app's choice over the fallback build's) and before the choice applies (`Monetization`).
@MainActor
final class HandBackConsentRecords: AnalyticsConsentRecords {
    /// The app's records (`UsageAnalytics` of `Monetization.shared`, and `AppStartup`).
    static let app = HandBackConsentRecords(records: AnalyticsConsentFiles.standard(), suite: AppHandBack.suite(),
                                            handBack: AppHandBack.writer)

    private let records: any AnalyticsConsentRecords
    private let suite: (any HandBackSuite)?
    private let handBack: HandBackWriter?

    init(records: any AnalyticsConsentRecords, suite: (any HandBackSuite)?, handBack: HandBackWriter?) {
        self.records = records
        self.suite = suite
        self.handBack = handBack
    }

    func readChoice() -> String? { records.readChoice() }

    func writeChoice(_ value: Bool) -> Bool {
        let written = records.writeChoice(value)
        handBack?.rewrite()
        return written
    }

    func removeChoice() -> Bool {
        let removed = records.removeChoice()
        handBack?.rewrite()
        return removed
    }

    func readCollection() -> Bool { records.readCollection() }

    func writeCollection(_ enabled: Bool) -> Bool { records.writeCollection(enabled) }

    /// Before the first hand-back of the process and before the stored choice applies (`UsageAnalytics.start`): a grant
    /// stands only while the suite says `"true"` once anything was handed over, so a withdrawal made in a fallback build
    /// holds and a grant made there is not carried over.
    func beforeStart() {
        guard records.readChoice() == "true", let suite, !HandBackConsent.grantStands(in: suite) else { return }
        _ = writeChoice(false)
    }
}
