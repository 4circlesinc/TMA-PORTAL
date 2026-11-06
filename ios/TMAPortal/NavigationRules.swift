import Foundation

/**
 Where a navigation may go, copied from desktop/main.js and the Android shell:
 the portal and the OAuth hosts load in the app, a social sign-in from the
 sign-in page goes to the real browser (Google refuses OAuth inside an
 embedded web view), everything else opens outside.
 */
struct NavigationRules {
    let origin: String

    private let socialRedirect = try! NSRegularExpression(pattern: #"^/auth/social/(google|microsoft|apple)/redirect\b"#)
    private let connectReturns: Set<String> = ["getting-started", "connectors", "profile", "email", "calendar", "onboarding", "account-setup-email"]
    private let authHosts: Set<String> = ["accounts.google.com", "login.microsoftonline.com", "login.live.com", "oauth.googleusercontent.com", "appleid.apple.com"]
    private let connectQuery = ["sync_all", "sync_email", "sync_calendar", "sync_onedrive", "sync_sharepoint"]

    func isPortalURL(_ url: URL) -> Bool { originOf(url) == origin }

    func isAuthURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return authHosts.contains(host)
    }

    func isSocialRedirect(_ url: URL) -> Bool {
        isPortalURL(url) && firstMatch(in: url.path) != nil
    }

    /// A Sign in with Apple link from any page, sign-in or connect. The app
    /// answers it with the system's own sheet rather than Apple's web page.
    func isAppleSignIn(_ url: URL) -> Bool {
        isSocialRedirect(url) && firstMatch(in: url.path) == "apple"
    }

    /// The public legal pages. A new-window link to one opens over the app
    /// (Safari's viewer, Done to come back) instead of replacing the page that
    /// linked to it: the sign-in page's Legal terms only unlock Agree after
    /// both documents are opened, and replacing that page lost the progress.
    func isPublicDocument(_ url: URL) -> Bool {
        guard isPortalURL(url) else { return false }
        let path = url.path.lowercased()
        return ["/terms-of-service", "/privacy-policy"].contains { path == $0 || path.hasPrefix($0 + "/") }
    }

    /// The invitation a sign-up link carries, so the native sheet can keep it.
    func inviteToken(in url: URL) -> String? {
        let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "invite" }?.value
        return (value?.isEmpty ?? true) ? nil : value
    }

    /// "google" or "microsoft" when this link is a sign-in (not a connect) started from the sign-in page.
    func signInProvider(for url: URL, current: URL?) -> String? {
        guard isSocialRedirect(url), !isConnectRedirect(url), let current, isPortalURL(current) else { return nil }
        let path = current.path
        let signingIn = (path == "/" || path.hasPrefix("/auth/")) && !path.hasPrefix("/auth/desktop") && !isConnectPage(path)
        guard signingIn else { return nil }
        return firstMatch(in: url.path)
    }

    private func isConnectPage(_ path: String) -> Bool {
        path == "/auth/getting-started" || path.hasPrefix("/auth/getting-started/")
            || path == "/auth/setup" || path.hasPrefix("/auth/setup/")
    }

    private func isConnectRedirect(_ url: URL) -> Bool {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        if items.contains(where: { connectQuery.contains($0.name) && $0.value != nil }) { return true }
        let ret = items.first { $0.name == "return" }?.value ?? ""
        return connectReturns.contains(ret)
    }

    private func firstMatch(in path: String) -> String? {
        let range = NSRange(path.startIndex..., in: path)
        guard let match = socialRedirect.firstMatch(in: path, range: range), match.numberOfRanges > 1,
              let r = Range(match.range(at: 1), in: path) else { return nil }
        return String(path[r])
    }

    func originOf(_ url: URL) -> String? {
        guard let scheme = url.scheme, let host = url.host else { return nil }
        if let port = url.port, !((scheme == "https" && port == 443) || (scheme == "http" && port == 80)) {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }
}
