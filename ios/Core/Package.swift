// swift-tools-version:6.0
// The core of the native iOS app (#2948). TWModel and TWDomain use Foundation only, so they can be
// tested on macOS with `swift test` as well as on an iOS Simulator.
import PackageDescription

let package = Package(
    name: "Core",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TWModel", targets: ["TWModel"]),
        .library(name: "TWDomain", targets: ["TWDomain"]),
        .library(name: "TWData", targets: ["TWData"]),
        .library(name: "TWStorage", targets: ["TWStorage"]),
        .library(name: "TWResources", targets: ["TWResources"]),
    ],
    targets: [
        .target(name: "TWModel"),
        .target(name: "TWDomain", dependencies: ["TWModel"]),
        .target(name: "TWData", dependencies: ["TWModel", "TWDomain"]),
        .target(name: "TWStorage", dependencies: ["TWModel"]),
        // Images, translations, the town list and fonts copied from client/ by ios/tools/import_client_assets.py.
        // `.copy` keeps the directory tree and the bytes, so the provenance hashes hold in the built bundle.
        // The folder must not be called `Resources`: on iOS a top-level `Resources` folder makes CFBundle
        // treat the bundle as the old layout and move its resource URL into that folder.
        .target(name: "TWResources", resources: [.copy("Client")]),
        .testTarget(name: "TWResourcesTests", dependencies: ["TWResources"]),
        // The Cordova migration rules and readers, with a fixture of each storage layout.
        .testTarget(name: "TWStorageTests", dependencies: ["TWStorage"], resources: [.copy("Fixtures")]),
        .testTarget(name: "TWModelTests", dependencies: ["TWModel"]),
        // Corpus: the golden corpus copied from android/ by ios/tools/import_corpus.py (`.copy` keeps the bytes and
        // the tree). JavaScriptCore: the values where JavaScriptCore differs from the Node corpus, recorded by
        // ios/tools/corpus/compare_jsc.py; for those the iOS expectation is the JavaScriptCore output. The yesterday
        // texts come from the imported catalogs in TWResources, as the app reads them.
        .testTarget(name: "TWDomainTests", dependencies: ["TWDomain", "TWModel", "TWResources"],
                    resources: [.copy("Corpus"), .copy("JavaScriptCore")]),
    ]
)
