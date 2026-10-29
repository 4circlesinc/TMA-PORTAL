import UIKit

/// Which portal this build talks to. Debug points at the Docker stack on the
/// Mac (the simulator shares localhost). Override a physical phone with the
/// scheme environment variable PORTAL_ORIGIN=http://192.168.x.x:8001.
enum PortalConfig {
    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    }

    static var origin: String {
        let raw = ProcessInfo.processInfo.environment["PORTAL_ORIGIN"]
            ?? (Bundle.main.object(forInfoDictionaryKey: "PortalOrigin") as? String)
            ?? defaultOrigin
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    #if DEBUG
    static let defaultOrigin = "http://127.0.0.1:8001"
    /// The Docker stack reports its websocket host as localhost. Rewrite it to this build's origin host.
    static let rewriteLocalhost = true
    static let pushPlatform = "ios-sandbox"
    #else
    static let defaultOrigin = "https://portal.tmantoinelaw.com"
    static let rewriteLocalhost = false
    static let pushPlatform = "ios"
    #endif

    /// Contains "Safari" and "iPhone"/"iPad" so Security settings can name the device.
    static var userAgent: String {
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let os = UIDevice.current.systemVersion.replacingOccurrences(of: ".", with: "_")
        return "Mozilla/5.0 (\(device); CPU \(device) OS \(os) like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 TMAPortal/\(version)"
    }

    static var deviceName: String {
        "\(UIDevice.current.model) \(UIDevice.current.systemVersion)"
    }

    static func url(_ path: String) -> String {
        origin + (path.hasPrefix("/") ? path : "/" + path)
    }

    static var originURL: URL? { URL(string: origin) }

    /// Host a debug build should use in place of localhost / 127.0.0.1 for the websocket.
    static var rewriteHost: String? {
        guard rewriteLocalhost, let host = originURL?.host, !host.isEmpty else { return nil }
        return host
    }
}
