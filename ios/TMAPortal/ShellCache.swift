import CryptoKit
import Foundation

/**
 The last shell the server served, kept with the scripts and stylesheets it
 names, so the app opens on it the way an installed app does: from the phone,
 with the network's only job being data.

 It used to be kept for the offline boot alone. Every other launch asked the
 server for the page and its 3 MB bundle and assembled the portal on screen,
 which is the "whole UI refreshing" a reader sees each time they open the app.
 Now a launch paints the kept shell with its bundles inlined (`instant`), as
 long as it is this deploy's, a session exists and every file it names is
 kept. A shell is any navigation whose first 4 KB carry the `tma-shell:`
 marker. Sign-in and share pages are never shells.
 */
final class ShellCache {
    static let marker = "tma-shell:"
    private static let sniff = 4096
    static let neverShell: Set<String> = ["auth", "r", "invite", "s", "sign-in", "sign-up", "design", "up"]

    /// What a capture found when it asked the server for the shell.
    enum Capture: Equatable {
        /// The shell, kept, for this deploy.
        case shell(String)
        /// The server answered with something else: sign-in, onboarding, a
        /// choice it wants made. The kept copy must not stand in for that.
        case notShell
        /// No answer: nothing learned.
        case failed
    }

    private let root: URL
    private let htmlFile: URL
    private let metaFile: URL
    private let assetsDir: URL
    private let origin: String
    private(set) var remoteBuild: String?
    private(set) var servingFromCache = false

