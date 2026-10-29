import AuthenticationServices
import CryptoKit
import Network
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
    private let rules: NavigationRules
    private let shell: ShellCache
    private let bridge = ScriptBridge()
    private let monitor = NWPathMonitor()
    private var online = true
    private var quietLoad = false
    private var servedFromShell = false
    private var risen = false
    private var callInfo: String?
    private var authSession: ASWebAuthenticationSession?
    private var pendingBrowserURL: URL?
    private var pendingCallJS: String?
    private var notificationsGranted = false
    private var offeringUpdate = false
    private var checkingUpdate = false
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

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

        let content = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = UIDevice.current.userInterfaceIdiom == .pad ? .desktop : .mobile
        let webView = WKWebView(frame: .zero, configuration: config)
        self.webView = webView
        super.init()

        bridge.model = self
        calls.model = self
        AppBridge.model = self
        content.add(bridge, name: "tmaHost")
        installScripts(in: content)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.customUserAgent = PortalConfig.userAgent
        webView.allowsBackForwardNavigationGestures = true
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
            try? await Task.sleep(nanoseconds: 420_000_000)
            risen = true
            refreshSplash()
        }
        refreshNotificationPermission()
        loadPortal()
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
        let id = intValue(info["id"])
        let url = info["url"] as? String ?? ""
        guard id > 0 else { return }
        evaluate("!!(window.__tmaNotificationClick && __tmaNotificationClick(\(id)))") { [weak self] result in
            guard let self, result != "true", !url.isEmpty else { return }
            guard let target = URL(string: url.hasPrefix("http") ? url : PortalConfig.url(url)) else { return }
            self.load(target)
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
        case "notify":
            if let json = dict["json"] as? String { showPageNotification(json) }
        case "closeNotification":
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["page-\(intValue(dict["id"]))"])
        case "openInBrowser":
            if let raw = dict["url"] as? String { openOutside(raw) }
        case "openLocationSettings":
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        case "requestNotifications":
            requestNotifications()
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

    private func showSignInWaiting(provider: String?) {
        quietLoad = true
        loading = false
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
        if (object["silent"] as? Bool) != true { content.sound = .default }
        content.userInfo = ["id": id, "url": object["url"] as? String ?? "", "source": "page"]
        if let tag = object["tag"] as? String, !tag.isEmpty { content.threadIdentifier = tag }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "page-\(id)", content: content, trigger: nil))
    }

    private func registerPush(token: String) async {
        let cookies = await cookies()
        guard let session = sessionCookie(in: cookies) else { return }
        let stamp = sha256(token + "|" + session.value)
        if UserDefaults.standard.string(forKey: "push.registered") == stamp { return }
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
        content.addUserScript(WKUserScript(source: preload, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let hostBridge = bundleScript("host-bridge") {
            content.addUserScript(WKUserScript(source: hostBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
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

    private func setOnline(_ now: Bool) {
        let was = online
        online = now
        if now, !was { webView.reload() }
    }

    private func loadOfflineIfPossible(_ url: URL) async {
        let hasSession = sessionCookie(in: await cookies()) != nil
        if let html = shell.maybeServe(path: url.path.isEmpty ? "/" : url.path, offline: true, hasSession: hasSession) {
            servedFromShell = true
            quietLoad = true
            webView.loadHTMLString(html, baseURL: url)
            return
        }
        quietLoad = true
        webView.loadHTMLString(OfflinePages.offline(portalURL: PortalConfig.origin), baseURL: PortalConfig.originURL)
    }

    private func refreshSplash() {
        showSplash = loading || !risen
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
            if rules.isPortalURL(url) || rules.isAuthURL(url) {
                webView.load(navigationAction.request)
            } else {
                openOutside(url.absoluteString)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard !quietLoad else { return }
        loading = true
        refreshSplash()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        quietLoad = false
        loading = false
        refreshSplash()
        guard let url = webView.url, rules.isPortalURL(url) else { return }
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
            if !self.servedFromShell {
                await self.shell.capture(path: url.path.isEmpty ? "/" : url.path, cookieHeader: self.cookieHeader(cookies))
            }
            self.servedFromShell = false
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
            refreshSplash()
            return
        }
        Task {
            let offline = await self.looksOffline()
            let hasSession = self.sessionCookie(in: await self.cookies()) != nil
            if offline, let html = self.shell.maybeServe(path: failed.path.isEmpty ? "/" : failed.path, offline: true, hasSession: hasSession) {
                self.servedFromShell = true
                self.quietLoad = true
                self.webView.loadHTMLString(html, baseURL: failed)
            } else if offline {
                self.quietLoad = true
                self.webView.loadHTMLString(OfflinePages.offline(portalURL: PortalConfig.origin), baseURL: PortalConfig.originURL)
            } else {
                self.quietLoad = true
                let page = OfflinePages.loadError(portalURL: PortalConfig.origin, description: ns.localizedDescription, url: failed.absoluteString)
                self.webView.loadHTMLString(page, baseURL: PortalConfig.originURL)
            }
            self.loading = false
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
