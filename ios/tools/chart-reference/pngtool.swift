// Image helper of capture.py (IN-05, #2954); compiled by capture.py with `xcrun swiftc`.
//   pngtool marker <screenshot.png>                      bounding box of the #ff00ff calibration marker
//   pngtool crop <screenshot.png> <out.png> x y w h      crop in device pixels, written as sRGB
// The screenshot is first drawn into an 8-bit sRGB bitmap (color-matched from its own profile, for example Display P3),
// so the references hold sRGB values, as the native renders are compared in sRGB.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func load(_ path: String) -> (context: CGContext, width: Int, height: Int) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("cannot read \(path)") }
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
                                  bytesPerRow: image.width * 4, space: srgb,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no context") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return (context, image.width, image.height)
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "marker":
    let (context, width, height) = load(args[2])
    let pixels = context.data!.bindMemory(to: UInt8.self, capacity: width * height * 4)
    var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1
    for y in 0..<height {
        for x in 0..<width {
            let i = (y * width + x) * 4
            if pixels[i] >= 250 && pixels[i + 1] <= 5 && pixels[i + 2] >= 250 {
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
        }
    }
    if maxX < 0 { fail("marker not found") }
    // Rows in the bitmap run top to bottom (CGContext data starts with the top row for this layout).
    print("\(minX) \(minY) \(maxX - minX + 1) \(maxY - minY + 1) \(width) \(height)")
case "crop":
    let (context, width, height) = load(args[2])
    let r = args[4...7].map { Int($0)! }
    guard r[0] >= 0, r[1] >= 0, r[0] + r[2] <= width, r[1] + r[3] <= height else { fail("crop outside the image") }
    guard let full = context.makeImage(), let cropped = full.cropping(to: CGRect(x: r[0], y: r[1], width: r[2], height: r[3])),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[3]) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("cannot crop") }
    CGImageDestinationAddImage(dest, cropped, nil)
    if !CGImageDestinationFinalize(dest) { fail("cannot write \(args[3])") }
default:
    fail("usage: pngtool marker <png> | pngtool crop <in> <out> x y w h")
}
