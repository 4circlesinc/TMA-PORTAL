import AVFoundation
import CallKit
import PushKit
import UIKit

/// Calls on the phone's own call screen (CallKit), the way a phone call or a
/// WhatsApp call rings: full screen on the lock screen, a banner over other
/// apps, the phone's ringtone, Answer and Decline.
///
/// A call reaches it two ways, and both are the same call (its CallKit id is
/// the ring's signalId, so it rings once):
///
///   - a VoIP push (PushKit). It wakes the app even when it was closed. Apple
///     requires every one to be put on the call screen at once, so a VoIP push
///     never carries a "stop": the phone asks instead, through the push's
///     signed link (PushCallController), every few seconds while it rings;
///   - the page's own ring (`data-tma-call` ringing), when the app is open.
///
/// Answer and Decline land on the page (TMAMessagingCalls.answerFromHost, which
/// also picks up a ring the page never heard because the app was closed). A
/// decline while the page knows nothing of the call goes from here, through
/// the link, without opening the app.
@MainActor
final class CallCoordinator: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
    static let shared = CallCoordinator()

    private struct Call {
        let uuid: UUID
        var signalId: String
        var conversationId: String
        var caller: String
        var video: Bool
        var callUrl: URL?
        /// An outgoing or already-answered call kept alive in the background (reportOngoing).
        var ongoing = false
        /// Answered on this phone, from the call screen or in the page.
        var answeredHere = false
        /// The page published this call: its own phase changes are this call's.
        var pageKnows = false
    }

    private struct RingInfo {
        var signalId: String
        var conversationId: String
        var caller: String
        var video: Bool
    }

    private let provider: CXProvider
    private let controller = CXCallController()
    private var registry: PKPushRegistry?
    private var call: Call?
    private var phase = ""
    private var poll: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    weak var model: PortalModel?

    /// Ringing longer than the caller's own 40 s clock is ringing into nothing.
    private static let ringLimit: UInt64 = 45
    /// How often a phone ringing from a push asks whether it still should.
    /// The office shares one address and a firewall that counts every request,
    /// so this stays modest.
    private static let pollEvery: UInt64 = 3

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

    // MARK: - VoIP push

    /// Called at launch (AppDelegate): PushKit must be listening before a
    /// VoIP push that launched the app is handed over.
    func startVoIP() {
        guard registry == nil else { return }
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.registry = registry
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        MainActor.assumeIsolated {
            AppBridge.voipToken = token
            UserDefaults.standard.set(token, forKey: AppBridge.voipTokenKey)
            AppBridge.model?.voipTokenArrived(token)
        }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        MainActor.assumeIsolated {
            AppBridge.voipToken = nil
            UserDefaults.standard.removeObject(forKey: AppBridge.voipTokenKey)
        }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        let dictionary = payload.dictionaryPayload
        MainActor.assumeIsolated {
            reportFromVoIP(dictionary, completion: completion)
        }
    }

    /// Every VoIP push goes on the call screen at once; Apple stops delivering
    /// them to an app that does not. A ring already there (the page rang it
    /// first) is reported again under the same id, which CallKit answers with
    /// "already exists" and shows nothing new.
    private func reportFromVoIP(_ payload: [AnyHashable: Any], completion: @escaping () -> Void) {
        let callUrl = (payload["callUrl"] as? String).flatMap(URL.init(string:))
        let info = ringInfo(signalJSON: payload["signal"] as? String)
            ?? RingInfo(signalId: UUID().uuidString, conversationId: "", caller: "Incoming call", video: false)
        if var current = call, current.signalId.caseInsensitiveCompare(info.signalId) == .orderedSame {
            if callUrl != nil { current.callUrl = callUrl }
            call = current
            provider.reportNewIncomingCall(with: current.uuid, update: callUpdate(caller: current.caller, video: current.video)) { _ in completion() }
            watch()
            return
        }
        if call != nil {
            // On a call already: the system is told (it must be), and turns it away.
            provider.reportNewIncomingCall(with: UUID(), update: callUpdate(caller: info.caller, video: info.video)) { _ in completion() }
            return
        }
        reportIncoming(info, callUrl: callUrl, pageKnows: false, completion: completion)
    }

    // MARK: - the page

    func update(phase newPhase: String, infoJSON: String?) {
        phase = newPhase
        UIApplication.shared.isIdleTimerDisabled = newPhase == "ringing" || newPhase == "active"
        switch newPhase {
        case "ringing":
            guard let info = ringInfo(infoJSON: infoJSON) else { return }
            if var current = call, sameCall(current, info) {
                // The push put it on the call screen already.
                current.pageKnows = true
                call = current
            } else if call == nil {
                reportIncoming(info, callUrl: nil, pageKnows: true, completion: nil)
            }
        case "active":
            configureAudio()
            if var current = call, !current.ongoing {
                current.pageKnows = true
                if !current.answeredHere {
                    // Answered in the page itself: the call screen is told, so
                    // it stops ringing and shows the call as answered.
                    current.answeredHere = true
                    controller.request(CXTransaction(action: CXAnswerCallAction(call: current.uuid))) { _ in }
                }
                call = current
                stopWatching()
            } else if call == nil, UIApplication.shared.applicationState != .active {
                reportOngoing()
            }
        case "":
            // Every page starts with no call. That is not the end of a call
            // only the push has heard of (the app opened for it).
            guard let current = call, current.pageKnows else { return }
            end(reason: .remoteEnded)
            deactivateAudio()
        default:
            // "ended": the page looked for the push's call, and it is over.
            end(reason: .remoteEnded)
            deactivateAudio()
        }
    }

    func leftForeground() {
        if phase == "active", call == nil { reportOngoing() }
    }

    /// The app came to the front while the call screen rings for a call the
    /// page has not heard of: the page shows it too.
    func appBecameActive() {
        guard let current = call, !current.pageKnows, !current.answeredHere, !current.ongoing else { return }
        run("window.TMAMessagingCalls && TMAMessagingCalls.ringFromHost && TMAMessagingCalls.ringFromHost(\(refJSON(current)))")
    }

    // MARK: - ordinary (alert) call pushes, from a server without VoIP for this phone

    func reportFromAlertPush(_ userInfo: [AnyHashable: Any]) {
        guard UIApplication.shared.applicationState != .active, call == nil,
              let info = ringInfo(signalJSON: userInfo["signal"] as? String) else { return }
        reportIncoming(info, callUrl: (userInfo["callUrl"] as? String).flatMap(URL.init(string:)), pageKnows: false, completion: nil)
    }

    /// The notification's Answer button.
    func answer(fromPush userInfo: [AnyHashable: Any]) {
        let info = ringInfo(signalJSON: userInfo["signal"] as? String)
        let ref = info.map { refJSON(signalId: $0.signalId, conversationId: $0.conversationId) } ?? "{}"
        run("window.TMAMessagingCalls && (TMAMessagingCalls.answerFromHost ? TMAMessagingCalls.answerFromHost(\(ref), true) : TMAMessagingCalls.accept(true))")
    }

    /// The notification's Decline button: through the link when there is one.
    func decline(fromPush userInfo: [AnyHashable: Any]) {
        if let link = (userInfo["callUrl"] as? String).flatMap(URL.init(string:)), let device = AppBridge.callDevice {
            Task { _ = await PushCall.send(link, device: device, action: "decline") }
            return
        }
        let info = ringInfo(signalJSON: userInfo["signal"] as? String)
        let ref = info.map { refJSON(signalId: $0.signalId, conversationId: $0.conversationId) } ?? "{}"
        run("window.TMAMessagingCalls && (TMAMessagingCalls.declineFromHost ? TMAMessagingCalls.declineFromHost(\(ref)) : TMAMessagingCalls.decline())")
    }

    // MARK: - reporting

    private func reportIncoming(_ info: RingInfo, callUrl: URL?, pageKnows: Bool, completion: (() -> Void)?) {
        let uuid = UUID(uuidString: info.signalId) ?? UUID()
        call = Call(uuid: uuid, signalId: info.signalId, conversationId: info.conversationId,
                    caller: info.caller, video: info.video, callUrl: callUrl, pageKnows: pageKnows)
        provider.reportNewIncomingCall(with: uuid, update: callUpdate(caller: info.caller, video: info.video)) { [weak self] error in
            Task { @MainActor in
                if let error, (error as? CXErrorCodeIncomingCallError)?.code != .callUUIDAlreadyExists,
                   self?.call?.uuid == uuid {
                    // Turned away (Do Not Disturb, or nothing to ring with):
                    // the page, if open, still shows it.
                    self?.call = nil
                    self?.stopWatching()
                }
                completion?()
            }
        }
        configureCategory()
        watch()
    }

    private func reportOngoing() {
        guard call == nil else { return }
        let id = UUID()
        call = Call(uuid: id, signalId: "", conversationId: "", caller: "Call", video: false, callUrl: nil, ongoing: true, pageKnows: true)
        provider.reportNewIncomingCall(with: id, update: callUpdate(caller: "Call", video: false)) { [weak self] error in
            Task { @MainActor in
                guard error == nil else {
                    if self?.call?.uuid == id { self?.call = nil }
                    return
                }
                self?.provider.reportOutgoingCall(with: id, connectedAt: Date())
            }
        }
        configureAudio()
    }

    private func callUpdate(caller: String, video: Bool) -> CXCallUpdate {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: caller)
        update.localizedCallerName = caller
        update.hasVideo = video
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = false
        update.supportsDTMF = false
        return update
    }

    private func end(reason: CXCallEndedReason) {
        stopWatching()
        guard let current = call else { return }
        call = nil
        provider.reportCall(with: current.uuid, endedAt: Date(), reason: reason)
    }

    // MARK: - while it rings

    /// The give-up clock, and (for a ring the page cannot hear) the question
    /// whether it is still ringing: answered elsewhere, declined on another
    /// device, or the caller gave up.
    private func watch() {
        timeout?.cancel()
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.ringLimit * 1_000_000_000)
            guard !Task.isCancelled, let self, let current = self.call,
                  !current.answeredHere, !current.ongoing else { return }
            self.end(reason: .unanswered)
        }
        guard poll == nil else { return }
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.pollEvery * 1_000_000_000)
                guard !Task.isCancelled, let self else { return }
                if await !self.stillRinging() { return }
            }
        }
    }

    private func stopWatching() {
        poll?.cancel()
        poll = nil
        timeout?.cancel()
        timeout = nil
    }

    /// False once there is nothing more to watch.
    private func stillRinging() async -> Bool {
        guard let current = call, !current.answeredHere, !current.ongoing else {
            poll = nil
            return false
        }
        // In front, a page that knows the call hears its end on the websocket.
        if current.pageKnows, UIApplication.shared.applicationState == .active { return true }
        guard let link = current.callUrl, let device = AppBridge.callDevice else { return true }
        guard let state = await PushCall.send(link, device: device, action: "state") else { return true }
        guard let now = call, now.uuid == current.uuid, !now.answeredHere else {
            poll = nil
            return false
        }
        if state.ringing { return true }
        poll = nil
        end(reason: state.endedReason)
        deactivateAudio()
        return false
    }

    // MARK: - CXProviderDelegate

    nonisolated func providerDidReset(_ provider: CXProvider) {
        MainActor.assumeIsolated {
            stopWatching()
            call = nil
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        MainActor.assumeIsolated {
            guard var current = call, current.uuid == action.callUUID else {
                action.fail()
                return
            }
            let answeredInPage = current.answeredHere && phase == "active"
            current.answeredHere = true
            call = current
            stopWatching()
            configureAudio()
            if !answeredInPage {
                run("window.TMAMessagingCalls && (TMAMessagingCalls.answerFromHost ? TMAMessagingCalls.answerFromHost(\(refJSON(current)), true) : TMAMessagingCalls.accept(true))")
            }
            action.fulfill()
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        MainActor.assumeIsolated {
            guard let current = call, current.uuid == action.callUUID else {
                action.fulfill()
                return
            }
            stopWatching()
            call = nil
            let ringing = !current.answeredHere && !current.ongoing
            if ringing, let link = current.callUrl, let device = AppBridge.callDevice {
                // Declined on the call screen, without the app: the page, if it
                // has this call, closes it when it hears the decline.
                Task { _ = await PushCall.send(link, device: device, action: "decline") }
            } else if ringing {
                run("window.TMAMessagingCalls && (TMAMessagingCalls.declineFromHost ? TMAMessagingCalls.declineFromHost(\(refJSON(current))) : TMAMessagingCalls.decline())")
            } else {
                run("window.TMAMessagingCalls && TMAMessagingCalls.end()")
            }
            phase = ""
            UIApplication.shared.isIdleTimerDisabled = false
            deactivateAudio()
            action.fulfill()
        }
    }

    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        try? audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
        try? audioSession.setActive(true)
    }

    // MARK: - helpers

    /// A script for the page. With the app launched by a push there may be no
    /// window yet: the page is opened for it, and runs it once it is up.
    private func run(_ script: String) {
        (model ?? PortalModel.shared).runCallScript(script)
    }

    private func sameCall(_ current: Call, _ info: RingInfo) -> Bool {
        if !info.signalId.isEmpty { return current.signalId.caseInsensitiveCompare(info.signalId) == .orderedSame }
        return !info.conversationId.isEmpty && current.conversationId == info.conversationId
    }

    private func refJSON(_ current: Call) -> String {
        refJSON(signalId: current.signalId, conversationId: current.conversationId)
    }

    private func refJSON(signalId: String, conversationId: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: ["signalId": signalId, "conversationId": conversationId])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// The page's `data-tma-call-info`: {name, avatar, media, signalId, conversationId}.
    private func ringInfo(infoJSON: String?) -> RingInfo? {
        guard let object = jsonObject(infoJSON) else { return nil }
        return RingInfo(
            signalId: object["signalId"] as? String ?? "",
            conversationId: object["conversationId"] as? String ?? "",
            caller: (object["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Incoming call",
            video: (object["media"] as? String) == "video"
        )
    }

    /// A push carries the websocket's call.signal: {signalId, conversationId, payload{fromName, media}}.
    private func ringInfo(signalJSON: String?) -> RingInfo? {
        guard let object = jsonObject(signalJSON) else { return nil }
        let payload = object["payload"] as? [String: Any]
        return RingInfo(
            signalId: object["signalId"] as? String ?? UUID().uuidString,
            conversationId: object["conversationId"] as? String ?? "",
            caller: (payload?["fromName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Incoming call",
            video: (payload?["media"] as? String) == "video"
        )
    }

    private func jsonObject(_ raw: String?) -> [String: Any]? {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// While it rings, the category only: CallKit turns the session on when
    /// the call is answered (didActivate).
    private func configureCategory() {
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
    }

    private func configureAudio() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .defaultToSpeaker])
        try? session.setActive(true)
    }

    private func deactivateAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// The ring push's signed link (App\Http\Controllers\PushCallController):
/// whether to go on ringing, and Decline, without the web session.
enum PushCall {
    struct State {
        let ringing: Bool
        let outcome: String?

        var endedReason: CXCallEndedReason {
            switch outcome {
            case "answered": return .answeredElsewhere
            case "declined": return .declinedElsewhere
            case "missed": return .unanswered
            default: return .remoteEnded
            }
        }
    }

    static func send(_ link: URL, device: String, action: String) async -> State? {
        var request = URLRequest(url: link, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["device": device, "action": action])
        // A decline sent as the app leaves the screen still goes.
        let background = await MainActor.run {
            UIApplication.shared.beginBackgroundTask(withName: "tma-call-\(action)", expirationHandler: nil)
        }
        defer { Task { @MainActor in UIApplication.shared.endBackgroundTask(background) } }
        guard let (data, response) = try? await URLSession(configuration: .ephemeral).data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        return State(ringing: (object["ringing"] as? Bool) ?? false, outcome: object["outcome"] as? String)
    }
}
