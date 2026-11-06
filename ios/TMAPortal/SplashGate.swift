import Foundation

/// Whether the boot splash covers the web view.
///
/// It is for the first page only. It lifts once that page is ready (the
/// document has loaded, the load finished, or it failed and an offline or
/// error page is up), never stays longer than `limit`, and does not come back
/// for later navigations. It used to cover every navigation until the page and
/// every image on it had finished, with no limit, so one slow request, or a
/// page that reloads itself, left the app on the splash for good. The desktop
/// splash has had the same limit for the same reason (desktop/splash.js).
struct SplashGate {
    /// Long enough that a fast load does not flash the splash.
    static let minimum: TimeInterval = 0.42
    /// However the first page is doing, the splash goes after this.
    static let limit: TimeInterval = 8

    private(set) var risen = false
    private(set) var booted = false

    var showing: Bool { !risen || !booted }

    /// The minimum time has passed.
    mutating func rise() { risen = true }

    /// The first page is ready, or has failed into a page of our own.
    mutating func pageReady() { booted = true }

    /// The limit has passed: lift it whatever the page is doing.
    mutating func timedOut() {
        risen = true
        booted = true
    }
}
