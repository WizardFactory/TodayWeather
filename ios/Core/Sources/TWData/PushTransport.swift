import Foundation
import TWStorage

/// Sends push API requests; returns the HTTP status, or nil when the request did not complete.
public protocol PushTransport: Sendable {
    func send(_ request: PushRequest) async -> Int?
}

/// `PushTransport` over HTTP to the legacy server at `baseURL` (the Cordova `clientConfig.serverUrl`, without the
/// path version), with the Cordova app's 10-second timeout. The body is the request's compact JSON text in UTF-8, as
/// `angular.toJson` writes it. Failures are not retried: the Cordova app does not retry either, and the list is
/// posted again on the next open.
public struct HTTPPushTransport: PushTransport {
    public let baseURL: String
    private let session: URLSession
    /// `$httpProvider.defaults.headers.common.Accept`.
    public static let accept = "application/json, text/plain, */*"

    public init(baseURL: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func send(_ request: PushRequest) async -> Int? {
        var base = baseURL
        while base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + request.path) else { return nil }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        r.httpMethod = request.method
        // Angular's `$http` default, which the Cordova requests carry next to their own headers.
        r.setValue(Self.accept, forHTTPHeaderField: "Accept")
        for (name, value) in request.headers { r.setValue(value, forHTTPHeaderField: name) }
        r.httpBody = Data(request.body.jsonText.utf8)
        do {
            let (_, response) = try await session.data(for: r)
            return (response as? HTTPURLResponse)?.statusCode
        } catch {
            return nil
        }
    }
}
