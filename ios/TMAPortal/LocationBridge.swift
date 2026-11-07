import CoreLocation
import Foundation

/// Location for the page, answered by iOS instead of the web view.
///
/// A WKWebView asks "Allow “portal.tmantoinelaw.com” to use your current
/// location?" on every launch and never keeps the answer. preload.js replaces
/// navigator.geolocation, and the geolocation answer of
/// navigator.permissions.query, with calls into here, so the only question
/// left is the app's own location permission: asked once, kept by iOS, and
/// changed under Settings > TM ANTOINE Portal > Location.
@MainActor
final class LocationBridge: NSObject, CLLocationManagerDelegate {
    /// Runs JavaScript in the page. Set by PortalModel.
    var evaluate: ((String) -> Void)?
    /// The permission changed, so pages loaded from now on must start from it.
    var permissionChanged: (() -> Void)?

    struct Request {
        let id: Int
        let highAccuracy: Bool
        /// Milliseconds, as the page passes them. Zero means none.
        let timeout: Double
        let maximumAge: Double
        let watch: Bool
    }

    /// One reading, in the shape of a web GeolocationPosition.
    struct Fix: Sendable {
        let latitude: Double
        let longitude: Double
        let accuracy: Double
        let altitude: Double?
        let altitudeAccuracy: Double?
        let heading: Double?
        let speed: Double?
        /// Milliseconds since 1970, as DOMTimeStamp is.
        let timestamp: Double

        init(latitude: Double, longitude: Double, accuracy: Double, altitude: Double? = nil, altitudeAccuracy: Double? = nil,
             heading: Double? = nil, speed: Double? = nil, timestamp: Double) {
            self.latitude = latitude
            self.longitude = longitude
            self.accuracy = accuracy
            self.altitude = altitude
            self.altitudeAccuracy = altitudeAccuracy
            self.heading = heading
            self.speed = speed
            self.timestamp = timestamp
        }

        init(_ location: CLLocation) {
            self.init(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                accuracy: location.horizontalAccuracy,
                altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
                altitudeAccuracy: location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil,
                heading: location.course >= 0 ? location.course : nil,
                speed: location.speed >= 0 ? location.speed : nil,
                timestamp: location.timestamp.timeIntervalSince1970 * 1000
            )
        }

        var json: String {
            let object: [String: Any] = [
                "latitude": latitude,
                "longitude": longitude,
                "accuracy": accuracy,
                "altitude": altitude ?? NSNull(),
                "altitudeAccuracy": altitudeAccuracy ?? NSNull(),
                "heading": heading ?? NSNull(),
                "speed": speed ?? NSNull(),
                "timestamp": timestamp,
            ]
            let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
            return String(data: data, encoding: .utf8) ?? "{}"
        }
    }

    private let manager = CLLocationManager()
    private var awaitingPermission: [Request] = []
    private var oneShots: [Int: Request] = [:]
    private var watches: [Int: Request] = [:]
    private var last: Fix?

    private static let deniedMessage = "Location is turned off for TM ANTOINE Portal in Settings."

    override init() {
        super.init()
        manager.delegate = self
    }

    /// "granted", "denied" or "prompt", as navigator.permissions reports it.
    var state: String { Self.state(for: manager.authorizationStatus) }

    nonisolated static func state(for status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedWhenInUse, .authorizedAlways: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    /// getCurrentPosition (watch false) or watchPosition (watch true).
    func request(_ request: Request) {
        if !request.watch, request.maximumAge > 0, let last,
           Date().timeIntervalSince1970 * 1000 - last.timestamp <= request.maximumAge {
            resolve(request.id, last)
            return
        }
        switch state {
        case "denied":
            reject(request.id, code: 1, Self.deniedMessage)
        case "prompt":
            // The system asks once; locationManagerDidChangeAuthorization
            // carries on with the answer.
            awaitingPermission.append(request)
            manager.requestWhenInUseAuthorization()
        default:
            start(request)
        }
    }

    /// clearWatch.
    func clear(id: Int) {
        watches[id] = nil
        awaitingPermission.removeAll { $0.id == id }
        stopIfIdle()
    }

    private func start(_ request: Request) {
        if request.watch { watches[request.id] = request } else { oneShots[request.id] = request }
        let precise = oneShots.values.contains { $0.highAccuracy } || watches.values.contains { $0.highAccuracy }
        manager.desiredAccuracy = precise ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        manager.startUpdatingLocation()

        guard !request.watch, request.timeout > 0 else { return }
        let id = request.id
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(request.timeout * 1_000_000))
            guard let self, self.oneShots.removeValue(forKey: id) != nil else { return }
            self.reject(id, code: 3, "Timed out finding your location.")
            self.stopIfIdle()
        }
    }

    private func stopIfIdle() {
        if oneShots.isEmpty && watches.isEmpty { manager.stopUpdatingLocation() }
    }

    private func resolve(_ id: Int, _ fix: Fix) {
        evaluate?("window.__tmaGeo && window.__tmaGeo.resolve(\(id), \(fix.json))")
    }

    private func reject(_ id: Int, code: Int, _ message: String) {
        evaluate?("window.__tmaGeo && window.__tmaGeo.reject(\(id), \(code), \(Self.jsonString(message)))")
    }

    nonisolated static func jsonString(_ value: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
        let array = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }

    // MARK: - CLLocationManagerDelegate (delivered on the main thread, where the manager was made)

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let fix = Fix(location)
        Task { @MainActor [weak self] in self?.delivered(fix) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        Task { @MainActor [weak self] in self?.failed(code) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.authorizationChanged() }
    }

    private func delivered(_ fix: Fix) {
        last = fix
        let answered = Array(oneShots.keys)
        oneShots.removeAll()
        for id in answered { resolve(id, fix) }
        for id in watches.keys { resolve(id, fix) }
        stopIfIdle()
    }

    private func failed(_ code: CLError.Code?) {
        // No fix yet is not a failure; the timeout decides when to give up.
        if code == .locationUnknown { return }
        let denied = code == .denied
        let affected = Array(oneShots.keys) + Array(watches.keys)
        oneShots.removeAll()
        if denied { watches.removeAll() }
        for id in affected {
            reject(id, code: denied ? 1 : 2, denied ? Self.deniedMessage : "Your location could not be found.")
        }
        stopIfIdle()
    }

    private func authorizationChanged() {
        evaluate?("window.__tmaGeo && window.__tmaGeo.state(\(Self.jsonString(state)))")
        permissionChanged?()
        guard state != "prompt" else { return }
        let waiting = awaitingPermission
        awaitingPermission.removeAll()
        for request in waiting {
            if state == "granted" { start(request) } else { reject(request.id, code: 1, Self.deniedMessage) }
        }
    }
}
