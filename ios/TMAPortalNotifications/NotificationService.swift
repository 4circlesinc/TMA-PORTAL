import Intents
import UserNotifications

/// Turns a message push into the kind of notification Messages shows: the
/// sender's photo with the app's icon in its corner, the person's (or the
/// group's) name, the message under it, and the Reply box (the MESSAGE
/// category, handled by the app's AppDelegate).
///
/// The server sends the push with mutable-content and a "msg" field
/// (App\Support\Notifications\MessagePush): who wrote, a signed link to their
/// photo, and the group's name when it is one. iOS gives this extension about
/// 30 seconds; if anything goes wrong the push shows as it came, a plain
/// notification that still has its Reply box.
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var deliver: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.lock()
        deliver = contentHandler
        original = request.content
        lock.unlock()

        guard let message = IncomingMessage(userInfo: request.content.userInfo) else {
            finish(request.content)
            return
        }
        Task {
            let photo = await message.photoData()
            finish(await message.notification(from: request.content, photo: photo))
        }
    }

    override func serviceExtensionTimeWillExpire() {
        lock.lock()
        let fallback = original
        lock.unlock()
        if let fallback { finish(fallback) }
    }

    private func finish(_ content: UNNotificationContent) {
        lock.lock()
        let handler = deliver
        deliver = nil
        lock.unlock()
        handler?(content)
    }
}

/// The push's "msg" field.
struct IncomingMessage {
    let conversation: String
    let sender: String
    let name: String
    let photo: URL?
    let group: String?
    let body: String

    init?(userInfo: [AnyHashable: Any]) {
        guard let raw = userInfo["msg"] as? String,
              let data = raw.data(using: .utf8),
              let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let conversation = fields["conversation"] as? String, !conversation.isEmpty,
              let name = fields["name"] as? String, !name.isEmpty else { return nil }
        self.conversation = conversation
        self.sender = fields["sender"] as? String ?? name
        self.name = name
        self.photo = (fields["photo"] as? String).flatMap(URL.init(string:))
        let group = fields["group"] as? String
        self.group = (group?.isEmpty ?? true) ? nil : group
        self.body = fields["body"] as? String ?? ""
    }

    /// The sender's photo, or nil for their initials. A slow or missing photo
    /// must not hold the notification back.
    func photoData() async -> Data? {
        guard let photo, photo.scheme == "https" || photo.scheme == "http" else { return nil }
        var request = URLRequest(url: photo, timeoutInterval: 10)
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              !data.isEmpty, data.count < 5_000_000 else { return nil }
        return data
    }

    func notification(from content: UNNotificationContent, photo: Data?) async -> UNNotificationContent {
        let mutable = (content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        // The person or the group, and the message on its own line.
        mutable.title = group ?? name
        mutable.subtitle = ""
        if !body.isEmpty { mutable.body = body }
        mutable.threadIdentifier = conversation
        mutable.categoryIdentifier = "MESSAGE"

        let person = INPerson(
            personHandle: INPersonHandle(value: "user-\(sender)", type: .unknown),
            nameComponents: PersonNameComponentsFormatter().personNameComponents(from: name),
            displayName: name,
            image: photo.map { INImage(imageData: $0) },
            contactIdentifier: nil,
            customIdentifier: "user-\(sender)",
            isMe: false,
            suggestionType: .none
        )
        let me = INPerson(
            personHandle: INPersonHandle(value: "me", type: .unknown),
            nameComponents: nil, displayName: nil, image: nil,
            contactIdentifier: nil, customIdentifier: nil, isMe: true, suggestionType: .none
        )
        // A group is a conversation with more than one recipient and a name;
        // with no group photo set, the sender's photo is the one shown.
        let intent = INSendMessageIntent(
            recipients: group == nil ? [me] : [me, person],
            outgoingMessageType: .outgoingMessageText,
            content: mutable.body,
            speakableGroupName: group.map { INSpeakableString(spokenPhrase: $0) },
            conversationIdentifier: conversation,
            serviceName: nil,
            sender: person,
            attachments: nil
        )
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()

        return (try? mutable.updating(from: intent)) ?? mutable
    }
}
