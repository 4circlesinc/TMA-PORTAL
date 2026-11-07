import UserNotifications

/// The iPhone notification sound chosen in Settings → Notifications
/// (App\Support\Notifications\NotificationSounds on the server).
///
/// iOS lets an app play only the phone's default alert tone or sounds the app
/// ships, so the choices are the default (the tone picked in iPhone Settings →
/// Sounds & Haptics), the portal's own two tones in Sounds/, and silence.
enum NotificationSound {
    /// The bundled file for each portal tone; push payloads name the same files.
    static let files = ["chime": "tma-chime.caf", "notification": "tma-notification.caf"]

    /// nil is silent.
    static func sound(for choice: String?, silent: Bool) -> UNNotificationSound? {
        if silent || choice == "none" { return nil }
        if let choice, let file = files[choice] { return UNNotificationSound(named: UNNotificationSoundName(file)) }
        return .default
    }
}
