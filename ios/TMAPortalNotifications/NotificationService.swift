import Intents
import UserNotifications

/// Turns a message or email push into the kind of notification Messages
/// shows, with the app's icon in the corner of the picture and a Reply box
/// (the MESSAGE category, handled by the app's AppDelegate):
///
///   direct message   the sender's photo; their name, then the message
///   group message    the group's photo; who wrote, the group, the message
///   email            the sender's photo; their name, the subject, its start
///   activity         the person's photo; their name, what happened (a file
///                    and its status, a comment), its line. No Reply box.
///
/// The three-line layout is the one iOS gives a group conversation (more than
/// one recipient and a group name): the sender's name, then the group's name,
/// then the message, under the group's picture. An email is given the same
/// shape with its subject as the second line and its sender's photo as the
/// picture, which is the only way iOS puts a line between the name and the
/// body of a message notification.
///
/// The server sends the push with mutable-content and a "msg" field
/// (App\Support\Notifications\MessagePush). iOS gives this extension about
/// 30 seconds; if anything goes wrong the push shows as it came, the same
/// lines without the pictures, Reply box and all.
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
            async let sender = IncomingMessage.download(message.photo)
            async let group = IncomingMessage.download(message.groupPhoto)
            finish(await message.notification(from: request.content, senderPhoto: await sender, groupPhoto: await group))
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
    /// Who wrote it: the first line, and their initials without a photo.
    let name: String
    /// The second line: a group's name, or an email's subject. Nil for a
    /// direct message, which has two lines.
    let subtitle: String?
    let body: String
    let photo: URL?
    let groupPhoto: URL?
    let isEmail: Bool
    /// Something a person did that is not a message: shown under their
    /// photo the same way, but with nothing to reply to.
    let isActivity: Bool
    let message: String?

    init?(userInfo: [AnyHashable: Any]) {
        guard let raw = userInfo["msg"] as? String,
              let data = raw.data(using: .utf8),
              let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let conversation = fields["conversation"] as? String, !conversation.isEmpty,
              let name = fields["name"] as? String, !name.isEmpty else { return nil }
        func text(_ key: String) -> String? {
            let value = (fields[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (value?.isEmpty ?? true) ? nil : value
        }
        self.conversation = conversation
        self.sender = text("sender") ?? name
        self.name = text("title") ?? name
        self.isEmail = text("kind") == "email"
        self.isActivity = text("kind") == "activity"
        self.subtitle = text("subtitle") ?? text("group")
        self.body = (fields["body"] as? String) ?? ""
        self.photo = text("photo").flatMap(URL.init(string:))
        self.groupPhoto = text("groupPhoto").flatMap(URL.init(string:))
        self.message = text("message")
    }

    /// A photo, or nil for initials. A slow or missing one must not hold the
    /// notification back.
    static func download(_ url: URL?) async -> Data? {
        guard let url, url.scheme == "https" || url.scheme == "http" else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              !data.isEmpty, data.count < 5_000_000 else { return nil }
        return data
    }

    func notification(from content: UNNotificationContent, senderPhoto: Data?, groupPhoto: Data?) async -> UNNotificationContent {
        let mutable = (content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        mutable.title = name
        mutable.subtitle = subtitle ?? ""
        mutable.body = body
        mutable.threadIdentifier = conversation
        // The Reply box belongs to messages and emails; an activity opens the
        // portal where it happened when tapped, and that is all.
        mutable.categoryIdentifier = isActivity ? "" : "MESSAGE"

        let person = INPerson(
            personHandle: INPersonHandle(value: sender, type: .unknown),
            nameComponents: PersonNameComponentsFormatter().personNameComponents(from: name),
            displayName: name,
            image: senderPhoto.map { INImage(imageData: $0) },
            contactIdentifier: nil,
            customIdentifier: sender,
            isMe: false,
            suggestionType: .none
        )
        let me = INPerson(
            personHandle: INPersonHandle(value: "me", type: .unknown),
            nameComponents: nil, displayName: nil, image: nil,
            contactIdentifier: nil, customIdentifier: nil, isMe: true, suggestionType: .none
        )

        let intent: INSendMessageIntent
        if let subtitle {
            // Three lines under a picture of the conversation: the group's
            // photo (the sender's when the group has none), or for an email
            // its sender's photo. Each email is its own "conversation", so one
            // subject never stands in for another's.
            intent = INSendMessageIntent(
                recipients: [me, person],
                outgoingMessageType: .outgoingMessageText,
                content: body,
                speakableGroupName: INSpeakableString(spokenPhrase: subtitle),
                // iOS remembers a conversation's name, so an email or an
                // activity whose middle line changes is its own conversation.
                conversationIdentifier: (isEmail || isActivity) ? "\(conversation)|\(message ?? subtitle)" : conversation,
                serviceName: nil,
                sender: person,
                attachments: nil
            )
            // An email or an activity is about the person, so the picture is
            // theirs; a group shows the group's.
            let picture = (isEmail || isActivity) ? senderPhoto : (groupPhoto ?? senderPhoto)
            if let picture {
                intent.setImage(INImage(imageData: picture), forParameterNamed: \.speakableGroupName)
            }
        } else {
            intent = INSendMessageIntent(
                recipients: [me],
                outgoingMessageType: .outgoingMessageText,
                content: body,
                speakableGroupName: nil,
                conversationIdentifier: conversation,
                serviceName: nil,
                sender: person,
                attachments: nil
            )
        }

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()

        return (try? mutable.updating(from: intent)) ?? mutable
    }
}
