import UIKit
import QuartzCore

@MainActor
enum CloseoutProbe {
    private static let fileQueue = DispatchQueue(label: "fixture.closeout.records")
    static var touch: Double = 0
    static var release: Double = 0
    static func record(_ tag: String, _ value: String) {
        let line = "\(ProcessInfo.processInfo.processIdentifier),\(tag),\(CACurrentMediaTime()),\(touch),\(release),\(value)\n"
        fileQueue.async {
            let file = URL.documentsDirectory.appendingPathComponent("iphone-closeout.csv")
            if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
            guard let fp = try? FileHandle(forWritingTo: file) else { return }
            defer { try? fp.close() }
            _ = try? fp.seekToEnd()
            try? fp.write(contentsOf: Data(line.utf8))
        }
    }
}
@MainActor
final class CloseoutWindow: UIWindow {
    override func sendEvent(_ event: UIEvent) {
        if event.type == .touches, let t = event.allTouches?.first {
            CloseoutProbe.touch = t.timestamp
            if t.phase == .ended { CloseoutProbe.release = t.timestamp }
        }
        super.sendEvent(event)
    }
}
