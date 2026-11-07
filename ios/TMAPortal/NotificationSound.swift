import UserNotifications

/// The iPhone notification sound chosen in Settings → Notifications
/// (App\Support\Notifications\NotificationSounds on the server).
///
/// "chime" is the TM tone, the portal's chime bundled in Sounds/, and the
/// default. "default" is the Apple tone: the phone's own alert sound, set in
/// iPhone Settings → Sounds & Haptics → Default Alerts. iOS gives apps no way
/// to play the Text Tone (it belongs to Messages) or Apple's other tones, so
/// Default Alerts is the Apple sound an app can follow.
enum NotificationSound {
    static let tm = "chime"
    static let apple = "default"

    /// The bundled file for the TM tone; push payloads name the same file.
    static let files = [tm: "tma-chime.caf"]

    /// nil is silent. A page that names no sound (or one this build does not
    /// know) gets the TM tone, the default.
    static func sound(for choice: String?, silent: Bool) -> UNNotificationSound? {
        if silent || choice == "none" { return nil }
        if choice == apple { return .default }
        return UNNotificationSound(named: UNNotificationSoundName(files[choice ?? tm] ?? files[tm]!))
    }
}
