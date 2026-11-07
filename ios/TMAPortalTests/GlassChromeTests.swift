import SwiftUI
import UIKit
import XCTest
@testable import TMAPortal

/// What glass-chrome.js sends, and how the app reads it (GlassChrome.swift).
@MainActor
final class GlassChromeTests: XCTestCase {
    /// A 1×1 transparent PNG, as the page's canvas would write one.
    private let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

    private func message(icons: String = "") -> String {
        """
        {"state":{"width":402,"viewport":[0,0,1],"scrolled":true,"groups":[
          {"id":"bar","bar":true,"rect":[16,706,370,60],"radius":80,"shown":true,"opacity":1,"items":[
            {"key":"bar:dashboard","label":"Dashboard","rect":[8,4,118,52],"icon":"house@24x24","iconRect":[47,14,24,24],"active":true},
            {"key":"bar:profile","label":"Profile","rect":[244,4,118,52],"icon":"avatar@28x28c","iconRect":[45,12,28,28],"original":true,"round":true,
             "badge":{"text":"3","rect":[300,10,14,14],"background":"rgb(255, 71, 71)","foreground":"#fff"}}]},
          {"id":"trail","rect":[210,12,176,44],"radius":80,"shown":true,"inert":true,"items":[
            {"key":"trail:presence-indicator","label":"Status","rect":[0,0,44,44],"dot":{"color":"rgb(34, 197, 94)","rect":[18,18,8,8]}}]}
        ]}\(icons)}
        """
    }

    func testAPageMessageDecodesWithItsDefaults() throws {
        let decoded = try JSONDecoder().decode(GlassMessage.self, from: Data(message().utf8))
        let state = try XCTUnwrap(decoded.state)
        XCTAssertEqual(state.width, 402)
        XCTAssertTrue(state.scrolled)
        XCTAssertEqual(state.groups.map(\.id), ["bar", "trail"])

        let bar = state.groups[0]
        XCTAssertTrue(bar.bar)
        XCTAssertFalse(bar.inert)
        XCTAssertEqual(bar.rect, PageRect(x: 16, y: 706, width: 370, height: 60))
        XCTAssertEqual(bar.items.first(where: \.active)?.key, "bar:dashboard")
        XCTAssertFalse(bar.items[0].original)
        XCTAssertTrue(bar.items[1].original)
        XCTAssertTrue(bar.items[1].round)
        XCTAssertEqual(bar.items[1].badge?.text, "3")

        let trail = state.groups[1]
        XCTAssertFalse(trail.bar)
        XCTAssertTrue(trail.inert)
        XCTAssertEqual(trail.opacity, 1, "opacity defaults to fully shown")
        XCTAssertEqual(trail.items[0].dot?.color, "rgb(34, 197, 94)")
        XCTAssertEqual(state.iconIDs, ["house@24x24", "avatar@28x28c"])
    }