    init(origin: String, root: URL? = nil) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        self.root = root ?? base.appendingPathComponent("shell-cache", isDirectory: true)
        htmlFile = self.root.appendingPathComponent("shell.html")
        metaFile = self.root.appendingPathComponent("meta.json")
        assetsDir = self.root.appendingPathComponent("assets", isDirectory: true)
        self.origin = origin
        try? FileManager.default.createDirectory(at: assetsDir, withIntermediateDirectories: true)
    }

    func invalidate() {
        try? FileManager.default.removeItem(at: htmlFile)
        try? FileManager.default.removeItem(at: metaFile)
        servingFromCache = false
    }

    /// The deploy the kept shell was captured under.
    var keptBuild: String? { readMeta()?.build }

    /// Whether a launch can open on the kept shell with nothing from the network.
    var canBootInstantly: Bool {
        guard let meta = readMeta(), meta.build != nil, meta.complete else { return false }
        return FileManager.default.fileExists(atPath: htmlFile.path)
    }

    /// The kept shell for an offline navigation, its bundles inlined when they
    /// are all kept (so offline paints styled), the raw copy otherwise.
    func maybeServe(path: String, offline: Bool, hasSession: Bool) -> String? {
        guard let meta = readMeta(), hasSession else { return nil }
        let segment = firstSegment(path)
        if path != "/", !meta.segments.contains(segment) {
            if !offline || Self.neverShell.contains(segment) { return nil }
        }
        if let remote = remoteBuild, let build = meta.build, build != remote {
            invalidate()
            return nil
        }
        guard let text = try? String(contentsOf: htmlFile, encoding: .utf8) else { return nil }
        servingFromCache = true
        if meta.complete, let inlined = Self.inline(text, assets: meta.assets, read: readAsset) { return inlined }
        return text
    }

    /**
     The kept shell for a launch, with every script and stylesheet inlined, or
     nil for "ask the network". Never for a deploy known to have moved, never
     without a session, never for a path the shell has not served, and never
     half: a shell missing one of its files would paint a portal with no
     stylesheet or no script.
     */
    func instant(path: String, hasSession: Bool, anyRoute: Bool = false) -> String? {
        guard hasSession, let meta = readMeta(), meta.complete, let build = meta.build else { return nil }
        if let remote = remoteBuild, remote != build { return nil }
        let segment = firstSegment(path)
        // The shell is one document for every portal page, its router takes
        // the path from there; `anyRoute` (a page the system took away, a
        // notification's link) leans on that. Sign-in and the like never.
        if Self.neverShell.contains(segment) { return nil }
        if path != "/", !anyRoute, !meta.segments.contains(segment) { return nil }
        guard let text = try? String(contentsOf: htmlFile, encoding: .utf8),
              let inlined = Self.inline(text, assets: meta.assets, read: readAsset) else { return nil }
        servingFromCache = true
        return inlined
    }

    /// The deploy the portal is running. `timeout` lets a launch ask briefly.
    @discardableResult
    func refreshBuild(timeout: TimeInterval = 10) async -> String? {
        guard let url = URL(string: origin + "/desktop/build") else { return nil }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let build = object["build"] as? String, !build.isEmpty else { return nil }
        remoteBuild = build
        return build
    }

    @discardableResult
    func capture(path: String, cookieHeader: String) async -> Capture {
        if remoteBuild == nil { await refreshBuild() }
        guard let build = remoteBuild else { return .failed }
        let segment = firstSegment(path)
        if Self.neverShell.contains(segment) { return .failed }
        guard let url = URL(string: origin + path) else { return .failed }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse else { return .failed }
        guard (200..<300).contains(http.statusCode),
              (http.value(forHTTPHeaderField: "Content-Type") ?? "").contains("text/html"),
              let body = String(data: data, encoding: .utf8),
              body.prefix(Self.sniff).contains(Self.marker) else {
            // An answer that is not the shell. A 5xx is the server unwell, not
            // a verdict about this session; anything else is the server
            // routing the reader somewhere the shell must not paint over.
            return http.statusCode >= 500 ? .failed : .notShell
        }

        // The files this shell names, fetched now so the next launch needs none.
        var assets: [String: String] = [:]
        var complete = true
        for ref in Self.assetRefs(in: body) {
            if let name = await keepAsset(ref) { assets[ref] = name } else { complete = false }
        }

        let previous = readMeta()
        var segments = previous?.build == build ? previous!.segments : []
        if !segment.isEmpty { segments.insert(segment) }
        servingFromCache = false
        try? body.write(to: htmlFile, atomically: true, encoding: .utf8)
        let meta: [String: Any] = [
            "build": build,
            "segments": Array(segments),
            "assets": assets,
            "complete": complete && Self.inline(body, assets: assets, read: readAsset) != nil,
        ]
        if let encoded = try? JSONSerialization.data(withJSONObject: meta) {
            try? encoded.write(to: metaFile, options: .atomic)
        }
        prune(keeping: Set(assets.values))
        return .shell(build)
    }

    // MARK: - the files a shell names

    /// Same-origin scripts and stylesheets the document loads, as written in it.
    static func assetRefs(in html: String) -> [String] {
        var refs: [String] = []
        for tag in tags(in: html) {
            guard let ref = attribute(tag.text, tag.isScript ? "src" : "href"),
                  isLocal(ref), !refs.contains(ref) else { continue }
            refs.append(ref)
        }
        return refs
    }

    /**
     The document with each kept script and stylesheet written into it.

     A script goes in as `<script>…</script>` at its own place. The shell's
     only deferred script is the bundle, the last thing before `</body>`, so
     run there it runs when a deferred one would. A stylesheet goes in as
     `<style>`: the shell's `<base href="/">` resolves its `url(../images/…)`
     the same as the file did. Nil when anything named is missing, or a script
     holds `<!--`, which an inline script cannot carry safely.
     */
    static func inline(_ html: String, assets: [String: String], read: (String) -> String?) -> String? {
        let ns = NSMutableString(string: html)
        for tag in tags(in: html).sorted(by: { $0.range.location > $1.range.location }) {
            guard let ref = attribute(tag.text, tag.isScript ? "src" : "href"), isLocal(ref) else { continue }
            guard let name = assets[ref], let content = read(name) else { return nil }
            let replacement: String
            if tag.isScript {
                if content.range(of: "<!--") != nil { return nil }
                let safe = content.replacingOccurrences(of: "</script", with: "<\\/script", options: .caseInsensitive)
                replacement = "<script>" + safe + "\n</script>"
            } else {
                let safe = content.replacingOccurrences(of: "</style", with: "<\\/style", options: .caseInsensitive)
                replacement = "<style>" + safe + "\n</style>"
            }
            ns.replaceCharacters(in: tag.range, with: replacement)
        }
        return ns as String
    }

    private static let scriptTag = try! NSRegularExpression(pattern: "<script\\b[^>]*\\bsrc=\"[^\"]+\"[^>]*>\\s*</script>", options: [.caseInsensitive])
    private static let styleTag = try! NSRegularExpression(pattern: "<link\\b[^>]*\\brel=\"stylesheet\"[^>]*>", options: [.caseInsensitive])

    private struct Tag {
        let text: String
        let range: NSRange
        let isScript: Bool
    }

    /// Scripts and stylesheets, in document order.
    private static func tags(in html: String) -> [Tag] {
        let ns = html as NSString
        let whole = NSRange(location: 0, length: ns.length)
        let scripts = scriptTag.matches(in: html, range: whole).map { Tag(text: ns.substring(with: $0.range), range: $0.range, isScript: true) }
        let styles = styleTag.matches(in: html, range: whole).map { Tag(text: ns.substring(with: $0.range), range: $0.range, isScript: false) }
        return (scripts + styles).sorted { $0.range.location < $1.range.location }
    }

    private static func attribute(_ tag: String, _ name: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: "\\b\(name)=\"([^\"]+)\"", options: [.caseInsensitive]) else { return nil }
        let ns = tag as NSString
        guard let match = regex.firstMatch(in: tag, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return ns.substring(with: match.range(at: 1))
    }

    private static func isLocal(_ ref: String) -> Bool {
        let lower = ref.lowercased()
        return !(lower.hasPrefix("http:") || lower.hasPrefix("https:") || lower.hasPrefix("//") || lower.hasPrefix("data:") || lower.hasPrefix("blob:"))
    }

    private func keepAsset(_ ref: String) async -> String? {
        let path = ref.hasPrefix("/") ? ref : "/" + ref
        guard let url = URL(string: origin + path) else { return nil }
        let name = Self.assetName(ref)
        let file = assetsDir.appendingPathComponent(name)
        // A name that carries its version (the bundle's hash, a `?v=`) cannot
        // change under it, so a copy already kept is this copy: no download on
        // every launch for a 3 MB file that has not moved.
        if Self.isVersioned(ref), FileManager.default.fileExists(atPath: file.path) { return name }
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200, !data.isEmpty,
              String(data: data, encoding: .utf8) != nil else {
            // Unchanged and already kept is still kept.
            return FileManager.default.fileExists(atPath: file.path) ? name : nil
        }
        do {
            try data.write(to: file, options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    static func isVersioned(_ ref: String) -> Bool {
        ref.range(of: "build/app-[0-9a-f]+\\.(css|js)", options: .regularExpression) != nil
            || ref.range(of: "[?&]v=", options: .regularExpression) != nil
    }

    static func assetName(_ ref: String) -> String {
        SHA256.hash(data: Data(ref.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func readAsset(_ name: String) -> String? {
        try? String(contentsOf: assetsDir.appendingPathComponent(name), encoding: .utf8)
    }

    private func prune(keeping names: Set<String>) {
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: assetsDir.path) else { return }
        for file in files where !names.contains(file) {
            try? FileManager.default.removeItem(at: assetsDir.appendingPathComponent(file))
        }
    }

    // MARK: - meta

    private struct Meta {
        var build: String?
        var segments: Set<String>
        var assets: [String: String]
        var complete: Bool
    }

    private func readMeta() -> Meta? {
        guard let data = try? Data(contentsOf: metaFile),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let segments = object["segments"] as? [String] else { return nil }
        let build = (object["build"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return Meta(
            build: build,
            segments: Set(segments),
            assets: object["assets"] as? [String: String] ?? [:],
            complete: object["complete"] as? Bool ?? false
        )
    }

    private func firstSegment(_ path: String) -> String {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return trimmed.split(separator: "/").first.map(String.init) ?? ""
    }

    // MARK: - test seam

    /// Writes a kept shell directly, as a capture would, for tests.
    func _seed(html: String, build: String, segments: [String], assets: [String: String]) {
        try? html.write(to: htmlFile, atomically: true, encoding: .utf8)
        var names: [String: String] = [:]
        for (ref, content) in assets {
            let name = Self.assetName(ref)
            try? content.write(to: assetsDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
            names[ref] = name
        }
        let meta: [String: Any] = ["build": build, "segments": segments, "assets": names, "complete": true]
        if let encoded = try? JSONSerialization.data(withJSONObject: meta) { try? encoded.write(to: metaFile) }
    }

    func _setRemoteBuild(_ build: String?) { remoteBuild = build }
}
