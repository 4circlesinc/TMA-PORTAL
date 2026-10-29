import Foundation

/**
 The last shell the server served, kept so the app boots from it when the
 network cannot answer. A shell is any navigation whose first 4 KB carry the
 `tma-shell:` marker. Sign-in and share pages are never shells.
 */
final class ShellCache {
    static let marker = "tma-shell:"
    private static let sniff = 4096
    static let neverShell: Set<String> = ["auth", "r", "invite", "s", "sign-in", "sign-up", "design", "up"]

    private let root: URL
    private let htmlFile: URL
    private let metaFile: URL
    private let origin: String
    private(set) var remoteBuild: String?
    private(set) var servingFromCache = false

    init(origin: String) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        root = base.appendingPathComponent("shell-cache", isDirectory: true)
        htmlFile = root.appendingPathComponent("shell.html")
        metaFile = root.appendingPathComponent("meta.json")
        self.origin = origin
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func invalidate() {
        try? FileManager.default.removeItem(at: htmlFile)
        try? FileManager.default.removeItem(at: metaFile)
        servingFromCache = false
    }

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
        return text
    }

    func refreshBuild() async {
        guard let url = URL(string: origin + "/desktop/build") else { return }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let build = object["build"] as? String, !build.isEmpty else { return }
        remoteBuild = build
    }

    func capture(path: String, cookieHeader: String) async {
        if remoteBuild == nil { await refreshBuild() }
        guard let build = remoteBuild else { return }
        let segment = firstSegment(path)
        if Self.neverShell.contains(segment) { return }
        guard let url = URL(string: origin + path) else { return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              (http.value(forHTTPHeaderField: "Content-Type") ?? "").contains("text/html"),
              let body = String(data: data, encoding: .utf8),
              body.prefix(Self.sniff).contains(Self.marker) else { return }

        let previous = readMeta()
        var segments = previous?.build == build ? previous!.segments : []
        if !segment.isEmpty { segments.insert(segment) }
        servingFromCache = false
        try? body.write(to: htmlFile, atomically: true, encoding: .utf8)
        let meta: [String: Any] = ["build": build, "segments": Array(segments)]
        if let encoded = try? JSONSerialization.data(withJSONObject: meta) {
            try? encoded.write(to: metaFile)
        }
    }

    private struct Meta {
        var build: String?
        var segments: Set<String>
    }

    private func readMeta() -> Meta? {
        guard let data = try? Data(contentsOf: metaFile),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let segments = object["segments"] as? [String] else { return nil }
        let build = (object["build"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return Meta(build: build, segments: Set(segments))
    }

    private func firstSegment(_ path: String) -> String {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return trimmed.split(separator: "/").first.map(String.init) ?? ""
    }
}
