import Foundation
import WebKit

/// Documents kept on the phone, for when there is no connection.
///
/// The desktop apps keep the bytes of every document they show
/// (desktop/file-cache.js), because every load in them passes through the
/// app. A WKWebView's loads do not: an https request cannot be intercepted,
/// and the web view's own cache is the system's to empty whenever it likes.
/// So the page asks for them instead (public/js/offline-download.js, through
/// `TMADesktop.keepFiles`), this downloads them in the app's own session with
/// the page's sign-in, and keeps them here:
///
/// - In Application Support, not tmp or Caches, which iOS empties on its own.
/// - Encrypted by the phone (complete until first unlock, so a download can
///   finish while the phone is locked) and left out of iCloud backups.
/// - Within a budget (2.5 GB, the firm's figure), least recently used first
///   out, the same rule as the desktop.
/// - Wiped when somebody signs out or another account signs in.
///
/// When the portal asks for a document and nothing answers, the page asks
/// this for it by its path (`TMADesktop.readKeptFile`, the `tmaFiles` message
/// handler, public/js/offline-fetch.js and offline-pictures.js), and gets its
/// bytes back. Not a URL scheme: WebKit will not let an https page fetch from
/// one (FileStoreTests pins why this is a reply handler instead).
final class FileStore: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "tmaFiles"
    static let budget: Int64 = 2_684_354_560 // 2.5 GB
    /// Larger than this is not worth a phone's space for one document.
    static let fileLimit: Int64 = 100 * 1024 * 1024

    struct Entry: Codable {
        var file: String
        var size: Int64
        var lastUsed: Double
        var type: String
        var version: String
    }

    struct Wanted {
        let path: String
        let version: String
        let size: Int64
    }

    private let dir: URL
    private let indexURL: URL
    private let origin: String
    private let queue = DispatchQueue(label: "tma.filestore")
    private var index: [String: Entry] = [:]
    /// Bumped by clear(), so a download already running stops keeping.
    private var generation = 0

    init(origin: String, directory: URL? = nil) {
        self.origin = origin
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        dir = base.appendingPathComponent("file-store", isDirectory: true)
        indexURL = dir.appendingPathComponent("index.json")
        super.init()
        prepareDirectory()
        if let data = try? Data(contentsOf: indexURL),
           let saved = try? JSONDecoder().decode([String: Entry].self, from: data) {
            index = saved
        }
    }

    // MARK: - keeping

    /// Download what is missing or has changed, one at a time:
    /// `progress(i, ok)` for each, then `done()`, both on the main thread.
    func keep(_ files: [Wanted], cookieHeader: String, userAgent: String,
              progress: @escaping (Int, Bool) -> Void, done: @escaping () -> Void) {
        let started = queue.sync { generation }
        Task.detached(priority: .utility) { [weak self] in
            for (i, wanted) in files.enumerated() {
                guard let self, await self.currentGeneration() == started else { break }
                let ok = await self.fetch(wanted, cookieHeader: cookieHeader, userAgent: userAgent, generation: started)
                await MainActor.run { progress(i, ok) }
            }
            await MainActor.run { done() }
        }
    }

    private func currentGeneration() -> Int {
        queue.sync { generation }
    }

    private func fetch(_ wanted: Wanted, cookieHeader: String, userAgent: String, generation started: Int) async -> Bool {
        if have(wanted.path, version: wanted.version) { return true }
        guard wanted.size <= Self.fileLimit,
              let url = URL(string: origin + wanted.path) else { return false }
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 120
        do {
            let (temp, response) = try await URLSession.shared.download(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  currentGeneration() == started else {
                try? FileManager.default.removeItem(at: temp)
                return false
            }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
            return store(path: wanted.path, from: temp, type: type, version: wanted.version)
        } catch {
            return false
        }
    }

    func have(_ path: String, version: String) -> Bool {
        queue.sync {
            guard let entry = index[path], entry.version == version else { return false }
            return FileManager.default.fileExists(atPath: dir.appendingPathComponent(entry.file).path)
        }
    }

    /// Move a downloaded file in under its path, then keep within the budget.
    @discardableResult
    func store(path: String, from temp: URL, type: String, version: String) -> Bool {
        queue.sync {
            let name = Self.fileName(for: path)
            let target = dir.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: target)
            do {
                try FileManager.default.moveItem(at: temp, to: target)
                try? FileManager.default.setAttributes(
                    [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                    ofItemAtPath: target.path)
            } catch {
                return false
            }
            let size = ((try? FileManager.default.attributesOfItem(atPath: target.path))?[.size] as? NSNumber)?.int64Value ?? 0
            if size > Self.budget {
                try? FileManager.default.removeItem(at: target)
                return false
            }
            index[path] = Entry(file: name, size: size, lastUsed: Date().timeIntervalSince1970, type: type, version: version)
            evictOverBudget()
            saveIndex()
            return true
        }
    }

    /// The kept bytes of a document, and its type. Marks it used.
    func read(path: String) -> (Data, String)? {
        queue.sync {
            guard var entry = index[path],
                  let data = try? Data(contentsOf: dir.appendingPathComponent(entry.file)) else { return nil }
            entry.lastUsed = Date().timeIntervalSince1970
            index[path] = entry
            saveIndex()
            return (data, entry.type)
        }
    }

    /// How much is kept.
    func usage() -> (count: Int, bytes: Int64) {
        queue.sync { (index.count, index.values.reduce(0) { $0 + $1.size }) }
    }

    /// Somebody signed out, or another account signed in.
    func clear() {
        queue.sync {
            generation += 1
            index = [:]
            try? FileManager.default.removeItem(at: dir)
            prepareDirectory()
        }
    }

    // MARK: - housekeeping (on `queue`, or from init)

    private func prepareDirectory() {
        try? FileManager.default.createDirectory(
            at: dir, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var folder = dir
        try? folder.setResourceValues(values)
    }

    private func evictOverBudget() {
        var total = index.values.reduce(0) { $0 + $1.size }
        guard total > Self.budget else { return }
        for (path, entry) in index.sorted(by: { $0.value.lastUsed < $1.value.lastUsed }) {
            if total <= Self.budget { break }
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(entry.file))
            index[path] = nil
            total -= entry.size
        }
    }

    private func saveIndex() {
        guard let data = try? JSONEncoder().encode(index) else { return }
        try? data.write(to: indexURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// A stable, flat file name: the path's letters and digits, the rest "_".
    static func fileName(for path: String) -> String {
        let safe = path.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : "_" }.joined()
        return String(safe.suffix(180))
    }

    // MARK: - the page asking for a kept document: { path } -> { type, data (base64) } | nil

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let path = body["path"] as? String,
              path.hasPrefix("/portal/files/") else {
            replyHandler(nil, nil)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let kept = self?.read(path: path)
            let reply: Any? = kept.map { ["type": $0.1, "data": $0.0.base64EncodedString()] }
            DispatchQueue.main.async { replyHandler(reply, nil) }
        }
    }
}
