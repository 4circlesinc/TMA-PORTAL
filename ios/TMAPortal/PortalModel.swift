import AuthenticationServices
import CryptoKit
import Intents
import Network
import SafariServices
import UIKit
import UserNotifications
import WebKit

struct PortalNotice: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

struct PortalUpdate: Identifiable {
    let id = UUID()
    let version: String
    let url: URL
}

enum AppBridge {
    static weak var model: PortalModel?
    static var token: String?
}

/// The window. One WKWebView over the portal origin, plus the things a browser
/// tab cannot do: the sign-in handoff, an offline boot, notifications, calls,
/// downloads, and deep links. The page is the portal's own front end.
@MainActor
final class PortalModel: NSObject, ObservableObject {
    let webView: WKWebView
    let calls = CallCoordinator()
    /// Location for the page through iOS's own permission, asked once (LocationBridge.swift).
    let location = LocationBridge()
    /// The bottom bar and the header's bubbles, drawn in Liquid Glass (GlassChrome.swift).
    let glass = GlassChrome()
    private let rules: NavigationRules
    private let shell: ShellCache
    /// Documents kept on the phone for offline (FileStore.swift).
    private let files: FileStore
    private let bridge = ScriptBridge()
    private let monitor = NWPathMonitor()
    private var online = true
    private var quietLoad = false
    private var servedFromShell = false
    /// The document on screen came from the kept shell (a launch, or a page
    /// the system took away), not from a navigation.
    private var instantDocument = false
    /// The app's own offline or error page is up, not the portal. Only then
    /// does a connection coming back reload anything.
    private var showingStandIn = false
    /// A portal link waiting for the page to be ready (a notification tapped
    /// while the app was starting): opened in place once it is.
    private var pendingPath: String?
    private var pageIsReady = false
    private var splash = SplashGate()
    private var callInfo: String?
    private var authSession: ASWebAuthenticationSession?
    private var pendingBrowserURL: URL?
    private var pendingCallJS: String?
    private var notificationsGranted = false
    private var offeringUpdate = false
    private var checkingUpdate = false
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]
    private var appleNonce: String?
    private var appleInvite: String?
    private var appleRequest: ASAuthorizationController?

    @Published var loading = true
    @Published var showSplash = true
    @Published var dark = false
    @Published var notice: PortalNotice?
    @Published var updateOffer: PortalUpdate?

    private static let checkInterval: TimeInterval = 60 * 60
    private static let remindAfter: TimeInterval = 3 * 60 * 60

    override init() {
        let rules = NavigationRules(origin: PortalConfig.origin)
        self.rules = rules
        shell = ShellCache(origin: PortalConfig.origin)
        files = FileStore(origin: PortalConfig.origin)

        let content = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = content
        // A document kept on the phone, read by its path when nothing answers
        // for it (TMADesktop.readKeptFile, offline-fetch.js).
        content.addScriptMessageHandler(files, contentWorld: .page, name: FileStore.handlerName)
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = UIDevice.current.userInterfaceIdiom == .pad ? .desktop : .mobile
        let webView = WKWebView(frame: .zero, configuration: config)
        self.webView = webView
        super.init()

        bridge.model = self
        calls.model = self
        location.evaluate = { [weak self] js in self?.evaluate(js) }
        location.permissionChanged = { [weak self] in self?.reinstallScripts() }
        // A tap on the glass clicks the page's own button.
        glass.onTap = { [weak self] key in
            self?.evaluate("window.__tmaGlassChrome && __tmaGlassChrome.tap(\(jsString(key)))")
        }
        glass.onMissingIcons = { [weak self] in
            self?.evaluate("window.__tmaGlassChrome && __tmaGlassChrome.resend()")
        }
        AppBridge.model = self
        content.add(bridge, name: "tmaHost")
        installScripts(in: content)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.customUserAgent = PortalConfig.userAgent
        // A drag from the left edge is back only while the page has a screen
        // open inside it (a Settings page, an option list), each a history
        // entry (phone-screens.js); on a page of its own the drag opens the
        // menu. The page switches this through setEdgeBack ("edgeBack").
        webView.allowsBackForwardNavigationGestures = false
        // Typing as in an app: no arrows-and-tick bar over the keyboard, and
        // dragging the page down puts the keyboard away (WebKeyboard.swift).
        WebKeyboard.plain(webView)
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x13 / 255, green: 0x6D / 255, blue: 0xA0 / 255, alpha: 1)
        if #available(iOS 16.4, *) {
            #if DEBUG
            webView.isInspectable = true
            #endif
        }

        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.setOnline(satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "tma.connectivity"))

        Task { await shell.refreshBuild() }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(SplashGate.minimum * 1_000_000_000))
            splash.rise()
            refreshSplash()
        }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(SplashGate.limit * 1_000_000_000))
            splash.timedOut()
            refreshSplash()
        }
        refreshNotificationPermission()
        bootPortal()
    }

    /**
     The first page: from the phone, the way an installed app opens.

     The kept shell and its bundles paint the portal at once, and the page
     then fetches only data. The one thing worth asking the network first is
     whether the portal has deployed since that copy was kept, and that is
     asked for at most 0.4 s, inside the splash's own minimum. A deploy that
     moved, no session, or a copy missing a file: the network, as before.
     */
    private func bootPortal() {
        guard let url = URL(string: PortalConfig.url("/")) else { return }
        Task {
            let hasSession = self.sessionCookie(in: await self.cookies()) != nil
            if self.online, hasSession, self.shell.canBootInstantly {
                let kept = self.shell.keptBuild
                let remote = await self.briefBuildCheck()
                if remote == nil || remote == kept, self.openFromShell(url, anyRoute: false) {
                    return
                }
            }
            self.load(url)
        }
    }

    /// The deploy's name if the portal answers within 0.4 s, nil otherwise.
    private func briefBuildCheck() async -> String? {
        final class Once { var done = false }
        let once = Once()
        return await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            let finish: (String?) -> Void = { value in
                if once.done { return }
                once.done = true
                cont.resume(returning: value)
            }
            Task { @MainActor in finish(await self.shell.refreshBuild(timeout: 3)) }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 400_000_000)
                finish(nil)
            }
        }
    }

    /// Paint the kept shell for `url` with nothing from the network. False when
    /// it cannot (no session cookie is checked here; callers do).
    @discardableResult
    private func openFromShell(_ url: URL, anyRoute: Bool) -> Bool {
        let path = url.path.isEmpty ? "/" : url.path
        guard let html = shell.instant(path: path, hasSession: true, anyRoute: anyRoute) else { return false }
        servedFromShell = true
        instantDocument = true
        showingStandIn = false
        quietLoad = true
        webView.loadHTMLString(html, baseURL: url)
        return true
    }

    /// One of the app's own pages (offline, or a load error) instead of the portal.
    private func showStandIn(_ html: String, baseURL: URL?) {
        quietLoad = true
        showingStandIn = true
        instantDocument = false
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    func goBack() {
        if webView.canGoBack { webView.goBack() }
    }

    func loadPortal(_ path: String = "/") {
        guard let url = URL(string: PortalConfig.url(path)) else { return }
        load(url)
    }

    func load(_ url: URL) {
        if !online, rules.isPortalURL(url) {
            Task { await self.loadOfflineIfPossible(url) }
            return
        }
        quietLoad = false
        showingStandIn = false
        instantDocument = false
        pageIsReady = false
        webView.load(URLRequest(url: url))
    }

    func handleOpenURL(_ url: URL) {
        if url.scheme == "tmaportal", url.host == "auth" {
            let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "token" }?.value ?? ""
            guard token.count == 64 else { return }
            Task { await self.finishClaim(token) }
            return
        }
        if url.scheme == "https" || url.scheme == "http" {
            load(url)
        }
    }

    func becameActive() {
        checkForUpdate()
    }

    func sceneInactive() {
        calls.leftForeground()
    }

    func runCallScript(_ script: String) {
        pendingCallJS = script
        evaluate(script)
    }

    func notificationResponse(_ response: UNNotificationResponse) {
        let action = response.actionIdentifier
        if action == "ANSWER" {
            runCallScript("window.TMAMessagingCalls && TMAMessagingCalls.accept(true)")
            return
        }
        if action == "DECLINE" {
            runCallScript("window.TMAMessagingCalls && TMAMessagingCalls.decline()")
            return
        }
        let info = response.notification.request.content.userInfo
        // A message notification opens its conversation.
        if let message = MessageNotification(userInfo: info), let path = message.url, !path.isEmpty {
            openPortalPath(path)
            return
        }
        let id = intValue(info["id"])
        let url = info["url"] as? String ?? ""
        guard id > 0 else { return }
        evaluate("!!(window.__tmaNotificationClick && __tmaNotificationClick(\(id)))") { [weak self] result in
            guard let self, result != "true", !url.isEmpty else { return }
            guard let target = URL(string: url.hasPrefix("http") ? url : PortalConfig.url(url)) else { return }
            self.load(target)
        }
    }

    /// A portal link from outside the page (a notification): in place when the
    /// portal is up, so nothing reloads; loaded when it is not yet.
    private func openPortalPath(_ path: String, attempt: Int = 0) {
        // Tapped while the app was still opening: loading the link now would
        // throw away the page painting from the phone and fetch it all again.
        // It waits for the page instead, and opens in place.
        if !pageIsReady, attempt == 0 {
            pendingPath = path
            return
        }
        let quoted = (try? JSONSerialization.data(withJSONObject: [path])).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        evaluate("(function(u){var r=document.querySelector('.tma-dash');if(r&&r._portalNavigate){r._portalNavigate(u);return true}return false})(\(quoted)[0])") { [weak self] result in
            guard let self, result != "true" else { return }
            // The router may not be up yet a moment after the document is.
            if attempt < 8, self.webView.url.map({ self.rules.isPortalURL($0) }) == true {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.openPortalPath(path, attempt: attempt + 1) }
                return
            }
            guard let target = URL(string: path.hasPrefix("http") ? path : PortalConfig.url(path)) else { return }
            self.load(target)
        }
    }

    /// The page is up: open the link that was waiting for it.
    private func pageBecameReady() {
        guard !pageIsReady else { return }
        pageIsReady = true
        if let path = pendingPath {
            pendingPath = nil
            openPortalPath(path, attempt: 1)
        }
    }

    func remotePush(_ userInfo: [AnyHashable: Any]) {
        guard (userInfo["kind"] as? String) == "call" else { return }
        calls.reportFromPush(signalJSON: userInfo["signal"] as? String)
    }

    func pushTokenArrived(_ token: String) {
        AppBridge.token = token
        Task { await self.registerPush(token: token) }
    }

    func deferUpdate() {
        guard let offer = updateOffer else { return }
        let defaults = UserDefaults.standard
        defaults.set(offer.version, forKey: "updates.declined")
        defaults.set(Date().timeIntervalSince1970, forKey: "updates.declinedAt")
        updateOffer = nil
        offeringUpdate = false
    }

    func openUpdate() {
        guard let offer = updateOffer else { return }
        updateOffer = nil
        offeringUpdate = false
        UIApplication.shared.open(offer.url)
    }

    // MARK: - page bridge

    fileprivate func handleScript(_ body: Any) {
        guard let dict = body as? [String: Any], let op = dict["op"] as? String else { return }
        switch op {
        case "relay":
            relay(dict["channel"] as? String ?? "", value: "\(dict["value"] ?? "")")
        case "keepFiles":
            keepFiles(call: dict["call"] as? String ?? "", list: dict["files"] as? [[String: Any]] ?? [])
        case "clearFiles":
            files.clear()
        case "notify":
            if let json = dict["json"] as? String { showPageNotification(json) }
        case "tone":
            PageTone.play(dict["name"] as? String ?? "")
        case "edgeBack":
            // The back swipe while a screen is open; the menu's drag otherwise.
            setEdgeBack((dict["on"] as? Bool) == true)
        case "haptic":
            let style: UIImpactFeedbackGenerator.FeedbackStyle = (dict["style"] as? String) == "medium" ? .medium : .light
            UIImpactFeedbackGenerator(style: style).impactOccurred()
        case "glass":
            // What the bar and the header's bubbles hold (glass-chrome.js).
            if let json = dict["json"] as? String { glass.receive(json) }
        case "closeNotification":
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["page-\(intValue(dict["id"]))"])
        case "openInBrowser":
            if let raw = dict["url"] as? String { openOutside(raw) }
        case "openLocationSettings":
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        case "requestNotifications":
            requestNotifications()
        case "geoGet", "geoWatch":
            location.request(LocationBridge.Request(
                id: intValue(dict["id"]),
                highAccuracy: (dict["highAccuracy"] as? Bool) ?? false,
                timeout: (dict["timeout"] as? NSNumber)?.doubleValue ?? 0,
                maximumAge: (dict["maximumAge"] as? NSNumber)?.doubleValue ?? 0,
                watch: op == "geoWatch"
            ))
        case "geoClear":
            location.clear(id: intValue(dict["id"]))
        case "ready":
            // DOMContentLoaded: the page's content is there, even if images
            // are still arriving. Enough to lift the boot splash.
            splash.pageReady()
            refreshSplash()
            pageBecameReady()
        default:
            break
        }
    }

    private func relay(_ channel: String, value: String) {
        switch channel {
        case "badge":
            UIApplication.shared.applicationIconBadgeNumber = Int(value) ?? 0
        case "call-info":
            callInfo = value.isEmpty ? nil : value
        case "call":
            calls.update(phase: value, infoJSON: callInfo)
            if value.isEmpty { callInfo = nil }
        case "theme":
            dark = value == "dark"
        case "signin-reopen":
            if let pendingBrowserURL { UIApplication.shared.open(pendingBrowserURL) }
        case "signin-cancel":
            authSession?.cancel()
            authSession = nil
            SignInHandoff.cancel()
            pendingBrowserURL = nil
            loadPortal("/auth/login")
        default:
            break
        }
    }

    // MARK: - sign-in

    private func startBrowserSignIn(provider: String?) {
        guard let url = SignInHandoff.startURL(provider: provider) else { return }
        pendingBrowserURL = url
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "tmaportal") { [weak self] callback, _ in
            Task { @MainActor in
                guard let self, let callback,
                      let token = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "token" })?.value,
                      token.count == 64 else { return }
                await self.finishClaim(token)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() {
            UIApplication.shared.open(url)
        }
        showSignInWaiting(provider: provider)
    }

    // MARK: - Sign in with Apple

    /// The system's Sign in with Apple sheet (Face ID), not Apple's web page.
    /// Apple signs the SHA-256 of a nonce into the token; the server checks it
    /// against the nonce posted alongside, so a token from elsewhere is refused.
    private func startAppleSignIn(invite: String?) {
        let nonce = Pkce.verifier()
        appleNonce = nonce
        appleInvite = invite
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        appleRequest = controller
        controller.performRequests()
    }

    /// Posted from inside the page with its own XSRF cookie, so the session
    /// cookie the server sets lands in this web view. The server answers with
    /// where to go next (the portal, a two-factor step, or the sign-in page
    /// with the reason) and the page goes there.
    fileprivate func submitAppleCredential(_ credential: ASAuthorizationAppleIDCredential) {
        defer { appleNonce = nil; appleInvite = nil; appleRequest = nil }
        guard let nonce = appleNonce, let data = credential.identityToken,
              let identityToken = String(data: data, encoding: .utf8) else {
            notice = PortalNotice(title: "Sign in with Apple didn't finish", message: "Apple didn't return a sign-in. Try again.")
            return
        }
        var fields: [String: String] = ["identity_token": identityToken, "nonce": nonce]
        if let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) { fields["authorization_code"] = code }
        if let given = credential.fullName?.givenName, !given.isEmpty { fields["given_name"] = given }
        if let family = credential.fullName?.familyName, !family.isEmpty { fields["family_name"] = family }
        if let invite = appleInvite { fields["invite"] = invite }
        guard let json = try? JSONSerialization.data(withJSONObject: fields),
              let payload = String(data: json, encoding: .utf8) else { return }
        let action = jsString(PortalConfig.url("/auth/social/apple/native"))
        let fallback = jsString(PortalConfig.url("/auth/login"))
        evaluate("""
        (function (fields) {
          var m = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/);
          var body = new URLSearchParams();
          Object.keys(fields).forEach(function (k) { body.append(k, fields[k]); });
          fetch(\(action), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '' },
            body: body
          }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (d) { location.assign(d && d.redirect ? d.redirect : \(fallback)); })
            .catch(function () { location.assign(\(fallback)); });
        })(\(payload));
        """)
    }

    fileprivate func appleSignInFailed(_ error: Error) {
        appleNonce = nil
        appleInvite = nil
        appleRequest = nil
        // Closing the sheet is a choice, not a failure.
        if let code = (error as? ASAuthorizationError)?.code, code == .canceled { return }
        notice = PortalNotice(title: "Sign in with Apple didn't finish", message: "Try again, or sign in another way.")
    }

    private func showSignInWaiting(provider: String?) {
        quietLoad = true
        loading = false
        splash.pageReady()
        refreshSplash()
        let label: String
        switch provider {
        case "google": label = "Google"
        case "microsoft": label = "Microsoft"
        default: label = ""
        }
        var html = (try? String(contentsOf: waitingPageURL(), encoding: .utf8)) ?? "<p>Finish signing in, then return here.</p>"
        let inject = "<script>window.__tmaSignInProvider=\(jsString(label));</script>"
        if let range = html.range(of: "<head>") {
            html.insert(contentsOf: inject, at: range.upperBound)
        }
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func finishClaim(_ token: String) async {
        switch await SignInHandoff.claim(token: token) {
        case .success(let cookies):
            authSession?.cancel()
            authSession = nil
            pendingBrowserURL = nil
            // A new sign-in: whatever shell was kept belonged to the session before.
            shell.invalidate()
            files.clear()
            await importCookies(cookies)
            loadPortal()
        case .noVerifier:
            notice = PortalNotice(title: "Sign-in could not be completed", message: "Start signing in from this window rather than from the browser, and finish in the tab it opens.")
        case .rejected:
            loadPortal("/auth/login")
        case .offline:
            notice = PortalNotice(title: "Sign-in could not be completed", message: "The portal could not be reached. Try again when you have a connection.")
        }
    }

    private func importCookies(_ cookies: [HTTPCookie]) async {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        for cookie in cookies {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                store.setCookie(cookie) { cont.resume() }
            }
        }
    }

    // MARK: - notifications and push

    private func refreshNotificationPermission() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let granted = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            Task { @MainActor in
                self?.notificationsGranted = granted
                if granted { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    private func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, _ in
            Task { @MainActor in
                guard let self else { return }
                self.notificationsGranted = granted
                self.evaluate("window.__tmaNotificationPermission && __tmaNotificationPermission(\(granted))")
                if granted { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    private func showPageNotification(_ json: String) {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let id = intValue(object["id"])
        let content = UNMutableNotificationContent()
        content.title = (object["title"] as? String)?.isEmpty == false ? object["title"] as! String : "TM ANTOINE Portal"
        content.body = object["body"] as? String ?? ""
        // The TM tone unless the person chose the Apple tone (Default Alerts).
        content.sound = NotificationSound.sound(for: object["sound"] as? String, silent: (object["silent"] as? Bool) == true)
        content.userInfo = ["id": id, "url": object["url"] as? String ?? "", "source": "page"]
        if let tag = object["tag"] as? String, !tag.isEmpty { content.threadIdentifier = tag }

        // The page's layout (notify-store.js): the picture and the middle
        // line ride separately, so the banner is drawn the way the push's
        // extension draws one — the picture with the app's mark in its
        // corner, the name, the line under it, then the text. An older page
        // sends neither and keeps the plain title and body.
        let subtitle = (object["subtitle"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let text = (object["text"] as? String) ?? content.body
        let picture = Self.imageData(fromDataURL: object["icon"] as? String)
        guard subtitle != nil || picture != nil else {
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "page-\(id)", content: content, trigger: nil))
            return
        }

        content.body = text
        let conversation = content.threadIdentifier.isEmpty ? "page-\(id)" : content.threadIdentifier
        Task {
            let styled = await Self.communicationContent(content, sender: content.title, subtitle: subtitle, picture: picture, conversation: conversation)
            try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "page-\(id)", content: styled, trigger: nil))
        }
    }

    /// The bytes of a `data:image/...;base64,` picture, or nil.
    private static func imageData(fromDataURL raw: String?) -> Data? {
        guard let raw, raw.hasPrefix("data:image/"), let comma = raw.firstIndex(of: ",") else { return nil }
        let data = Data(base64Encoded: String(raw[raw.index(after: comma)...]), options: .ignoreUnknownCharacters)
        return (data?.isEmpty ?? true) ? nil : data
    }

    /// The same communication notification the push extension builds
    /// (TMAPortalNotifications/NotificationService.swift): one person, or a
    /// "conversation" named by the middle line, under the picture.
    private static func communicationContent(_ content: UNMutableNotificationContent, sender name: String, subtitle: String?, picture: Data?, conversation: String) async -> UNNotificationContent {
        let image = picture.map { INImage(imageData: $0) }
        let person = INPerson(
            personHandle: INPersonHandle(value: name, type: .unknown),
            nameComponents: PersonNameComponentsFormatter().personNameComponents(from: name),
            displayName: name,
            image: image,
            contactIdentifier: nil,
            customIdentifier: name,
            isMe: false,
            suggestionType: .none
        )
        let me = INPerson(
            personHandle: INPersonHandle(value: "me", type: .unknown),
            nameComponents: nil, displayName: nil, image: nil,
            contactIdentifier: nil, customIdentifier: nil, isMe: true, suggestionType: .none
        )

        let intent: INSendMessageIntent
        if let subtitle {
            intent = INSendMessageIntent(
                recipients: [me, person],
                outgoingMessageType: .outgoingMessageText,
                content: content.body,
                speakableGroupName: INSpeakableString(spokenPhrase: subtitle),
                // iOS remembers a conversation's name; a new middle line is
                // its own conversation.
                conversationIdentifier: "\(conversation)|\(subtitle)",
                serviceName: nil,
                sender: person,
                attachments: nil
            )
            if let image { intent.setImage(image, forParameterNamed: \.speakableGroupName) }
        } else {
            intent = INSendMessageIntent(
                recipients: [me],
                outgoingMessageType: .outgoingMessageText,
                content: content.body,
                speakableGroupName: nil,
                conversationIdentifier: conversation,
                serviceName: nil,
                sender: person,
                attachments: nil
            )
        }

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()

        return (try? content.updating(from: intent)) ?? content
    }

    private func registerPush(token: String) async {
        let cookies = await cookies()
        guard let session = sessionCookie(in: cookies) else { return }
        let stamp = sha256(token + "|" + session.value)
        if UserDefaults.standard.string(forKey: "push.registered") == stamp {
            // Already registered: still tell this page load, which starts out
            // believing push is off. Without it every launch after the first
            // had the page post its own plain banner beside (or instead of)
            // the push, with no photo and no file line.
            evaluate("window.TMADesktop && (window.TMADesktop.pushEnabled = true)")
            return
        }
        guard let url = URL(string: PortalConfig.url("/me/devices")) else { return }
        let body: [String: String] = [
            "platform": PortalConfig.pushPlatform,
            "token": token,
            "appVersion": PortalConfig.version,
            "deviceName": PortalConfig.deviceName,
        ]
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(cookieHeader(cookies), forHTTPHeaderField: "Cookie")
        if let xsrf = cookies.first(where: { $0.name == "XSRF-TOKEN" })?.value.removingPercentEncoding {
            request.setValue(xsrf, forHTTPHeaderField: "X-XSRF-TOKEN")
        }
        let sessionHTTP = URLSession(configuration: .ephemeral)
        guard let (_, response) = try? await sessionHTTP.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return }
        UserDefaults.standard.set(stamp, forKey: "push.registered")
        evaluate("window.TMADesktop && (window.TMADesktop.pushEnabled = true)")
    }

    // MARK: - updates

    private func checkForUpdate() {
        guard PortalConfig.offersFeedUpdates else { return }
        guard !offeringUpdate, updateOffer == nil, !checkingUpdate else { return }
        if callsHoldsTheScreen { return }
        let now = Date().timeIntervalSince1970
        let last = UserDefaults.standard.double(forKey: "updates.lastCheck")
        if last != 0, now - last < Self.checkInterval { return }
        checkingUpdate = true
        Task {
            defer { checkingUpdate = false }
            guard let url = URL(string: PortalConfig.url("/desktop/releases")),
                  let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return }
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "updates.lastCheck")
            guard let release = AppVersions.parseFeed(data),
                  AppVersions.isNewer(release.version, than: PortalConfig.version),
                  let link = URL(string: release.url) else { return }
            let declined = UserDefaults.standard.string(forKey: "updates.declined")
            let declinedAt = UserDefaults.standard.double(forKey: "updates.declinedAt")
            guard AppVersions.shouldReoffer(declinedVersion: declined, declinedAt: declinedAt, version: release.version, now: Date().timeIntervalSince1970, remindAfter: Self.remindAfter) else { return }
            offeringUpdate = true
            updateOffer = PortalUpdate(version: release.version, url: link)
        }
    }

    private var callsHoldsTheScreen: Bool {
        UIApplication.shared.isIdleTimerDisabled
    }

    // MARK: - helpers

    private func installScripts(in content: WKUserContentController) {
        if let host = PortalConfig.rewriteHost {
            content.addUserScript(WKUserScript(source: Self.websocketRewrite(host: host), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let preload = (bundleScript("preload") ?? "")
            .replacingOccurrences(of: "__TMA_VERSION__", with: PortalConfig.version)
            .replacingOccurrences(of: "__TMA_NOTIFICATIONS__", with: "false")
            .replacingOccurrences(of: "__TMA_GEO_STATE__", with: location.state)
            .replacingOccurrences(of: "__TMA_GLASS__", with: GlassChrome.available ? "true" : "false")
        content.addUserScript(WKUserScript(source: preload, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let hostBridge = bundleScript("host-bridge") {
            content.addUserScript(WKUserScript(source: hostBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    /// The preload carries the location permission as it stood when the page
    /// loaded; when it changes, pages loaded from now on start from the new one.
    private func reinstallScripts() {
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        installScripts(in: content)
    }

    private func bundleScript(_ name: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    private func waitingPageURL() -> URL {
        Bundle.main.url(forResource: "signin-waiting", withExtension: "html")
            ?? URL(fileURLWithPath: "/dev/null")
    }

    private static func websocketRewrite(host: String) -> String {
        let quoted = jsString(host)
        return """
        (function(){
          if (window.__tmaWsRewrite) return;
          window.__tmaWsRewrite = true;
          var host = \(quoted);
          var Native = window.WebSocket;
          function Wrapped(url, protocols) {
            try {
              var u = new URL(url, location.href);
              if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') { u.hostname = host; url = u.toString(); }
            } catch (e) {}
            return protocols === undefined ? new Native(url) : new Native(url, protocols);
          }
          Wrapped.prototype = Native.prototype;
          Wrapped.CONNECTING = Native.CONNECTING; Wrapped.OPEN = Native.OPEN;
          Wrapped.CLOSING = Native.CLOSING; Wrapped.CLOSED = Native.CLOSED;
          window.WebSocket = Wrapped;
        })();
        """
    }

    /*
     * The connection came back. Only the app's own offline or error page has
     * anything to reload; the portal itself was never gone. It used to reload
     * whatever was on screen, and a phone's connection drops and returns all
     * the time (wifi to cellular, a lift, the lock screen), so opening the app
     * often meant watching the whole portal rebuild itself from nothing, with
     * a half-written message or form gone with it. The page reconnects its
     * own live updates and sends what it held offline (portal-queue.js).
     */
    private func setOnline(_ now: Bool) {
        let was = online
        online = now
        guard now, !was, showingStandIn else { return }
        showingStandIn = false
        let target = webView.url.flatMap { rules.isPortalURL($0) ? $0 : nil } ?? URL(string: PortalConfig.url("/"))!
        Task {
            let hasSession = self.sessionCookie(in: await self.cookies()) != nil
            if hasSession, self.openFromShell(target, anyRoute: true) { return }
            self.load(target)
        }
    }

    private func loadOfflineIfPossible(_ url: URL) async {
        let hasSession = sessionCookie(in: await cookies()) != nil
        if let html = shell.maybeServe(path: url.path.isEmpty ? "/" : url.path, offline: true, hasSession: hasSession) {
            servedFromShell = true
            instantDocument = true
            showingStandIn = false
            quietLoad = true
            webView.loadHTMLString(html, baseURL: url)
            return
        }
        showStandIn(OfflinePages.offline(portalURL: PortalConfig.origin), baseURL: PortalConfig.originURL)
    }

    /*
     * The back swipe, and only the back swipe.
     *
     * WebKit's navigation gestures are both edges: from the left is back, from
     * the right is forward. Forward reopened the screen just closed (a
     * Settings page, a chat), and a hard swipe in from the right edge read as
     * the app opening a panel by itself. The right edge's recogniser is
     * switched off each time the gestures are switched on, since WebKit makes
     * them afresh.
     */
    private func setEdgeBack(_ on: Bool) {
        webView.allowsBackForwardNavigationGestures = on
        guard on else { return }
        Self.disableForwardSwipe(in: webView)
    }

    static func disableForwardSwipe(in view: UIView) {
        let rtl = view.effectiveUserInterfaceLayoutDirection == .rightToLeft
        let forwardEdge: UIRectEdge = rtl ? .left : .right
        for recognizer in view.gestureRecognizers ?? [] {
            if let edge = recognizer as? UIScreenEdgePanGestureRecognizer, edge.edges.contains(forwardEdge) {
                edge.isEnabled = false
            }
        }
        for sub in view.subviews { disableForwardSwipe(in: sub) }
    }

    private func refreshSplash() {
        showSplash = splash.showing
    }

    private func evaluate(_ js: String, done: ((String) -> Void)? = nil) {
        webView.evaluateJavaScript(js) { value, _ in
            let text: String
            if let value = value as? String { text = value }
            else if let value = value as? Bool { text = value ? "true" : "false" }
            else if let value = value as? NSNumber { text = value.boolValue ? "true" : value.stringValue }
            else { text = "" }
            done?(text)
        }
    }

    /// The page asked for documents to be kept (offline-download.js).
    private func keepFiles(call: String, list: [[String: Any]]) {
        let wanted = list.compactMap { item -> FileStore.Wanted? in
            guard let path = item["path"] as? String, path.hasPrefix("/portal/files/") else { return nil }
            let size = (item["size"] as? NSNumber)?.int64Value ?? 0
            return FileStore.Wanted(path: path, version: item["version"] as? String ?? "", size: size)
        }
        Task { @MainActor in
            let header = self.cookieHeader(await self.cookies())
            self.files.keep(wanted, cookieHeader: header, userAgent: PortalConfig.userAgent, progress: { [weak self] i, ok in
                self?.evaluate("window.__tmaFileStore && __tmaFileStore.progress(\(jsString(call)), \(i), \(ok))")
            }, done: { [weak self] in
                self?.evaluate("window.__tmaFileStore && __tmaFileStore.done(\(jsString(call)))")
            })
        }
    }

    private func cookies() async -> [HTTPCookie] {
        await withCheckedContinuation { cont in
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cont.resume(returning: $0) }
        }
    }

    private func sessionCookie(in cookies: [HTTPCookie]) -> HTTPCookie? {
        let host = PortalConfig.originURL?.host ?? ""
        return cookies.first { cookie in
            cookie.domain.contains(host) || host.contains(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
        }.flatMap { _ in
            cookies.first { $0.name.contains("session") || $0.name.hasPrefix("remember") }
        }
    }

    private func cookieHeader(_ cookies: [HTTPCookie]) -> String {
        let host = PortalConfig.originURL?.host ?? ""
        return cookies.filter { cookie in
            cookie.domain.contains(host) || host.contains(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
        }.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    private func openOutside(_ raw: String) {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return }
        UIApplication.shared.open(url)
    }

    /// Terms and Privacy over the app, so the page underneath keeps its place.
    private func showDocument(_ url: URL) {
        let viewer = SFSafariViewController(url: url)
        viewer.dismissButtonStyle = .done
        viewer.preferredControlTintColor = UIColor(red: 0x13 / 255, green: 0x6D / 255, blue: 0xA0 / 255, alpha: 1)
        guard let top = topController() else { openOutside(url.absoluteString); return }
        top.present(viewer, animated: true)
    }

    private func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let root = scenes.flatMap(\.windows).first { $0.isKeyWindow }?.rootViewController
        var current = root
        while let presented = current?.presentedViewController { current = presented }
        return current
    }

    private func presentShare(_ url: URL) {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        guard let presenter = topController() else { return }
        controller.popoverPresentationController?.sourceView = presenter.view
        controller.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        presenter.present(controller, animated: true)
    }

    fileprivate func portalOrigin(_ origin: WKSecurityOrigin) -> Bool {
        let theirs = "\(origin.protocol)://\(origin.host)" + (origin.port == 0 || origin.port == 80 || origin.port == 443 ? "" : ":\(origin.port)")
        return theirs == PortalConfig.origin
    }

    private func sha256(_ string: String) -> String {
        let digest = SHA256.hash(data: Data(string.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

extension PortalModel: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "file" || url.scheme == "about" || url.scheme == "data" {
            decisionHandler(.allow)
            return
        }
        if rules.isAppleSignIn(url) {
            decisionHandler(.cancel)
            startAppleSignIn(invite: rules.inviteToken(in: url))
            return
        }
        if let provider = rules.signInProvider(for: url, current: webView.url) {
            decisionHandler(.cancel)
            startBrowserSignIn(provider: provider)
            return
        }
        if rules.isSocialRedirect(url) {
            decisionHandler(.cancel)
            openOutside(url.absoluteString)
            return
        }
        if rules.isPortalURL(url) || rules.isAuthURL(url) {
            if navigationAction.targetFrame?.isMainFrame == true, rules.isPortalURL(url) {
                let segment = url.path.split(separator: "/").first.map(String.init) ?? ""
                // Signing in or out: the kept shell carries this account's
                // portal, and must never open as the next person's.
                if segment == "auth" || segment == "sign-in" || segment == "sign-up" {
                    shell.invalidate()
                    // And the documents kept for offline: never the next person's.
                    files.clear()
                }
                // A reload of a page painted from the phone is somebody asking
                // for the portal afresh: that is the network's to answer.
                if navigationAction.navigationType == .reload, instantDocument {
                    decisionHandler(.cancel)
                    load(url)
                    return
                }
            }
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        openOutside(url.absoluteString)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("tma-downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let cleaned = suggestedFilename.replacingOccurrences(of: "/", with: "-")
        let name = cleaned.isEmpty ? "download" : cleaned
        var dest = folder.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: dest.path) {
            dest = folder.appendingPathComponent(UUID().uuidString + "-" + name)
        }
        downloadDestinations[ObjectIdentifier(download)] = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        presentShare(url)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if rules.isPublicDocument(url) {
                showDocument(url)
            } else if rules.isPortalURL(url) || rules.isAuthURL(url) {
                webView.load(navigationAction.request)
            } else {
                openOutside(url.absoluteString)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // A new page starts with no screen open; it switches the swipe on itself.
        webView.allowsBackForwardNavigationGestures = false
        pageIsReady = false
        guard !quietLoad else { return }
        // A navigation the page made itself (signing out, Sign as admin) is
        // the network's document, not one painted from the phone.
        instantDocument = false
        loading = true
        refreshSplash()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // The old page's bar and bubbles go with it; the new page sends its own.
        glass.reset()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        quietLoad = false
        loading = false
        splash.pageReady()
        refreshSplash()
        guard let url = webView.url, rules.isPortalURL(url) else { return }
        if !showingStandIn { pageBecameReady() }
        if let script = pendingCallJS {
            evaluate(script)
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                self.evaluate(script)
                self.pendingCallJS = nil
            }
        }
        Task {
            let cookies = await self.cookies()
            if self.sessionCookie(in: cookies) != nil {
                if let token = AppBridge.token { await self.registerPush(token: token) }
                else { UIApplication.shared.registerForRemoteNotifications() }
            }
            /*
             * Keep the shell, and its bundles, for the next launch. After a
             * page painted from the phone this is also the check on it: the
             * server answering with something other than the shell (signed
             * out, onboarding, a choice it needs made) means the copy must not
             * stand in for it, so the network's answer is shown instead.
             */
            let fromPhone = self.servedFromShell && self.online
            self.servedFromShell = false
            guard self.online else { return }
            let result = await self.shell.capture(path: url.path.isEmpty ? "/" : url.path, cookieHeader: self.cookieHeader(cookies))
            if fromPhone, result == .notShell, self.instantDocument {
                self.shell.invalidate()
                self.load(url)
            }
        }
    }

    /*
     * iOS took the page away: a heavy document's memory, or long enough in the
     * background. What was left was the web view's own blue and nothing on
     * it, until the app was closed and opened again. The page comes back where
     * it was instead, painted from the phone when the kept shell can do it.
     */
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let here = webView.url.flatMap { rules.isPortalURL($0) ? $0 : nil } ?? URL(string: PortalConfig.url("/"))!
        pageIsReady = false
        glass.reset()
        Task {
            let hasSession = self.sessionCookie(in: await self.cookies()) != nil
            if hasSession, self.openFromShell(here, anyRoute: true) { return }
            self.load(here)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    private func handleLoadFailure(_ error: Error) {
        let ns = error as NSError
        if ns.code == NSURLErrorCancelled { return }
        let failed = (ns.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        guard let failed, rules.isPortalURL(failed) else {
            loading = false
            splash.pageReady()
            refreshSplash()
            return
        }
        Task {
            let offline = await self.looksOffline()
            let hasSession = self.sessionCookie(in: await self.cookies()) != nil
            if offline, let html = self.shell.maybeServe(path: failed.path.isEmpty ? "/" : failed.path, offline: true, hasSession: hasSession) {
                self.servedFromShell = true
                self.instantDocument = true
                self.showingStandIn = false
                self.quietLoad = true
                self.webView.loadHTMLString(html, baseURL: failed)
            } else if offline {
                self.showStandIn(OfflinePages.offline(portalURL: PortalConfig.origin), baseURL: PortalConfig.originURL)
            } else {
                let page = OfflinePages.loadError(portalURL: PortalConfig.origin, description: ns.localizedDescription, url: failed.absoluteString)
                self.showStandIn(page, baseURL: PortalConfig.originURL)
            }
            self.loading = false
            self.splash.pageReady()
            self.refreshSplash()
        }
    }

    private func looksOffline() async -> Bool {
        guard let url = URL(string: PortalConfig.url("/up")) else { return true }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return ((response as? HTTPURLResponse)?.statusCode ?? 500) >= 400
        } catch {
            return true
        }
    }

    func webView(
        _ webView: WKWebView,
        decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
        initiatedBy frame: WKFrameInfo,
        type: WKMediaCaptureType
    ) async -> WKPermissionDecision {
        portalOrigin(origin) ? .prompt : .deny
    }

    @available(iOS 27.0, *)
    func webView(
        _ webView: WKWebView,
        requestGeolocationPermissionFor origin: WKSecurityOrigin,
        initiatedBy frame: WKFrameInfo
    ) async -> WKPermissionDecision {
        portalOrigin(origin) ? .prompt : .deny
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        if let presenter = topController() { presenter.present(alert, animated: true) } else { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        if let presenter = topController() { presenter.present(alert, animated: true) } else { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        if let presenter = topController() { presenter.present(alert, animated: true) } else { completionHandler(nil) }
    }
}

private func jsString(_ value: String) -> String {
    let escaped = value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
    return "'\(escaped)'"
}

private func intValue(_ value: Any?) -> Int {
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    if let value = value as? String { return Int(value) ?? 0 }
    return 0
}

private final class ScriptBridge: NSObject, WKScriptMessageHandler {
    weak var model: PortalModel?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        Task { @MainActor in self.model?.handleScript(body) }
    }
}

extension PortalModel: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            appleSignInFailed(ASAuthorizationError(.unknown))
            return
        }
        submitAppleCredential(credential)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        appleSignInFailed(error)
    }
}
