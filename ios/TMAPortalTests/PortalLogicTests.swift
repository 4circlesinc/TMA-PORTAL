import XCTest
@testable import TMAPortal

final class PortalLogicTests: XCTestCase {
    func testPkceChallengeIsBase64URLSHA256() {
        let challenge = Pkce.challenge("abc")
        XCTAssertFalse(challenge.contains("+"))
        XCTAssertFalse(challenge.contains("/"))
        XCTAssertFalse(challenge.contains("="))
        XCTAssertEqual(challenge, "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0")
    }

    func testAHigherPatchIsNewer() {
        XCTAssertTrue(AppVersions.isNewer("0.1.1", than: "0.1.0"))
        XCTAssertFalse(AppVersions.isNewer("0.1.0", than: "0.1.1"))
        XCTAssertFalse(AppVersions.isNewer("0.1.0", than: "0.1.0"))
        XCTAssertTrue(AppVersions.isNewer("0.2", than: "0.1.9"))
        XCTAssertFalse(AppVersions.isNewer("0.1", than: "0.1.0"))
    }

    func testALaterReminderIsHeldUntilTheWindow() {
        XCTAssertFalse(AppVersions.shouldReoffer(declinedVersion: "0.2.0", declinedAt: 1_000, version: "0.2.0", now: 1_000 + 60_000, remindAfter: 3 * 3_600))
        XCTAssertTrue(AppVersions.shouldReoffer(declinedVersion: "0.2.0", declinedAt: 1_000, version: "0.2.0", now: 1_000 + 3 * 3_600, remindAfter: 3 * 3_600))
        XCTAssertTrue(AppVersions.shouldReoffer(declinedVersion: "0.2.0", declinedAt: 1_000, version: "0.3.0", now: 1_001, remindAfter: 3 * 3_600))
        XCTAssertTrue(AppVersions.shouldReoffer(declinedVersion: nil, declinedAt: 0, version: "0.2.0", now: 1, remindAfter: 3 * 3_600))
    }

    func testTheReleasesFeedYieldsIOSWhenPublished() {
        let body = """
        {"mac":{"available":true},"ios":{"available":true,"version":"0.2.0","url":"https://portal.example/desktop/download/ios"},"android":{"available":false}}
        """.data(using: .utf8)!
        let release = AppVersions.parseFeed(body)
        XCTAssertEqual(release?.version, "0.2.0")
        XCTAssertEqual(release?.url, "https://portal.example/desktop/download/ios")
    }

    func testTheReleasesFeedIgnoresAnUnpublishedIOSBuild() {
        let body = #"{"ios":{"available":false}}"#.data(using: .utf8)!
        XCTAssertNil(AppVersions.parseFeed(body))
    }

    func testClaimSuccessIsOnlyThePortalRoot() {
        XCTAssertEqual(SignInHandoff.pathOf("http://127.0.0.1:8001/"), "")
        XCTAssertEqual(SignInHandoff.pathOf("/"), "")
        XCTAssertEqual(SignInHandoff.pathOf("http://portal.example/auth/login"), "auth/login")
    }

    func testSignInFromTheLoginPageLeavesTheWebView() {
        let rules = NavigationRules(origin: "https://portal.tmantoinelaw.com")
        let start = URL(string: "https://portal.tmantoinelaw.com/auth/social/google/redirect")!
        let login = URL(string: "https://portal.tmantoinelaw.com/auth/login")!
        XCTAssertEqual(rules.signInProvider(for: start, current: login), "google")
        XCTAssertTrue(rules.isPortalURL(login))
        XCTAssertTrue(rules.isAuthURL(URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!))
        XCTAssertFalse(rules.isPortalURL(URL(string: "https://example.com/file")!))
    }

    func testAMailboxConnectStaysOutOfTheSignInHandoff() {
        let rules = NavigationRules(origin: "https://portal.tmantoinelaw.com")
        let connect = URL(string: "https://portal.tmantoinelaw.com/auth/social/microsoft/redirect?return=email")!
        let settings = URL(string: "https://portal.tmantoinelaw.com/settings")!
        XCTAssertNil(rules.signInProvider(for: connect, current: settings))
        XCTAssertTrue(rules.isSocialRedirect(connect))
    }
}
