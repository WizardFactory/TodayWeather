import Foundation
import TWDomain
import TWModel

/// A GET request that gives the body of a successful response.
public protocol HTTPGetting: Sendable {
    func get(_ url: URL) async throws -> Data
}

/// `HTTPGetting` over `URLSession`: a status of 400 or more fails, as Angular's `$http` error branch.
public struct URLSessionGet: HTTPGetting {
    public struct StatusError: Error, Equatable {
        public let status: Int

        public init(status: Int) {
            self.status = status
        }
    }

    let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func get(_ url: URL) async throws -> Data {
        let (data, response) = try await session.data(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw StatusError(status: http.statusCode)
        }
        return data
    }
}

/// An attempt that did not answer within its time (`$http` `timeout`).
public struct AttemptTimeout: Error, Equatable {}

/// `_retryGetHttp` (service.weatherutil.js): attempt `n + 1` starts `gap` after attempt `n` while no attempt has
/// answered, up to `attempts`; each attempt ends after `timeout`. The first attempt to settle, with a body or an error,
/// decides, and the others are cancelled (Cordova lets them run and ignores them). A fast failure therefore ends the
/// request without another attempt, as Cordova clears the next attempt's timer when an attempt fails. `clock` times the
/// gaps and the timeouts.
public func firstSettled<T: Sendable>(attempts: Int, gap: Duration, timeout: Duration, clock: any AppClock = SystemClock(),
                                      _ attempt: @escaping @Sendable () async throws -> T) async -> Result<T, any Error> {
    await withTaskGroup(of: Result<T, any Error>?.self) { group in
        for index in 0..<max(attempts, 1) {
            group.addTask {
                if index > 0 {
                    do { try await clock.sleep(for: gap * index) } catch { return nil }
                }
                return await withTimeout(timeout, clock: clock, attempt)
            }
        }
        var result: Result<T, any Error> = .failure(CancellationError())
        while let next = await group.next() {
            if let next {
                result = next
                break
            }
        }
        group.cancelAll()
        return result
    }
}

/// `attempt`'s result, or `AttemptTimeout` after `timeout` (the attempt is then cancelled).
func withTimeout<T: Sendable>(_ timeout: Duration, clock: any AppClock = SystemClock(),
                               _ attempt: @escaping @Sendable () async throws -> T) async -> Result<T, any Error> {
    await withTaskGroup(of: Result<T, any Error>.self) { group in
        group.addTask {
            do { return .success(try await attempt()) } catch { return .failure(error) }
        }
        group.addTask {
            do {
                try await clock.sleep(for: timeout)
                return .failure(AttemptTimeout())
            } catch {
                return .failure(error)
            }
        }
        let first = await group.next()!
        group.cancelAll()
        return first
    }
}

/// The weather photo feed of the photo theme (#2956, `loadWeatherPhotos` in service.weatherutil.js and
/// service.weatherinfo.js): loaded once per process like `window.weatherPhotos`. A load that runs is shared, not
/// repeated; after a failure the next `load()` (the app opening, a network that comes back) tries again; after a
/// success the feed is kept. Without a `url` (the private build input `TW_WEATHER_PHOTOS_URL`) nothing is requested,
/// as in Cordova builds from the template configuration (`_getHttp` rejects an empty URL). Port of the Android
/// `WeatherPhotoFeed`.
public actor WeatherPhotoFeed {
    public static let attempts = 3
    public static let attemptGap = Duration.seconds(2)
    /// `_getHttp(url, 20000)`.
    public static let timeout = Duration.seconds(20)

    private let url: URL?
    private let http: any HTTPGetting
    private let gap: Duration
    private let limit: Duration
    private var running: Task<WeatherPhotos?, Never>?

    /// The loaded feed; nil until a load succeeded.
    public private(set) var photos: WeatherPhotos?

    public init(url: URL?, http: any HTTPGetting = URLSessionGet(), gap: Duration = WeatherPhotoFeed.attemptGap,
                timeout: Duration = WeatherPhotoFeed.timeout) {
        self.url = url
        self.http = http
        self.gap = gap
        self.limit = timeout
    }

    /// The feed, loading it unless it is loaded; nil without a URL or after a failed load.
    public func load() async -> WeatherPhotos? {
        if let photos { return photos }
        guard let url else { return nil }
        let task: Task<WeatherPhotos?, Never>
        if let running {
            task = running
        } else {
            let http = self.http, gap = self.gap, limit = self.limit
            task = Task {
                let body = await firstSettled(attempts: Self.attempts, gap: gap, timeout: limit) { try await http.get(url) }
                guard case .success(let data) = body, let feed = try? JSONValue.parse(data) else { return nil }
                return WeatherPhotos.parse(feed)
            }
            running = task
        }
        let result = await task.value
        if running == task { running = nil }
        if let result { photos = result }
        return result
    }
}
