import BackgroundTasks
import UIKit

/// Keeping the copy for offline current while the app is not on screen.
///
/// The copy is made by the page (public/js/offline-download.js): once in
/// full, then kept current, fetching only what changed. On a phone that work
/// used to stop the moment the app left the screen, and coming back an hour
/// later found it where it was. Three things keep it going:
///
/// - Leaving the screen part way through a run, the app asks iOS for the
///   extra time it gives an app on its way out, and the run carries on.
/// - A background app refresh, asked for every time the app leaves the
///   screen: iOS wakes the app every so often (when it judges best: the phone
///   learns when the app is used) and the page catches up.
/// - A background processing task for the longer work (the documents),
///   which iOS runs when the phone is idle, and given the chance, charging.
///
/// iOS decides when these run, and gives each a limited time; a run cut
/// short simply carries on from where it stopped next time.
enum BackgroundSync {
    static let refreshID = "com.tmantoinelaw.portal.refresh"
    static let downloadID = "com.tmantoinelaw.portal.download"

    /// At launch, before it finishes: BGTaskScheduler's rule.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshID, using: nil) { task in
            run(task, limit: 25)
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: downloadID, using: nil) { task in
            run(task, limit: 240)
        }
    }

    /// The app left the screen: ask to be woken to keep the copy current.
    static func schedule() {
        let refresh = BGAppRefreshTaskRequest(identifier: refreshID)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(refresh)

        let download = BGProcessingTaskRequest(identifier: downloadID)
        download.requiresNetworkConnectivity = true
        download.requiresExternalPower = false
        download.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60)
        try? BGTaskScheduler.shared.submit(download)
    }

    /// Leaving the screen part way through a run: the time iOS allows an app
    /// on its way out, spent finishing it.
    @MainActor
    static func holdWhileLeaving(_ model: PortalModel) {
        var token = UIBackgroundTaskIdentifier.invalid
        let end = {
            guard token != .invalid else { return }
            UIApplication.shared.endBackgroundTask(token)
            token = .invalid
        }
        token = UIApplication.shared.beginBackgroundTask(withName: "offline-copy") { end() }
        Task { @MainActor in
            _ = await model.runOfflineSync(limit: 25)
            end()
        }
    }

    private static func run(_ task: BGTask, limit: TimeInterval) {
        schedule() // the next one, whatever happens to this one
        let state = Completion(task)
        task.expirationHandler = { state.finish(false) }
        Task { @MainActor in
            let ok = await AppBridge.model?.runOfflineSync(limit: limit) ?? false
            state.finish(ok)
        }
    }

    /// A task is completed once: by the run or by iOS calling time, whichever first.
    private final class Completion {
        private let task: BGTask
        private var done = false
        private let lock = NSLock()

        init(_ task: BGTask) { self.task = task }

        func finish(_ ok: Bool) {
            lock.lock()
            defer { lock.unlock() }
            guard !done else { return }
            done = true
            task.setTaskCompleted(success: ok)
        }
    }
}
