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
        XCTAssertFalse(AppVersions.shouldReoffer(declinedVersion: "0.2.0", declinedAt: 1_000, version: "0.2.0", now: 1_000 + 60, remindAfter: 3 * 3_600))
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

    func testLocationPermissionIsReportedTheWayTheWebDoes() {
        XCTAssertEqual(LocationBridge.state(for: .authorizedWhenInUse), "granted")
        XCTAssertEqual(LocationBridge.state(for: .authorizedAlways), "granted")
        XCTAssertEqual(LocationBridge.state(for: .denied), "denied")
        XCTAssertEqual(LocationBridge.state(for: .restricted), "denied")
        XCTAssertEqual(LocationBridge.state(for: .notDetermined), "prompt")
    }

    func testALocationFixReachesThePageAsAGeolocationPosition() throws {
        let fix = LocationBridge.Fix(latitude: 18.0425, longitude: -63.0548, accuracy: 12.5, timestamp: 1_793_990_000_000)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(fix.json.utf8)) as? [String: Any])
        XCTAssertEqual(object["latitude"] as? Double, 18.0425)
        XCTAssertEqual(object["longitude"] as? Double, -63.0548)
        XCTAssertEqual(object["accuracy"] as? Double, 12.5)
        XCTAssertEqual(object["timestamp"] as? Double, 1_793_990_000_000)
        XCTAssertTrue(object["altitude"] is NSNull, "unknown values are null, as the web API has them")
        let quoted = LocationBridge.jsonString("It's \"off\"")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data("[\(quoted)]".utf8)) as? [String], ["It's \"off\""])
    }

    func testTheLegalDocumentsOpenOverTheAppNotInsteadOfIt() {
        let rules = NavigationRules(origin: "https://portal.tmantoinelaw.com")
        XCTAssertTrue(rules.isPublicDocument(URL(string: "https://portal.tmantoinelaw.com/terms-of-service/")!))
        XCTAssertTrue(rules.isPublicDocument(URL(string: "https://portal.tmantoinelaw.com/privacy-policy")!))
        XCTAssertFalse(rules.isPublicDocument(URL(string: "https://portal.tmantoinelaw.com/files/123")!))
        XCTAssertFalse(rules.isPublicDocument(URL(string: "https://portal.tmantoinelaw.com/privacy-policy-old")!))
        XCTAssertFalse(rules.isPublicDocument(URL(string: "https://evil.example/terms-of-service/")!))
    }

    func testTheSplashCoversOnlyTheFirstPage() {
        var gate = SplashGate()
        XCTAssertTrue(gate.showing)
        gate.pageReady()
        XCTAssertTrue(gate.showing, "a fast page still waits out the minimum, so the splash does not flash")
        gate.rise()
        XCTAssertFalse(gate.showing)
        // Later navigations, reloads included, never bring it back.
        gate.pageReady()
        XCTAssertFalse(gate.showing)
    }

    func testTheSplashLiftsAtTheLimitWhateverThePageIsDoing() {
        var gate = SplashGate()
        gate.rise()
        XCTAssertTrue(gate.showing, "still waiting on the first page")
        gate.timedOut()
        XCTAssertFalse(gate.showing)
        XCTAssertLessThanOrEqual(SplashGate.limit, 10)
    }

    func testAppleIsAnsweredByTheNativeSheetFromAnyPage() {
        let rules = NavigationRules(origin: "https://portal.tmantoinelaw.com")
        let signIn = URL(string: "https://portal.tmantoinelaw.com/auth/social/apple/redirect")!
        let connect = URL(string: "https://portal.tmantoinelaw.com/auth/social/apple/redirect?sync_all=0")!
        let invite = URL(string: "https://portal.tmantoinelaw.com/auth/social/apple/redirect?invite=abc123")!
        XCTAssertTrue(rules.isAppleSignIn(signIn))
        XCTAssertTrue(rules.isAppleSignIn(connect))
        XCTAssertFalse(rules.isAppleSignIn(URL(string: "https://portal.tmantoinelaw.com/auth/social/google/redirect")!))
        XCTAssertFalse(rules.isAppleSignIn(URL(string: "https://evil.example/auth/social/apple/redirect")!))
        XCTAssertEqual(rules.inviteToken(in: invite), "abc123")
        XCTAssertNil(rules.inviteToken(in: signIn))
        XCTAssertTrue(rules.isAuthURL(URL(string: "https://appleid.apple.com/auth/authorize")!))
    }

    func testAMailboxConnectStaysOutOfTheSignInHandoff() {
        let rules = NavigationRules(origin: "https://portal.tmantoinelaw.com")
        let connect = URL(string: "https://portal.tmantoinelaw.com/auth/social/microsoft/redirect?return=email")!
        let settings = URL(string: "https://portal.tmantoinelaw.com/settings")!
        XCTAssertNil(rules.signInProvider(for: connect, current: settings))
        XCTAssertTrue(rules.isSocialRedirect(connect))
    }
}
