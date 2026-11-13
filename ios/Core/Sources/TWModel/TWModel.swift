/// Response and state models of the native app. Foundation only (no UIKit or SwiftUI), so the
/// domain code and its golden-corpus tests run on macOS and on iOS.
///
/// - ``JSONValue``: the JSON tree the Cordova code works on, with member order and number texts kept (IN-02, #2951).
/// - ``PlaceWeather`` and the other views: typed access to the responses the app reads (port of `Models.kt`).
public enum TWModel {
    /// The legacy server path version every request uses (#2948 decision 1).
    public static let apiVersion = "v000903"
}
