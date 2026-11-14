import Foundation
import Testing
import TWData
import TWModel
import TWStorage

/// Records every request of its session with its body and answers 200 for `/push-list`, 404 otherwise.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var seen: [URLRequest] = []
    nonisolated(unsafe) static var bodies: [Data] = []
    static let lock = NSLock()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
        }
        Self.lock.withLock {
            Self.seen.append(request)
            Self.bodies.append(body)
        }
        let status = request.url!.path.hasSuffix("/push-list") ? 200 : 404
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Suite(.serialized)
struct HTTPPushTransportTests {
    let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }()

    /// Method, URL, headers and body as built; the body is the compact JSON text with members and numbers as kept.
    @Test func sendsTheRequestAsBuilt() async throws {
        StubProtocol.lock.withLock { StubProtocol.seen = []; StubProtocol.bodies = [] }
        let transport = HTTPPushTransport(baseURL: "http://push.test.invalid:8080/", session: session)
        let body: JSONValue = .array([.object(JSONObject([("type", "ios"), ("lat", .number(JSONNumber(text: "37.560"))),
                                                          ("name", "명동")]))])
        let status = await transport.start(PushRequest(
            method: "POST", path: "/v000903/push-list",
            headers: ["Content-Type": "application/json", "Accept-Language": "ko-KR", "Device-Id": "DEVICE"], body: body)).status
        #expect(status == 200)
        let put = await transport.start(PushRequest(method: "PUT", path: "/v000903/push",
                                                   headers: ["Content-Type": "application/json", "Device-Id": "DEVICE"],
                                                   body: .object(JSONObject([("newToken", "b"), ("oldToken", .null)])))).status
        #expect(put == 404)
        let (seen, bodies) = StubProtocol.lock.withLock { (StubProtocol.seen, StubProtocol.bodies) }
        try #require(seen.count == 2)
        #expect(seen[0].httpMethod == "POST")
        #expect(seen[0].url?.absoluteString == "http://push.test.invalid:8080/v000903/push-list")
        #expect(seen[0].value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(seen[0].value(forHTTPHeaderField: "Accept-Language") == "ko-KR")
        #expect(seen[0].value(forHTTPHeaderField: "Device-Id") == "DEVICE")
        #expect(seen[0].value(forHTTPHeaderField: "Accept") == "application/json, text/plain, */*")
        #expect(seen[0].timeoutInterval == 10)
        #expect(String(decoding: bodies[0], as: UTF8.self) == #"[{"type":"ios","lat":37.560,"name":"명동"}]"#)
        #expect(seen[1].httpMethod == "PUT")
        #expect(seen[1].url?.absoluteString == "http://push.test.invalid:8080/v000903/push")
        #expect(seen[1].value(forHTTPHeaderField: "Accept-Language") == nil)
        #expect(String(decoding: bodies[1], as: UTF8.self) == #"{"newToken":"b","oldToken":null}"#)
    }

    /// A request that cannot complete gives nil (not retried).
    @Test func anUnreachableServerGivesNil() async {
        let transport = HTTPPushTransport(baseURL: "http://127.0.0.1:9")
        let status = await transport.start(PushRequest(method: "PUT", path: "/v000903/push",
                                                      headers: ["Content-Type": "application/json"], body: .null)).status
        #expect(status == nil)
    }
}
