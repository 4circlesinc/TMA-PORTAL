import Foundation
import UserNotifications

/// A message notification's own fields (the push's "msg", from
/// App\Support\Notifications\MessagePush), as far as the app needs them: where
/// tapping it goes, and where a reply is sent. The notification service
/// extension reads the rest (ios/TMAPortalNotifications).
struct MessageNotification {
    let conversation: String
    let name: String
    let url: String?
    let reply: URL?

    init?(userInfo: [AnyHashable: Any]) {
        guard let raw = userInfo["msg"] as? String,
              let data = raw.data(using: .utf8),
              let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let conversation = fields["conversation"] as? String, !conversation.isEmpty else { return nil }
        self.conversation = conversation
        self.name = (fields["group"] as? String) ?? (fields["name"] as? String) ?? "the conversation"
        self.url = fields["url"] as? String
        self.reply = (fields["reply"] as? String).flatMap(URL.init(string:))
    }
}

/// The Reply box on a message notification: typed in Notification Center and
/// sent without opening the app.
///
/// The app may be woken for it in the background with its web session long
/// expired, so it does not use the session: the push carries a signed reply
/// link scoped to this person and conversation, and the server also wants
/// this phone's push token, so signing out of the phone ends it.
enum MessageReply {
    static let categoryIdentifier = "MESSAGE"
    static let actionIdentifier = "REPLY"
    static let tokenKey = "push.token"

    static var category: UNNotificationCategory {
        let reply = UNTextInputNotificationAction(
            identifier: actionIdentifier,
            title: "Reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Message"
        )
        return UNNotificationCategory(identifier: categoryIdentifier, actions: [reply], intentIdentifiers: [], options: [])
    }

    /// This phone's push token, kept so a reply sent before the app has
    /// registered again this launch still has it.
    static var deviceToken: String? {
        AppBridge.token ?? UserDefaults.standard.string(forKey: tokenKey)
    }

    /// The request that sends `text`, or nil when there is nothing to send or
    /// nowhere to send it.
    static func request(for message: MessageNotification, text: String, device: String?) -> URLRequest? {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, let url = message.reply, let device, !device.isEmpty else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(PortalConfig.userAgent, forHTTPHeaderField: "User-Agent")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "body": body,
            "device": device,
            // A retried send is recognised instead of posted twice.
            "nonce": UUID().uuidString.lowercased(),
        ])
        return request
    }

    /// Sends the reply. True when the server took it.
    static func send(_ text: String, for message: MessageNotification, device: String?) async -> Bool {
        guard let request = request(for: message, text: text, device: device) else { return false }
        guard let (_, response) = try? await URLSession(configuration: .ephemeral).data(for: request),
              let http = response as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }

    /// Replying reads the conversation: its other notifications go too.
    static func clearDelivered(for message: MessageNotification) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let ids = delivered
                .filter { $0.request.content.threadIdentifier == message.conversation }
                .map(\.request.identifier)
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    /// A reply that did not go is said so, never silently dropped. Tapping it
    /// opens the conversation; its Reply box can try again.
    static func reportFailure(for message: MessageNotification, userInfo: [AnyHashable: Any]) {
        let content = UNMutableNotificationContent()
        content.title = "Reply not sent"
        content.body = "Your reply to \(message.name) didn't send. Open the conversation to try again."
        content.userInfo = userInfo
        content.threadIdentifier = message.conversation
        content.categoryIdentifier = categoryIdentifier
        content.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "reply-failed-\(message.conversation)", content: content, trigger: nil)
        )
    }
}
