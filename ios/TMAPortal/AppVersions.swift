import Foundation

/// `/desktop/releases`, reduced to whether a newer iOS build is published.
enum AppVersions {
    struct Release {
        let version: String
        let url: String
    }

    static func parseFeed(_ data: Data) -> Release? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let ios = object["ios"] as? [String: Any],
              ios["available"] as? Bool == true,
              let version = (ios["version"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              let url = (ios["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !version.isEmpty, !url.isEmpty else { return nil }
        return Release(version: version, url: url)
    }

    static func isNewer(_ remote: String, than installed: String) -> Bool {
        compare(remote, installed) > 0
    }

    static func shouldReoffer(declinedVersion: String?, declinedAt: TimeInterval, version: String, now: TimeInterval, remindAfter: TimeInterval) -> Bool {
        guard let declinedVersion, !declinedVersion.isEmpty, declinedVersion == version else { return true }
        return now - declinedAt >= remindAfter
    }

    static func compare(_ a: String, _ b: String) -> Int {
        let x = parts(a)
        let y = parts(b)
        let n = max(x.count, y.count)
        for i in 0..<n {
            let diff = (i < x.count ? x[i] : 0) - (i < y.count ? y[i] : 0)
            if diff != 0 { return diff }
        }
        return 0
    }

    private static func parts(_ version: String) -> [Int] {
        let core = version.trimmingCharacters(in: .whitespaces)
            .split(separator: "-").first.map(String.init) ?? version
        let clean = core.split(separator: "+").first.map(String.init) ?? core
        return clean.split(separator: ".").map { Int($0) ?? 0 }
    }
}
