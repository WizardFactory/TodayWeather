import CryptoKit
import Foundation
import TWDomain
import TWResources

/// The app's immutable town list. A screen can cancel its own result without cancelling the shared read.
@MainActor
final class BundledTownLoader {
    private let read: @Sendable () async -> TownSearch?
    private var pending: Task<TownSearch?, Never>?
    private(set) var cached: TownSearch?

    init(read: @escaping @Sendable () async -> TownSearch? = BundledTownLoader.readBundle) {
        self.read = read
    }

    func load() async -> TownSearch? {
        if let cached { return cached }
        if let pending { return await pending.value }

        let read = Task.detached(priority: .userInitiated, operation: read)
        let load = Task { [weak self] in
            let result = await read.value
            self?.cached = result
            self?.pending = nil
            return result
        }
        pending = load
        return await load.value
    }

    private nonisolated static func readBundle() -> TownSearch? {
        guard let url = TWResources.url("data/towns.json"),
              let data = try? Data(contentsOf: url),
              let towns = decode(data) else { return nil }
        return TownSearch(towns: towns)
    }

    // See ios/provenance/client-assets.json for the imported town list's SHA-256.
    private nonisolated static let verifiedDigest: [UInt8] = [
        0xd7, 0x46, 0x51, 0x49, 0xc4, 0x63, 0xfd, 0xba,
        0xcb, 0xb0, 0xa5, 0x2b, 0xad, 0x9a, 0x19, 0xcb,
        0x37, 0xa7, 0xc7, 0x56, 0x6d, 0x0d, 0x91, 0x34,
        0xf3, 0x7e, 0xef, 0x36, 0xfa, 0x51, 0xac, 0x16,
    ]

    /// Foundation accepts some malformed JSON that the strict parser rejects.
    /// Qualify the typed path against the exact shipped bytes and preserve the
    /// strict parser's behavior for any other resource content.
    nonisolated static func decode(_ data: Data) -> [BundledTown]? {
        if SHA256.hash(data: data).elementsEqual(verifiedDigest),
           let towns = try? JSONDecoder().decode([BundledTown].self, from: data) {
            return towns
        }
        return BundledTown.list(data)
    }
}
