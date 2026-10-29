import SwiftUI
import UIKit
import UserNotifications
import WebKit

@main
struct TMAPortalApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = PortalModel()

    var body: some Scene {
        WindowGroup {
            PortalRootView(model: model)
                .onOpenURL { model.handleOpenURL($0) }
        }
    }
}

struct PortalRootView: View {
    @ObservedObject var model: PortalModel

    var body: some View {
        ZStack {
            PortalWebView(webView: model.webView)
            if model.showSplash {
                BootSplash()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.24), value: model.showSplash)
        .preferredColorScheme(model.dark ? .dark : .light)
        .alert(model.notice?.title ?? "", isPresented: noticePresented) {
            Button("OK", role: .cancel) { model.notice = nil }
        } message: {
            Text(model.notice?.message ?? "")
        }
        .alert("A new version is available", isPresented: updatePresented) {
            Button("Update") { model.openUpdate() }
            Button("Later", role: .cancel) { model.deferUpdate() }
        } message: {
            Text("Version \(model.updateOffer?.version ?? "") is ready to install.")
        }
    }

    private var noticePresented: Binding<Bool> {
        Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })
    }

    private var updatePresented: Binding<Bool> {
        Binding(get: { model.updateOffer != nil }, set: { if !$0, model.updateOffer != nil { model.deferUpdate() } })
    }
}

/// The desktop splash: `--color-primary-dark`, the wordmark, an indeterminate bar.
private struct BootSplash: View {
    var body: some View {
        ZStack {
            Color(red: 0x13 / 255, green: 0x6D / 255, blue: 0xA0 / 255)
            VStack(spacing: 28) {
                Text("TM ANTOINE")
                    .font(.system(size: 22, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(.white)
                SplashBar()
                    .frame(width: 180, height: 4)
            }
        }
        .ignoresSafeArea()
    }
}

private struct SplashBar: View {
    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let x = CGFloat((t.truncatingRemainder(dividingBy: 1.3)) / 1.3)
            GeometryReader { geo in
                Capsule().fill(Color.white.opacity(0.25))
                Capsule()
                    .fill(Color.white)
                    .frame(width: geo.size.width * 0.45)
                    .offset(x: (geo.size.width * 1.2) * x - geo.size.width * 0.35)
            }
            .clipShape(Capsule())
        }
    }
}

struct PortalWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        let answer = UNNotificationAction(identifier: "ANSWER", title: "Answer", options: [.foreground])
        let decline = UNNotificationAction(identifier: "DECLINE", title: "Decline", options: [.destructive])
        let calls = UNNotificationCategory(identifier: "CALL", actions: [answer, decline], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([calls])
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        Task { @MainActor in AppBridge.model?.becameActive() }
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        Task { @MainActor in AppBridge.model?.sceneInactive() }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppBridge.token = token
        Task { @MainActor in AppBridge.model?.pushTokenArrived(token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        Task { @MainActor in AppBridge.model?.remotePush(userInfo) }
        completionHandler(.newData)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if UIApplication.shared.applicationState == .active {
            completionHandler([])
        } else {
            completionHandler([.banner, .sound, .badge])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            AppBridge.model?.notificationResponse(response)
            completionHandler()
        }
    }
}
