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

    /// A withdrawal this run holds without a stored choice (`HandBackConsentRecords.beforeStart`).
    static let choiceOverride = ChoiceOverride()

    /// The app's writer; nil without the suite. It hands back this run's choice: the override, else the stored one.
    static let writer: HandBackWriter? = suite().map { suite in
        let directory = AnalyticsConsentFiles.standardDirectory, override = choiceOverride
        return HandBackWriter(suite: suite, consent: { override.value ?? AnalyticsConsentFiles.storedChoice(in: directory) })
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
                                            handBack: AppHandBack.writer, override: AppHandBack.choiceOverride)

    private let records: any AnalyticsConsentRecords
    private let suite: (any HandBackSuite)?
    private let handBack: HandBackWriter?
    private let override: ChoiceOverride

    /// `override` is the one `handBack` reads its choice through (`AppHandBack.choiceOverride` in the app).
    init(records: any AnalyticsConsentRecords, suite: (any HandBackSuite)?, handBack: HandBackWriter?,
         override: ChoiceOverride) {
        self.records = records
        self.suite = suite
        self.handBack = handBack
        self.override = override
    }

    func readChoice() -> String? { override.value ?? records.readChoice() }

    func writeChoice(_ value: Bool) -> Bool {
        let written = records.writeChoice(value)
        if written { override.value = nil }
        handBack?.rewrite()
        return written
    }

    func removeChoice() -> Bool {
        let removed = records.removeChoice()
        if removed { override.value = nil }
        handBack?.rewrite()
        return removed
    }

    func readCollection() -> Bool { records.readCollection() }

    func writeCollection(_ enabled: Bool) -> Bool { records.writeCollection(enabled) }

    /// Before the first hand-back of the process and before the stored choice applies (`UsageAnalytics.start`): a grant
    /// stands only while the suite says `"true"` once anything was handed over, so a withdrawal made in a fallback build
    /// holds and a grant made there is not carried over.
    /// A withdrawal that cannot be written removes the old grant, as the Android `ConsentStore.write` does, and holds for
    /// this run (`ChoiceOverride`), so collection stays off and the hand-back says `"false"`; since an absent choice means
    /// the region default (2026-11-24), the removal alone would turn collection on (CODEX-3187-5). If the withdrawal still
    /// cannot be written, the next start finds no choice and the region default applies (the accepted residual of
    /// `specs/ios-native.md`).
    ///
    /// Without a stored choice here no suite choice is adopted (`specs/analytics-default-on.md`): the suite is backed up
    /// and the choice file is not, so after a restore an old device's value could not be told apart from a fallback
    /// build's. A withdrawal made in a fallback build while this app had no stored choice is therefore not carried back
    /// (as a grant made there is not), and the region default applies: a known limitation of the rollback path.
    func beforeStart() {
        guard readChoice() == "true", let suite, !HandBackConsent.grantStands(in: suite) else { return }
        if writeChoice(false) { return }
        _ = removeChoice()
        override.value = "false"
        handBack?.rewrite()
    }
}


/// A withdrawal of the analytics choice that holds for this run only (CODEX-IN17-1): set when a withdrawal the suite asks
/// for cannot be written (2026-11-24: also when the old grant could be removed), so no grant is applied or handed back; cleared by the next
/// choice that is written or removed. Read by the hand-back writer off the main actor.
final class ChoiceOverride: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: String?

    var value: String? {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}
