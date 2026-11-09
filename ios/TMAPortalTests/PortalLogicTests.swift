import UserNotifications
import WebKit
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

    func testTheTMToneIsTheDefaultAndAppleToneIsDefaultAlerts() {
        let tm = UNNotificationSound(named: UNNotificationSoundName("tma-chime.caf"))
        XCTAssertEqual(NotificationSound.sound(for: nil, silent: false), tm, "no choice yet: the TM tone")
        XCTAssertEqual(NotificationSound.sound(for: "chime", silent: false), tm)
        XCTAssertEqual(NotificationSound.sound(for: "something-newer", silent: false), tm)
        XCTAssertEqual(NotificationSound.sound(for: "default", silent: false), UNNotificationSound.default)
        XCTAssertNil(NotificationSound.sound(for: "chime", silent: true))
        XCTAssertNil(NotificationSound.sound(for: "none", silent: false))
    }

    private func messagePush(_ fields: [String: String]) -> [AnyHashable: Any] {
        let data = try! JSONSerialization.data(withJSONObject: fields)
        return ["kind": "notification", "msg": String(data: data, encoding: .utf8)!]
    }

    func testAMessagePushSaysWhereItOpensAndWhereARepliesGo() {
        let info = messagePush([
            "conversation": "c-1", "name": "Bruce Wayne", "group": "Tax team",
            "url": "/social/messages?conversation=c-1",
            "reply": "https://portal.tmantoinelaw.com/push/messages/c-1/7?expires=1&signature=abc",
        ])
        let message = MessageNotification(userInfo: info)
        XCTAssertEqual(message?.conversation, "c-1")
        XCTAssertEqual(message?.name, "Tax team", "a group is replied to as the group")
        XCTAssertEqual(message?.url, "/social/messages?conversation=c-1")
        XCTAssertNil(MessageNotification(userInfo: ["kind": "notification"]), "anything else is not a message")
    }

    func testAReplyPostsTheTextWithThisPhonesToken() throws {
        let message = try XCTUnwrap(MessageNotification(userInfo: messagePush([
            "conversation": "c-1", "name": "Bruce Wayne",
            "reply": "https://portal.tmantoinelaw.com/push/messages/c-1/7?expires=1&signature=abc",
        ])))
        let request = try XCTUnwrap(MessageReply.request(for: message, text: "  On my way \n", device: "tok"))
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://portal.tmantoinelaw.com/push/messages/c-1/7?expires=1&signature=abc")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String])
        XCTAssertEqual(body["body"], "On my way")
        XCTAssertEqual(body["device"], "tok")
        XCTAssertNotNil(UUID(uuidString: body["nonce"] ?? ""))

        XCTAssertNil(MessageReply.request(for: message, text: "   ", device: "tok"), "nothing typed")
        XCTAssertNil(MessageReply.request(for: message, text: "Hi", device: nil), "no token: the server would refuse it")
    }

    @MainActor
    func testTypingHasNoBarOverTheKeyboard() {
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
        WebKeyboard.plain(webView)
        XCTAssertTrue(WebKeyboard.accessoryBarHidden(in: webView), "no arrows-and-tick bar above the keyboard")
        XCTAssertEqual(webView.scrollView.keyboardDismissMode, .interactive, "dragging down puts the keyboard away")

        WebKeyboard.plain(webView)
        XCTAssertTrue(WebKeyboard.accessoryBarHidden(in: webView), "doing it twice is harmless")

        let another = WKWebView(frame: .zero)
        WebKeyboard.plain(another)
        XCTAssertTrue(WebKeyboard.accessoryBarHidden(in: another), "the class made once serves the next web view")
    }

    func testMessagesCarryAReplyBox() {
        let category = MessageReply.category
        XCTAssertEqual(category.identifier, "MESSAGE", "the category the server names in aps.category")
        XCTAssertTrue(category.actions.first is UNTextInputNotificationAction)
    }

    @MainActor
    func testEveryPageToneShipsInTheApp() {
        // The page's tones play natively (no Now Playing panel); each one the
        // page can ask for must be in the app, or it would play nothing.
        XCTAssertEqual(Set(PageTone.files.keys), ["chime", "system", "sent", "beep"])
        for (name, file) in PageTone.files {
            XCTAssertNotNil(Bundle.main.url(forResource: file, withExtension: nil), "\(name): \(file) is not in the app")
        }
        XCTAssertEqual(PageTone.files["chime"], NotificationSound.files[NotificationSound.tm], "the preview is the tone pushes play")
    }

    func testTheTMToneShipsInTheApp() {
        XCTAssertNotNil(Bundle.main.url(forResource: "tma-chime", withExtension: "caf"), "push payloads name tma-chime.caf")
    }
}
