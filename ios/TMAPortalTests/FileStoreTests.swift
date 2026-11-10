import Foundation
import UIKit
import WebKit
import XCTest
@testable import TMAPortal

/// Documents kept on the phone for offline (FileStore.swift).
final class FileStoreTests: XCTestCase {
    private var root: URL!

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("filestore-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    private func download(_ text: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? Data(text.utf8).write(to: url)
        return url
    }

    func testAKeptDocumentReadsBackWithItsType() {
        let store = FileStore(origin: "https://portal.example", directory: root)
        let path = "/portal/files/files/0b3f8e2a-1111-4a5b-9c3d-123456789abc/preview"
        XCTAssertTrue(store.store(path: path, from: download("%PDF-1.7 hello"), type: "application/pdf", version: "v1"))

        let kept = store.read(path: path)
        XCTAssertEqual(kept.map { String(decoding: $0.0, as: UTF8.self) }, "%PDF-1.7 hello")
        XCTAssertEqual(kept?.1, "application/pdf")
        XCTAssertEqual(store.usage().count, 1)
    }

    func testAChangedDocumentIsFetchedAgain() {
        let store = FileStore(origin: "https://portal.example", directory: root)
        let path = "/portal/files/files/0b3f8e2a-2222-4a5b-9c3d-123456789abc/preview"
        store.store(path: path, from: download("first"), type: "text/plain", version: "2026-11-01")

        XCTAssertTrue(store.have(path, version: "2026-11-01"), "the same version is already on the phone")
        XCTAssertFalse(store.have(path, version: "2026-11-10"), "a new version is downloaded again")
    }

    func testItSurvivesTheAppStartingAgain() {
        let path = "/portal/files/files/0b3f8e2a-3333-4a5b-9c3d-123456789abc/thumb"
        FileStore(origin: "https://portal.example", directory: root)
            .store(path: path, from: download("kept"), type: "image/jpeg", version: "v1")

        let reopened = FileStore(origin: "https://portal.example", directory: root)
        XCTAssertNotNil(reopened.read(path: path), "kept in Application Support, not a folder iOS empties")
    }

    func testSigningOutLeavesNothingBehind() {
        let store = FileStore(origin: "https://portal.example", directory: root)
        let path = "/portal/files/files/0b3f8e2a-4444-4a5b-9c3d-123456789abc/preview"
        store.store(path: path, from: download("private"), type: "text/plain", version: "v1")

        store.clear()
        XCTAssertNil(store.read(path: path))
        XCTAssertEqual(store.usage().count, 0)
        XCTAssertNil(FileStore(origin: "https://portal.example", directory: root).read(path: path), "not after a restart either")
    }

    func testTheFolderIsLeftOutOfBackups() throws {
        _ = FileStore(origin: "https://portal.example", directory: root)
        let values = try root.appendingPathComponent("file-store").resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(values.isExcludedFromBackup, true)
    }

    /// The page (an https origin) can read a kept document back: what
    /// offline-fetch.js does, through TMADesktop.readKeptFile, when nothing
    /// answers. Through a reply handler, because WebKit refuses an https page
    /// a fetch of a custom scheme ("Load failed"): a tma-file:// address
    /// was tried first and this test caught it.
    @MainActor
    func testAnHttpsPageCanReadAKeptDocument() async throws {
        let origin = "https://portal.example"
        let store = FileStore(origin: origin, directory: root)
        let path = "/portal/files/files/0b3f8e2a-5555-4a5b-9c3d-123456789abc/preview"
        store.store(path: path, from: download("%PDF kept on the phone"), type: "application/pdf", version: "v1")

        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(store, contentWorld: .page, name: FileStore.handlerName)
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), configuration: config)
        // In a window, as in the app: a web view in none gets no page process.
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first
        window?.addSubview(web)
        defer { web.removeFromSuperview() }
        web.loadHTMLString("<!doctype html><html><body>portal</body></html>", baseURL: URL(string: origin + "/")!)
        for _ in 0..<50 {
            if (try? await web.evaluateJavaScript("document.readyState")) as? String == "complete" { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        // As preload.js's readKeptFile does it: the reply, then a Blob of it.
        let script = "try { const r = await webkit.messageHandlers.tmaFiles.postMessage({ path: url });"
            + " if (!r) return 'none';"
            + " const raw = atob(r.data); const bytes = new Uint8Array(raw.length);"
            + " for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);"
            + " return r.type + ' ' + new TextDecoder().decode(bytes); } catch (e) { return 'threw ' + e; }"
        let read = await page(web, script, url: path)
        XCTAssertEqual(read, "application/pdf %PDF kept on the phone")

        let missing = await page(web, script, url: "/portal/files/files/never/preview")
        XCTAssertEqual(missing, "none", "a document never kept says so")
    }

    /// Run a page script with `url` in scope; what it returned, or the error.
    @MainActor
    private func page(_ web: WKWebView, _ body: String, url: String) async -> String {
        await withCheckedContinuation { (done: CheckedContinuation<String, Never>) in
            web.callAsyncJavaScript(body, arguments: ["url": url], in: nil, in: .page) { result in
                switch result {
                case .success(let value): done.resume(returning: "\(value ?? "nil")")
                case .failure(let error): done.resume(returning: "error \(error)")
                }
            }
        }
    }

    func testTheBudgetIsTheFirmsFigure() {
        XCTAssertEqual(FileStore.budget, 2_684_354_560, "2.5 GB")
    }
}
