import AudioToolbox
import Foundation

/// The page's short tones (a message arriving or sent, a toast, the TM tone
/// preview in Settings), played the way iOS plays a notification tone.
///
/// Played by the page itself, a tone is media to WKWebView: iOS put up its
/// Now Playing panel (the page title, a scrubber, AirPlay) for a one-second
/// chime, and could pause the person's music. A system sound has none of
/// that: no Now Playing, mixes with other audio, and follows the ringer
/// volume and the silent switch. The page asks through TMADesktop.playTone
/// (preload.js); calls keep their own ringtone.
@MainActor
enum PageTone {
    /// The names the page may ask for, and the file each plays (Sounds/).
    static let files = [
        "chime": "tma-chime.caf",   // the TM tone, the same file pushes play
        "system": "tma-system.caf", // the "System" message tone
        "sent": "tma-sent.caf",     // a message sent
        "beep": "tma-beep.caf",     // toasts, and the "Beep" message tone
    ]

    private static var loaded: [String: SystemSoundID] = [:]

    static func play(_ name: String) {
        guard let file = files[name] else { return }
        if loaded[name] == nil, let url = Bundle.main.url(forResource: file, withExtension: nil) {
            var id: SystemSoundID = 0
            if AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError { loaded[name] = id }
        }
        if let id = loaded[name] { AudioServicesPlaySystemSound(id) }
    }
}
