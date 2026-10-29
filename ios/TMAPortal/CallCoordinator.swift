import AVFoundation
import CallKit
import UIKit

/// Incoming and ongoing calls. CallKit is the iOS twin of Android's CallStyle
/// notification: it is raised when the app is not in front. In front, the
/// page's own incoming card is the one the person sees.
@MainActor
final class CallCoordinator: NSObject, CXProviderDelegate {
    private let provider: CXProvider
    private var uuid: UUID?
    private var phase = ""
    private var caller = "Incoming call"
    private var video = false
    weak var model: PortalModel?

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: .main)
    }

    func update(phase: String, infoJSON: String?) {
        if let infoJSON, !infoJSON.isEmpty { apply(infoJSON: infoJSON) }
        let previous = self.phase
        self.phase = phase
        UIApplication.shared.isIdleTimerDisabled = phase == "ringing" || phase == "active"
        switch phase {
        case "ringing":
            if UIApplication.shared.applicationState != .active { reportIncoming() }
        case "active":
            configureAudio()
            if previous == "ringing", let uuid {
                provider.reportOutgoingCall(with: uuid, connectedAt: Date())
            } else if uuid == nil, UIApplication.shared.applicationState != .active {
                reportOngoing()
            }
        default:
            endReported(reason: .remoteEnded)
            deactivateAudio()
        }
    }

    func leftForeground() {
        if phase == "ringing", uuid == nil { reportIncoming() }
        if phase == "active", uuid == nil { reportOngoing() }
    }

    func reportFromPush(signalJSON: String?) {
        guard UIApplication.shared.applicationState != .active else { return }
        if let signalJSON { apply(signalJSON: signalJSON) }
        phase = "ringing"
        reportIncoming()
    }

    private func apply(infoJSON: String) {
        guard let data = infoJSON.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let name = object["name"] as? String, !name.isEmpty { caller = name }
        video = (object["media"] as? String) == "video"
    }

    /// A push carries the websocket signal, not the page's call-info attribute.
    private func apply(signalJSON: String) {
        guard let data = signalJSON.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let payload = object["payload"] as? [String: Any]
        if let name = payload?["fromName"] as? String, !name.isEmpty { caller = name }
        video = (payload?["media"] as? String) == "video"
    }

    private func reportIncoming() {
        guard uuid == nil else { return }
        let id = UUID()
        uuid = id
        let update = callUpdate()
        provider.reportNewIncomingCall(with: id, update: update) { [weak self] error in
            if error != nil {
                Task { @MainActor in self?.uuid = nil }
            }
        }
        configureAudio()
    }

    private func reportOngoing() {
        guard uuid == nil else { return }
        let id = UUID()
        uuid = id
        let update = callUpdate()
        provider.reportNewIncomingCall(with: id, update: update) { [weak self] error in
            guard error == nil else {
                Task { @MainActor in self?.uuid = nil }
                return
            }
            Task { @MainActor in
                self?.provider.reportOutgoingCall(with: id, connectedAt: Date())
            }
        }
        configureAudio()
    }

    private func callUpdate() -> CXCallUpdate {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: caller)
        update.localizedCallerName = caller
        update.hasVideo = video
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = false
        return update
    }

    private func endReported(reason: CXCallEndedReason) {
        guard let uuid else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
        self.uuid = nil
    }

    private func configureAudio() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
        try? session.setActive(true)
    }

    private func deactivateAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func providerDidReset(_ provider: CXProvider) {
        uuid = nil
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        model?.runCallScript("window.TMAMessagingCalls && TMAMessagingCalls.accept(true)")
        configureAudio()
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let script = phase == "ringing"
            ? "window.TMAMessagingCalls && TMAMessagingCalls.decline()"
            : "window.TMAMessagingCalls && TMAMessagingCalls.end()"
        model?.runCallScript(script)
        phase = ""
        uuid = nil
        UIApplication.shared.isIdleTimerDisabled = false
        deactivateAudio()
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        try? audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
        try? audioSession.setActive(true)
    }
}