    func testANullStateMeansNothingToDraw() throws {
        let decoded = try JSONDecoder().decode(GlassMessage.self, from: Data(#"{"state":null}"#.utf8))
        XCTAssertNil(decoded.state)
    }

    func testPagePixelsMapToTheSafeAreasPoints() throws {
        let state = try XCTUnwrap(JSONDecoder().decode(GlassMessage.self, from: Data(message().utf8)).state)
        let map = PageMapping(state: state, size: CGSize(width: 402, height: 778))
        XCTAssertEqual(map.rect(PageRect(x: 16, y: 706, width: 370, height: 60)), CGRect(x: 16, y: 706, width: 370, height: 60))
        XCTAssertEqual(map.length(80), 80)
    }

    func testAPinchZoomShiftsAndScales() throws {
        var state = try XCTUnwrap(JSONDecoder().decode(GlassMessage.self, from: Data(message().utf8)).state)
        state.viewport = [10, 100, 2]
        let map = PageMapping(state: state, size: CGSize(width: 402, height: 778))
        XCTAssertEqual(map.rect(PageRect(x: 20, y: 110, width: 30, height: 40)), CGRect(x: 20, y: 20, width: 60, height: 80))
        XCTAssertEqual(map.local(PageRect(x: 1, y: 2, width: 3, height: 4)), CGRect(x: 2, y: 4, width: 6, height: 8))
    }

    func testCSSColoursParse() throws {
        let red = try XCTUnwrap(PageColor.rgba("rgb(255, 71, 71)"))
        XCTAssertEqual(red.r, 1)
        XCTAssertEqual(red.g, 71.0 / 255, accuracy: 0.0001)
        XCTAssertEqual(red.a, 1)
        XCTAssertEqual(PageColor.rgba("rgba(0, 0, 0, 0.5)")?.a, 0.5)
        XCTAssertEqual(PageColor.rgba("#fff")?.b, 1)
        XCTAssertEqual(PageColor.rgba("#136da0")?.g ?? 0, Double(0x6d) / 255, accuracy: 0.0001)
        XCTAssertNil(PageColor.rgba("transparent"))
        XCTAssertNil(PageColor.rgba("#12"))
    }

    func testTheCanvasPNGDecodesAtThreeTimes() throws {
        let image = try XCTUnwrap(PageImage.decode(dataURL: png))
        XCTAssertEqual(image.scale, 3)
        XCTAssertNil(PageImage.decode(dataURL: "data:image/png;base64,@@@"))
        XCTAssertNil(PageImage.decode(dataURL: "https://example.com/a.png"))
    }

    func testTheModelKeepsStateAndIconsAndAsksOnceForAMissingOne() throws {
        let chrome = GlassChrome()
        var asked = 0
        chrome.onMissingIcons = { asked += 1 }

        chrome.receive(message(icons: #","icons":{"house@24x24":"\#(png)"}"#))
        XCTAssertEqual(chrome.state?.groups.count, 2)
        XCTAssertNotNil(chrome.icons["house@24x24"])
        XCTAssertEqual(asked, 1, "the avatar never came: ask for everything again")

        chrome.receive(message())
        XCTAssertEqual(asked, 1, "asked once per missing icon, not on every message")

        chrome.receive("not json")
        XCTAssertEqual(chrome.state?.groups.count, 2, "a bad message changes nothing")

        chrome.reset()
        XCTAssertNil(chrome.state)
    }

    func testASearchBarCarriesItsMarks() throws {
        let json = """
        {"state":{"width":402,"groups":[
          {"id":"search-1","field":true,"inert":true,"rect":[24,84,354,28],"radius":16,"items":[
            {"key":"search-1","label":"Search conversations","rect":[0,0,354,28],"marks":[
              {"icon":"glass.svg@16x16","rect":[9,6,16,16],"tone":"secondary"},
              {"icon":"t1abc","rect":[29,3,292,22],"tone":"primary"},
              {"icon":"photo@20x20","rect":[330,4,20,20],"original":true}]}]}]},
         "icons":{"glass.svg@16x16":"\(png)"}}
        """
        let chrome = GlassChrome()
        var asked = 0
        chrome.onMissingIcons = { asked += 1 }
        chrome.receive(json)
        let field = try XCTUnwrap(chrome.state?.groups.first)
        XCTAssertTrue(field.field)
        XCTAssertTrue(field.inert)
        XCTAssertEqual(field.items[0].marks.map(\.tone), ["secondary", "primary", nil])
        XCTAssertEqual(field.items[0].marks.map(\.original), [false, false, true])
        XCTAssertTrue(chrome.state?.iconIDs.isSuperset(of: ["glass.svg@16x16", "t1abc", "photo@20x20"]) ?? false)
        XCTAssertEqual(asked, 1, "the two marks that never came are asked for")
    }

    func testSearchBarsAndMovesDontFadeButAppearingDoes() throws {
        func state(_ groups: String, scrolled: Bool = false) throws -> GlassChromeState {
            try XCTUnwrap(JSONDecoder().decode(GlassMessage.self, from: Data(#"{"state":{"width":402,"scrolled":\#(scrolled),"groups":[\#(groups)]}}"#.utf8)).state)
        }
        let bar = #"{"id":"bar","bar":true,"rect":[16,706,370,60],"shown":true}"#
        let moved = #"{"id":"bar","bar":true,"rect":[16,800,370,60],"shown":true}"#
        let hidden = #"{"id":"bar","bar":true,"rect":[16,706,370,60],"shown":false}"#
        let field = #"{"id":"search-1","field":true,"inert":true,"rect":[24,84,354,28]}"#
        XCTAssertEqual(try state(bar).fading, try state(moved).fading, "a move follows the page frame by frame")
        XCTAssertEqual(try state(bar).fading, try state(bar + "," + field).fading, "a search bar hands over without a fade")
        XCTAssertNotEqual(try state(bar).fading, try state(hidden).fading, "the bar going fades")
        XCTAssertNotEqual(try state(bar).fading, try state(bar, scrolled: true).fading, "the soft edge fades in")
    }

    func testATapGoesBackToThePageByKey() {
        let chrome = GlassChrome()
        var tapped: [String] = []
        chrome.onTap = { tapped.append($0) }
        chrome.tap("bar:messages")
        XCTAssertEqual(tapped, ["bar:messages"])
    }

    func testTheGlassShapeIsACapsuleFromHalfwayUp() {
        let rect = CGRect(x: 0, y: 0, width: 100, height: 40)
        XCTAssertEqual(GlassShape(radius: 20).path(in: rect), Capsule(style: .continuous).path(in: rect))
        XCTAssertEqual(GlassShape(radius: 8).path(in: rect), RoundedRectangle(cornerRadius: 8, style: .continuous).path(in: rect))
    }
}
