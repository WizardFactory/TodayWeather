import Foundation

/// File checks that tell "absent" from "present but not readable now" (CODEX-IN03-1). `FileManager.fileExists`
/// answers false for a file below a directory it may not search, and `try?` reads turn a permission or
/// data-protection error into "no data"; the migration must not take either for the user having no state.
enum FileProbe {
    private static func unavailable(_ url: URL, _ code: Int32) -> CordovaSources.SourceError {
        .unavailable("\(url.path): \(String(cString: strerror(code)))")
    }

    /// True when `url` exists; false only when it (or a directory on its path) does not exist.
    static func exists(_ url: URL) throws -> Bool {
        var info = stat()
        if stat(url.path, &info) == 0 { return true }
        let code = errno
        if code == ENOENT || code == ENOTDIR { return false }
        throw unavailable(url, code)
    }

    /// True when `url` exists and is a directory.
    static func isDirectory(_ url: URL) throws -> Bool {
        var info = stat()
        if stat(url.path, &info) == 0 { return info.st_mode & S_IFMT == S_IFDIR }
        let code = errno
        if code == ENOENT || code == ENOTDIR { return false }
        throw unavailable(url, code)
    }

    /// The entries of an existing directory, sorted by name.
    static func list(_ url: URL) throws -> [URL] {
        do {
            return try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
        } catch {
            throw CordovaSources.SourceError.unavailable("\(url.path): \(error.localizedDescription)")
        }
    }

    /// The contents of an existing file.
    static func read(_ url: URL) throws -> Data {
        do {
            return try Data(contentsOf: url)
        } catch {
            throw CordovaSources.SourceError.unavailable("\(url.path): \(error.localizedDescription)")
        }
    }

    /// Throws unless an existing file can be opened for reading.
    static func checkReadable(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY)
        guard fd >= 0 else { throw unavailable(url, errno) }
        close(fd)
    }
}
