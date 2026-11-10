import UIKit
import WebKit
import XCTest
@testable import TMAPortal

/// The kept shell opens the app from the phone: its files inlined, only when safe.
final class ShellCacheTests: XCTestCase {
    private let shellHTML = """
    <!DOCTYPE html><html><head><base href="/"><!-- tma-shell:test -->
      <script src="js/portal-access.js?v=30"></script>
      <link rel="stylesheet" href="build/app-abc123.css" onerror="__tmaBundleMissing()">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter">
    </head><body><div class="tma-dash"></div>
      <script src="build/app-abc123.js" defer onerror="__tmaBundleMissing()"></script>
    </body></html>
    """

    private func cache() -> ShellCache {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shell-test-" + UUID().uuidString)
        return ShellCache(origin: "https://portal.test", root: dir)
    }

    private func seeded(_ assets: [String: String]? = nil) -> ShellCache {
        let c = cache()
        c._seed(html: shellHTML, build: "deploy-1", segments: [], assets: assets ?? [
            "js/portal-access.js?v=30": "window.__access = 1;",
            "build/app-abc123.css": "body{background:url(../images/x.png)}",
            "build/app-abc123.js": "window.__portal = '</script>';",
        ])
        return c
    }

    func testTheShellNamesItsOwnFilesOnly() {
        XCTAssertEqual(ShellCache.assetRefs(in: shellHTML), [
            "js/portal-access.js?v=30", "build/app-abc123.css", "build/app-abc123.js",
        ])
    }

    func testALaunchPaintsTheShellWithItsFilesInlined() {
        let html = seeded().instant(path: "/", hasSession: true)
        XCTAssertNotNil(html)
        guard let html else { return }
        XCTAssertTrue(html.contains("<script>window.__access = 1;"))
        XCTAssertTrue(html.contains("<style>body{background:url(../images/x.png)}"))
        // A closing tag inside the script cannot end it early.
        XCTAssertTrue(html.contains("window.__portal = '<\\/script>';"))
        XCTAssertFalse(html.contains("build/app-abc123.js"))
        XCTAssertFalse(html.contains("build/app-abc123.css"))
        // Another site's stylesheet is left for the network.
        XCTAssertTrue(html.contains("https://fonts.googleapis.com/css?family=Inter"))
        // The bundle stays where it was, the last thing before </body>.
        XCTAssertTrue(html.range(of: "window.__portal")!.lowerBound > html.range(of: "class=\"tma-dash\"")!.lowerBound)
    }

    func testNoSessionNoShell() {
        XCTAssertNil(seeded().instant(path: "/", hasSession: false))
    }

    func testADeployThatMovedIsTheNetworks() {
        let c = seeded()
        c._setRemoteBuild("deploy-2")
        XCTAssertNil(c.instant(path: "/", hasSession: true))
        c._setRemoteBuild("deploy-1")
        XCTAssertNotNil(c.instant(path: "/", hasSession: true))
    }

    func testAShellMissingAFileIsNeverHalfPainted() {
        let c = cache()
        c._seed(html: shellHTML, build: "deploy-1", segments: [], assets: [
            "js/portal-access.js?v=30": "window.__access = 1;",
            "build/app-abc123.css": "body{}",
        ])
        XCTAssertNil(c.instant(path: "/", hasSession: true))
    }

    func testAScriptThatCannotBeInlinedSafelyGoesToTheNetwork() {
        let c = seeded([
            "js/portal-access.js?v=30": "window.__access = 1;",
            "build/app-abc123.css": "body{}",
            "build/app-abc123.js": "var x = '<!--';",
        ])
        XCTAssertNil(c.instant(path: "/", hasSession: true))
    }

    func testSignInIsNeverTheShellAndOtherRoutesOnlyWhenAsked() {
        let c = seeded()
        XCTAssertNil(c.instant(path: "/auth/login", hasSession: true, anyRoute: true))
        XCTAssertNil(c.instant(path: "/cip/applications/abc", hasSession: true))
        XCTAssertNotNil(c.instant(path: "/cip/applications/abc", hasSession: true, anyRoute: true))
    }

    func testOfflineTheKeptShellIsStyledToo() {
        let html = seeded().maybeServe(path: "/clients", offline: true, hasSession: true)
        XCTAssertTrue(html?.contains("<style>body{background") == true)
    }

    func testVersionedNamesAreNotFetchedAgain() {
        XCTAssertTrue(ShellCache.isVersioned("build/app-abc123.js"))
        XCTAssertTrue(ShellCache.isVersioned("js/portal-access.js?v=30"))
        XCTAssertFalse(ShellCache.isVersioned("css/theme.css"))
    }

    @MainActor
    func testTheEdgeSwipeIsBackOnlyNeverForward() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let web = WKWebView(frame: window.bounds)
        window.addSubview(web)
        window.makeKeyAndVisible()
        web.allowsBackForwardNavigationGestures = true
        PortalModel.disableForwardSwipe(in: web)
        let edges = allRecognizers(in: web).compactMap { $0 as? UIScreenEdgePanGestureRecognizer }
        XCTAssertTrue(edges.contains { $0.edges.contains(.right) }, "WebKit made its forward swipe here")
        for edge in edges where edge.edges.contains(.right) {
            XCTAssertFalse(edge.isEnabled, "the forward swipe from the right edge is off")
        }
        // WebKit keeps two per edge and leaves one of them off itself; the back
        // swipe is whichever of the left pair it left on, untouched here.
        XCTAssertTrue(edges.contains { $0.edges.contains(.left) && $0.isEnabled }, "the back swipe from the left edge stays on")
    }

    private func allRecognizers(in view: UIView) -> [UIGestureRecognizer] {
        (view.gestureRecognizers ?? []) + view.subviews.flatMap { allRecognizers(in: $0) }
    }
}
