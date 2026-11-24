import Foundation
import SwiftUI
import Testing
import TWData
import TWDomain
import TWModel
import TWStorage
import UIKit
@testable import TodayWeather

/// The user-manual captures of the header search and an unsaved place (docs/user/ios-app/header-search, #3097 on the
/// #3180 scenario): the live shell of `AppLaunch` in a window over the captured Seoul responses, rendered as the screen
/// shows it, recorded as test attachments (`xcrun xcresulttool export attachments`). Each step also checks what it shows.
extension HostedShellTests {
    @MainActor
    struct HeaderSearchManualCaptureTests {
        @Test func captureTheSearchAndTheUnsavedPlace() async throws {
            let server = try PlacesFixture.server()
            let launch = AppLaunch(store: MemoryStore(),
                                   environment: .init(preferredLanguages: ["ko-KR"], photosURL: nil, version: "test",
                                                      serverURL: "https://server.test.invalid"),
                                   weatherHTTP: server, weatherCache: nil,
                                   location: { TestLocation(system: .authorizedWhenInUse) }, placeSearch: { nil })
            var state = ShellFixture.state()
            state.places[1] = PlacesFixture.seoul
            launch.migrationFinished(state)
            let shell = try #require(launch.shell)
            let size = CGSize(width: 402, height: 874)
            let insets = ShellInsets(statusBar: 54, top: 8, bottom: 34, leading: 0, trailing: 0)
            let view = ShellFrame(model: shell, insets: insets, content: { launch.tabContent($0) })
            let hosted = try HostedView(view.ignoresSafeArea(), size: size)
            defer { hosted.close() }

            func capture(_ name: String) async throws {
                try await hosted.settle(600)
                let image = UIGraphicsImageRenderer(size: size).image { _ in
                    hosted.window.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: true)
                }
                Attachment.record(try #require(image.pngData()), named: "header-search-\(name).png")
            }

            // 1. A saved place: the search button after the name, the bell and share at the right.
            try #require(await HostedShellTests.AirLiveTests.wait(10) { hosted.element("forecast-header") != nil })
            #expect(hosted.element("forecast-search") != nil && hosted.element("forecast-bell") != nil)
            try await capture("saved-place")

            // 2. The search button opens S02's search, focused; a word shows the towns.
            try hosted.tap("forecast-search")
            let places = try #require(launch.places)
            try #require(await HostedShellTests.AirLiveTests.wait(5) { shell.selected == .search && places.searching })
            places.wordChanged("부산")
            try #require(await HostedShellTests.AirLiveTests.wait(5) { hosted.element("places-town-0") != nil })
            try await capture("search")

            // 3. A town opens unsaved on Hourly: the star in the bell's position.
            places.focusChanged(false)
            try hosted.tap("places-town-0")
            await places.page.action?.value
            try #require(await HostedShellTests.AirLiveTests.wait(10) {
                shell.selected == .forecast && hosted.element("forecast-star") != nil && launch.weather?.scope != nil
            })
            #expect(launch.holder.state?.places.count == 2, "nothing saved")
            try await capture("unsaved-place")

            // 4. The star saves it: the bell returns and the short notice shows.
            try hosted.tap("forecast-star")
            try #require(await HostedShellTests.AirLiveTests.wait(5) { hosted.element("forecast-bell") != nil })
            #expect(launch.holder.state?.places.count == 3)
            #expect(shell.notice == "즐겨찾기에 추가했습니다")
            try await capture("added-place")
        }
    }
}
