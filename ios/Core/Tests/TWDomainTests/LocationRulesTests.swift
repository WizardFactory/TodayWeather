import Foundation
import Testing
import TWDomain

/// The Cordova iOS location states (IN-10, #2959): the diagnostic plugin's status for each CoreLocation authorization,
/// `Util.locationStatus` as `checkLocationMode` and the state change handler keep it, StartCtrl's attempt with its O04
/// variants and TabCtrl's lookup with O03 `forecast`, each from the iOS branches of controller.start.js,
/// controller.tabctrl.js, service.util.js and app.js.
struct LocationRulesTests {
    @Test func thePluginReportsRestrictedAndDeniedAlike() {
        #expect(LocationPermission(.notDetermined) == .notDetermined)
        #expect(LocationPermission(.restricted) == .deniedAlways)
        #expect(LocationPermission(.denied) == .deniedAlways)
        #expect(LocationPermission(.authorizedAlways) == .authorized)
        #expect(LocationPermission(.authorizedWhenInUse) == .authorizedWhenInUse)
        #expect(LocationPermission.authorizedWhenInUse.rawValue == "authorized_when_in_use")
        #expect([LocationPermission.notDetermined, .deniedAlways, .authorized, .authorizedWhenInUse].map(\.granted)
                == [false, false, true, true])
    }

    @Test func theRecordFollowsCheckLocationModeAndTheStateChanges() {
        // Location services off at the start: nothing is recorded (`Util.locationStatus` stays undefined).
        var off = LocationRecord()
        off.authorizationReported(.deniedAlways)
        off.check(servicesEnabled: false, status: .deniedAlways)
        #expect(off.status == nil)
        #expect(!off.enabled)
        // Turned on while the app runs: the status changes from denied to the grant, which is `locationOn`.
        let changed1 = off.authorizationReported(.authorizedWhenInUse)
        #expect(changed1)
        #expect(off.status == .authorizedWhenInUse)
        #expect(off.enabled)

        // On at the start, never asked: not_determined; the plugin's first report is no change.
        var fresh = LocationRecord()
        let changed2 = fresh.authorizationReported(.notDetermined)
        #expect(!changed2)
        fresh.check(servicesEnabled: true, status: .notDetermined)
        #expect(fresh.status == .notDetermined)
        // Allowed in the prompt (While Using or Once): recorded and `locationOn`.
        let changed3 = fresh.authorizationReported(.authorizedWhenInUse)
        #expect(changed3)
        #expect(fresh.status == .authorizedWhenInUse)
        // The same status again is no change; a denial is recorded without `locationOn`.
        let changed4 = fresh.authorizationReported(.authorizedWhenInUse)
        #expect(!changed4)
        let changed5 = fresh.authorizationReported(.deniedAlways)
        #expect(!changed5)
        #expect(fresh.status == .deniedAlways)
        // Allow Once expired: the next start finds not_determined again.
        fresh.check(servicesEnabled: true, status: .notDetermined)
        #expect(fresh.status == .notDetermined)

        // A return to the foreground with location services off keeps the record.
        var kept = LocationRecord(status: .authorizedWhenInUse, reported: .authorizedWhenInUse)
        kept.check(servicesEnabled: false, status: .deniedAlways)
        #expect(kept.status == .authorizedWhenInUse)
    }

    @Test func theStartPageAttemptForEachState() {
        typealias S = StartLocation
        // Granted (precise or approximate, While Using or Once): locate, recording the grant.
        #expect(S.decide(record: .authorizedWhenInUse, current: .authorizedWhenInUse) == (.locate, .authorizedWhenInUse))
        #expect(S.decide(record: .authorized, current: .authorized) == (.locate, .authorized))
        // Never asked: the prompt, the overlay hidden first, nothing recorded.
        #expect(S.decide(record: .notDetermined, current: .notDetermined) == (.ask(hideLoading: true), nil))
        // Denied or restricted: the denial, recorded.
        #expect(S.decide(record: .deniedAlways, current: .deniedAlways) == (.fail(.denied), .deniedAlways))
        // Location services off at the start (nothing recorded): iOS reports denied.
        #expect(S.decide(record: nil, current: .deniedAlways) == (.fail(.denied), .deniedAlways))
        // Nothing recorded but a grant: location services are off.
        #expect(S.decide(record: nil, current: .authorizedWhenInUse) == (.fail(.turnOn), .authorizedWhenInUse))
        // Nothing recorded and never asked: the prompt without hiding the overlay first.
        #expect(S.decide(record: nil, current: .notDetermined) == (.ask(hideLoading: false), nil))

        #expect(S.afterPrompt(.authorizedWhenInUse) == nil, "a grant runs the attempt again")
        #expect(S.afterPrompt(.authorized) == nil)
        #expect(S.afterPrompt(.deniedAlways) == .denied)
        #expect(S.afterPrompt(.notDetermined) == .denied, "a prompt that left no answer is a denial, not a hang (#2871)")
    }

    @Test func theStartPageRetryConfirmation() {
        let denied = ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"]
        // denied_always recorded: the app-info hint and Settings.
        #expect(StartLocation.retry(.denied, recorded: .deniedAlways, enabled: false)
                == RetryConfirm(lines: denied + ["LOC_OPENS_THE_APP_INFO_PAGE"], buttons: [.close, .settings, .retry]))
        // Nothing recorded (a prompt's denial on iOS records nothing): Settings, as diagnostic 7.x's undefined DENIED.
        #expect(StartLocation.retry(.denied, recorded: nil, enabled: false)
                == RetryConfirm(lines: denied, buttons: [.close, .settings, .retry]))
        // A grant recorded but location not enabled: Settings.
        #expect(StartLocation.retry(.turnOn, recorded: .authorizedWhenInUse, enabled: false).buttons == [.close, .settings, .retry])
        // A grant, enabled (no position, no address): Close and OK.
        #expect(StartLocation.retry(.notFound, recorded: .authorizedWhenInUse, enabled: true)
                == RetryConfirm(lines: ["LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION"], buttons: [.close, .retry]))
        #expect(StartLocation.retry(.noInformation, recorded: .authorizedWhenInUse, enabled: true).lines
                == ["LOC_FAIL_TO_GET_LOCATION_INFORMATION"])
        #expect([RetryButton.close, .search, .settings, .retry].map(\.key) == ["LOC_CLOSE", "LOC_SEARCH", "LOC_SETTING", "LOC_OK"])
        #expect([RetryButton.close, .search, .settings, .retry].map(\.positive) == [false, false, true, true])
    }

    @Test func theWeatherPagesLookupForEachState() {
        #expect(TabLocation.decide(record: .authorizedWhenInUse, hasSaved: true) == .locate)
        #expect(TabLocation.decide(record: .authorized, hasSaved: false) == .locate)
        #expect(TabLocation.decide(record: .notDetermined, hasSaved: true) == .ask)
        // Not enabled (denied, restricted, location services off): the saved place loads as it is; without one, the
        // request to turn location services on, which settles silently.
        #expect(TabLocation.decide(record: .deniedAlways, hasSaved: true) == .useSaved)
        #expect(TabLocation.decide(record: nil, hasSaved: true) == .useSaved)
        #expect(TabLocation.decide(record: .deniedAlways, hasSaved: false) == .requestServices)
        #expect(TabLocation.decide(record: nil, hasSaved: false) == .requestServices)
        #expect(TabLocation.afterPrompt(.authorizedWhenInUse) == nil)
        #expect(TabLocation.afterPrompt(.deniedAlways) == .promptDenied)
        #expect(LocationMessage.promptDenied.lines == ["LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY"])

        // O03 `forecast`: nothing recorded gives Search and OK; recorded but not enabled Search, Settings and OK; a
        // recorded grant Close and OK. The Android branch for denied_always does not apply on iOS.
        #expect(TabLocation.retry(.promptDenied, recorded: nil, enabled: false).buttons == [.search, .retry])
        #expect(TabLocation.retry(.notFound, recorded: nil, enabled: true).buttons == [.search, .retry])
        #expect(TabLocation.retry(.denied, recorded: .deniedAlways, enabled: false)
                == RetryConfirm(lines: ["LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED"], buttons: [.search, .settings, .retry]))
        #expect(TabLocation.retry(.notFound, recorded: .authorizedWhenInUse, enabled: true).buttons == [.close, .retry])
    }
}
