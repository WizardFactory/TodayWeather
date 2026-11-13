/// Response and state models of the native app. Foundation only (no UIKit or SwiftUI), so the
/// domain code and its golden-corpus tests run on macOS and on iOS. IN-02 (#2951) adds the models.
public enum TWModel {
    /// The legacy server path version every request uses (#2948 decision 1).
    public static let apiVersion = "v000903"
}
