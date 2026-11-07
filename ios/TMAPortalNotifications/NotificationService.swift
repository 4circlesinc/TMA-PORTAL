import Intents
import UserNotifications

/// Turns a message or email push into the kind of notification Messages
/// shows, laid out the same for all of them: the sender's photo with the app's
/// icon in its corner, one line saying who (the person, the group for a group,
/// the sender of an email), the message under it, and the Reply box (the
/// MESSAGE category, handled by the app's AppDelegate).
///
/// A group is deliberately not given to iOS as a group conversation: iOS then
/// lays it out on three lines, the sender as the title and the group's name
/// under it, then the message. Instead the group's name is the title and the
/// photo is the person who wrote it, the same two lines as any message.
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
    /// Who wrote it, for their initials when there is no photo.
    let name: String
    /// The line that says who: the person, the group, or the email's sender.
    let title: String
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
        let title = fields["title"] as? String ?? ""
        self.title = self.group ?? (title.isEmpty ? name : title)
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
        // Who, then the message on its own line.
        mutable.title = title
        mutable.subtitle = ""
        if !body.isEmpty { mutable.body = body }
        mutable.threadIdentifier = conversation
        mutable.categoryIdentifier = "MESSAGE"

        // The one line iOS shows above the message is the sender's name, so
        // the sender carries the title; the photo and the initials are the
        // person who wrote it. In a group that is a stand-in kept apart from
        // the real person, so a group's name never sticks to anyone.
        let identity = group == nil ? "\(sender)" : "\(conversation)|\(sender)"
        let person = INPerson(
            personHandle: INPersonHandle(value: identity, type: .unknown),
            nameComponents: PersonNameComponentsFormatter().personNameComponents(from: name),
            displayName: title,
            image: photo.map { INImage(imageData: $0) },
            contactIdentifier: nil,
            customIdentifier: identity,
            isMe: false,
            suggestionType: .none
        )
        let me = INPerson(
            personHandle: INPersonHandle(value: "me", type: .unknown),
            nameComponents: nil, displayName: nil, image: nil,
            contactIdentifier: nil, customIdentifier: nil, isMe: true, suggestionType: .none
        )
        // One recipient and no group name: the two-line layout of a direct
        // message, for groups and email too (see the note on the class).
        let intent = INSendMessageIntent(
            recipients: [me],
            outgoingMessageType: .outgoingMessageText,
            content: mutable.body,
            speakableGroupName: nil,
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
