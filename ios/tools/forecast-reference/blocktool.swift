// Image helper of capture.py (IN-08, #2957); compiled by capture.py with `xcrun swiftc`.
//   blocktool marker <screenshot.png>                                  bounding box of the #ff00ff calibration marker
//   blocktool stack <out.png> <shot.png> x y w h [<shot.png> x y w h …]  crops in device pixels, stacked top to bottom
// Screenshots are first drawn into an 8-bit sRGB bitmap (color-matched from their own profile), so the references hold
// sRGB values, as the native renders are compared in sRGB (ios/tools/chart-reference/pngtool.swift does the same).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func load(_ path: String) -> (context: CGContext, width: Int, height: Int) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("cannot read \(path)") }
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
    print("\(minX) \(minY) \(maxX - minX + 1) \(maxY - minY + 1) \(width) \(height)")
case "stack":
    let pieces = Array(args.dropFirst(3))
    guard !pieces.isEmpty, pieces.count % 5 == 0 else { fail("stack: <shot> x y w h per piece") }
    var crops: [CGImage] = []
    for p in stride(from: 0, to: pieces.count, by: 5) {
        let (context, width, height) = load(pieces[p])
        let r = pieces[(p + 1)...(p + 4)].map { Int($0)! }
        guard r[0] >= 0, r[1] >= 0, r[2] > 0, r[3] > 0, r[0] + r[2] <= width, r[1] + r[3] <= height else {
            fail("crop \(r) outside \(width)x\(height)")
        }
        guard let crop = context.makeImage()?.cropping(to: CGRect(x: r[0], y: r[1], width: r[2], height: r[3])) else { fail("crop") }
        crops.append(crop)
    }
    let width = crops[0].width
    guard crops.allSatisfy({ $0.width == width }) else { fail("pieces of different widths") }
    let height = crops.reduce(0) { $0 + $1.height }
    guard let out = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: srgb,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no context") }
    var top = 0
    for crop in crops {
        // CoreGraphics' origin is at the bottom left.
        out.draw(crop, in: CGRect(x: 0, y: height - top - crop.height, width: crop.width, height: crop.height))
        top += crop.height
    }
    guard let image = out.makeImage(),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("cannot write") }
    CGImageDestinationAddImage(dest, image, nil)
    if !CGImageDestinationFinalize(dest) { fail("cannot write \(args[2])") }
default:
    fail("usage: blocktool marker <png> | blocktool stack <out> <shot> x y w h …")
}
