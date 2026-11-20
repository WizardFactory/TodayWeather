import UIKit

/// Substitute for the scene window only in a disposable simulator profiling build.
/// Captures main-thread display callbacks while UIKit scroll views consume a touch.
@MainActor
final class ProfileWindow: UIWindow {
    private var link: CADisplayLink?
    private var ancestry: [UIScrollView] = []
    private var samples: [String] = []
    private let inject = ProcessInfo.processInfo.arguments.contains("-TWInjectedHitch")
    private var injected = false
    private var nextID = 0
    private var startTime = 0.0
    private var ended = false
    private var endTime = 0.0

    override func sendEvent(_ event: UIEvent) {
        if let touch = event.allTouches?.first, event.type == .touches {
            if touch.phase == .began {
                flush()
                injected = false
                if nextID == 0, let screen = windowScene?.screen {
                    let info: [String: Any] = [
                        "maximumFramesPerSecond": screen.maximumFramesPerSecond,
                        "preferredContentSizeCategory": traitCollection.preferredContentSizeCategory.rawValue,
                        "widthPoints": screen.bounds.width,
                        "heightPoints": screen.bounds.height,
                        "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
                        "thermalState": ProcessInfo.processInfo.thermalState.rawValue
                    ]
                    if let bytes = try? JSONSerialization.data(withJSONObject: info) {
                        try? bytes.write(to: URL.documentsDirectory.appendingPathComponent("device-environment.json"))
                    }
                }
                nextID += 1
                ended = false
                startTime = touch.timestamp
                var view = touch.view
                while let current = view {
                    if let scroll = current as? UIScrollView { ancestry.append(scroll) }
                    view = current.superview
                }
                if !ancestry.isEmpty {
                    let display = CADisplayLink(target: self, selector: #selector(frame(_:)))
                    display.add(to: .main, forMode: .common)
                    link = display
                }
            }
            if touch.phase == .ended || touch.phase == .cancelled {
                ended = true
                endTime = touch.timestamp
            }
        }
        super.sendEvent(event)
    }

    @objc private func frame(_ display: CADisplayLink) {
        var moving = false
        for (i, scroll) in ancestry.enumerated() where scroll.isDragging || scroll.isDecelerating {
            moving = true
            let phase = ended ? "after-release" : "drag"
            let offset = scroll.contentOffset
            samples.append("\(nextID),\(i),\(phase),\(display.timestamp),\(display.targetTimestamp),\(offset.x),\(offset.y),\(startTime)\n")
        }
        if inject && moving && ended && !injected {
            injected = true
            let before = CACurrentMediaTime()
            Thread.sleep(forTimeInterval: 0.12)
            let delay = CACurrentMediaTime() - before
            let file = URL.documentsDirectory.appendingPathComponent("injection-log.csv")
            if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
            if let handle = try? FileHandle(forWritingTo: file) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: Data("\(nextID),\(before),\(delay)\n".utf8))
            }
        }
        if ended && !moving && display.timestamp - endTime > 0.1 { flush() }
    }

    private func flush() {
        link?.invalidate()
        link = nil
        ancestry.removeAll()
        guard !samples.isEmpty else { return }
        let file = URL.documentsDirectory.appendingPathComponent("scroll-callbacks.csv")
        let bytes = Data(samples.joined().utf8)
        if !FileManager.default.fileExists(atPath: file.path) {
            FileManager.default.createFile(atPath: file.path, contents: nil)
        }
        if let handle = try? FileHandle(forWritingTo: file) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: bytes)
        }
        samples.removeAll(keepingCapacity: true)
    }
}
