import Foundation

/**
 The desktop's sign-in handoff, unchanged:

   app: verifier = random, challenge = sha256(verifier)   → browser: /auth/desktop/start?challenge=…
   browser: sign in by any method                          → /auth/desktop/finish mints a token
   browser → app: tmaportal://auth?token=…
   app: GET /auth/desktop/claim?token=…&verifier=…         → 302 / with the session cookies

 The token is single use, and the verifier is forgotten the moment it is spent.
 */
enum SignInHandoff {
    enum Claim {
        case success([HTTPCookie])
        case rejected
        case noVerifier
        case offline
    }

    static func startURL(provider: String?) -> URL? {
        let verifier = Pkce.verifier()
        VerifierStore.remember(verifier)
        var parts = ["challenge=\(Pkce.challenge(verifier))"]
        if provider == "google" || provider == "microsoft" {
            parts.append("provider=\(provider!)")
        }
        return URL(string: PortalConfig.url("/auth/desktop/start?\(parts.joined(separator: "&"))"))
    }

    static func cancel() { VerifierStore.forget() }

    static func claim(token: String) async -> Claim {
        guard token.count == 64 else { return .rejected }
        guard let verifier = VerifierStore.stored() else { return .noVerifier }
        VerifierStore.forget()
        guard let url = URL(string: PortalConfig.url("/auth/desktop/claim?token=\(token)&verifier=\(verifier)")) else {
            return .rejected
        }

        let stopped = RedirectStop()
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        let session = URLSession(configuration: config, delegate: stopped, delegateQueue: nil)
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("text/html", forHTTPHeaderField: "Accept")

        do {
            _ = try await session.data(for: request)
        } catch {
            if stopped.redirect == nil { return .offline }
        }

        guard let response = stopped.redirect else { return .offline }
        let location = response.value(forHTTPHeaderField: "Location") ?? ""
        let path = pathOf(location)
        guard response.statusCode == 302 && path.isEmpty else { return .rejected }

        var cookies = session.configuration.httpCookieStorage?.cookies(for: url) ?? []
        if cookies.isEmpty {
            let headers = response.allHeaderFields.reduce(into: [String: String]()) { acc, pair in
                if let key = pair.key as? String, let value = pair.value as? String { acc[key] = value }
            }
            cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        }
        return .success(cookies)
    }

    /// Success is a 302 to the portal root. A 302 to the sign-in page is a refusal.
    static func pathOf(_ location: String) -> String {
        let afterScheme = location.range(of: "://").map { location[$0.upperBound...] }.map(String.init) ?? location
        let afterHost: String
        if let slash = afterScheme.firstIndex(of: "/") {
            afterHost = String(afterScheme[afterScheme.index(after: slash)...])
        } else if afterScheme == location, location.hasPrefix("/") {
            afterHost = String(location.dropFirst())
        } else {
            afterHost = ""
        }
        return afterHost.split(separator: "?").first.map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "/")) } ?? ""
    }
}

private final class RedirectStop: NSObject, URLSessionTaskDelegate {
    var redirect: HTTPURLResponse?

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        redirect = response
        completionHandler(nil)
    }
}
