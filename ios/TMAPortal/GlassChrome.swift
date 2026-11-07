import SwiftUI
import UIKit

/*
 * The bottom bar and the header's bubbles, in the system's Liquid Glass.
 *
 * A web page can only imitate Liquid Glass, and it cannot see the settings
 * that change it: the look chosen in Settings > Display & Brightness > Liquid
 * Glass (Clear or Tinted), and Reduce Transparency, Increase Contrast and
 * Reduce Motion in Accessibility. Apple applies those to its own material and
 * publishes no way to read the first. So on iOS 26 and later the app draws
 * these pieces itself, with SwiftUI's glassEffect, and they follow the device
 * the way every system bar does.
 *
 * The page stays in charge of what is there. public/js/glass-chrome.js sends
 * where each bubble sits and what it holds: its buttons, their icons, which
 * tab is open, the counts, whether something covers it. This draws that over
 * the page, in the same place. A tap here clicks the page's own button, so
 * the page's handlers run exactly as they would for a tap on the page. The
 * page's copies stay in place, invisible, holding their space.
 */

// MARK: - What the page sends

/// A rectangle as the page measures it, `[x, y, width, height]` in CSS pixels.
struct PageRect: Decodable, Equatable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    init(from decoder: Decoder) throws {
        var list = try decoder.unkeyedContainer()
        x = try list.decode(Double.self)
        y = try list.decode(Double.self)
        width = try list.decode(Double.self)
        height = try list.decode(Double.self)
    }
}

struct GlassBadge: Decodable, Equatable {
    var text: String
    /// Relative to its group.
    var rect: PageRect
    var background: String?
    var foreground: String?
}

/// One thing drawn on a search bar: an icon, or words the page drew in its
/// own font, placed where the page has them.
struct GlassMark: Decodable, Equatable {
    /// An id into the icons the page has sent.
    var icon: String
    /// Relative to its item.
    var rect: PageRect
    /// In its own colours (a photo) instead of the glass's ink.
    var original: Bool
    /// How strongly it is inked: "primary", "secondary" or "tertiary".
    var tone: String?

    enum CodingKeys: String, CodingKey { case icon, rect, original, tone }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        icon = try c.decode(String.self, forKey: .icon)
        rect = try c.decode(PageRect.self, forKey: .rect)
        original = try c.decodeIfPresent(Bool.self, forKey: .original) ?? false
        tone = try c.decodeIfPresent(String.self, forKey: .tone)
    }
}

/// A small coloured dot, the presence status.
struct GlassDot: Decodable, Equatable {
    var color: String
    /// Relative to its item.
    var rect: PageRect
}

struct GlassItem: Decodable, Equatable, Identifiable {
    /// The page's handle for the button; a tap sends it back.
    var key: String
    var label: String
    /// Relative to its group.
    var rect: PageRect
    /// An id into the icons the page has sent.
    var icon: String?
    /// Relative to the item.
    var iconRect: PageRect?
    /// Draw the icon in its own colours (a logo, a photo) instead of as a
    /// symbol in the bar's ink.
    var original: Bool
    var round: Bool
    var dot: GlassDot?
    var text: String?
    var badge: GlassBadge?
    /// The open tab.
    var active: Bool
    /// The button's popup is open.
    var expanded: Bool
    /// A search bar's face, in place of a single icon.
    var marks: [GlassMark]

    var id: String { key }

    enum CodingKeys: String, CodingKey {
        case key, label, rect, icon, iconRect, original, round, dot, text, badge, active, expanded, marks
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        rect = try c.decode(PageRect.self, forKey: .rect)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        iconRect = try c.decodeIfPresent(PageRect.self, forKey: .iconRect)
        original = try c.decodeIfPresent(Bool.self, forKey: .original) ?? false
        round = try c.decodeIfPresent(Bool.self, forKey: .round) ?? false
        dot = try c.decodeIfPresent(GlassDot.self, forKey: .dot)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        badge = try c.decodeIfPresent(GlassBadge.self, forKey: .badge)
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? false
        expanded = try c.decodeIfPresent(Bool.self, forKey: .expanded) ?? false
        marks = try c.decodeIfPresent([GlassMark].self, forKey: .marks) ?? []
    }
}

struct GlassGroup: Decodable, Equatable, Identifiable {
    var id: String
    /// The bottom bar (tabs, one open), as opposed to a bubble of buttons.
    var bar: Bool
    /// A search bar. It hands over to the page's own field (while it is typed
    /// in) and back without a fade, so the two never show at once.
    var field: Bool
    var rect: PageRect
    var radius: Double
    /// False while something on the page covers it (a sheet, the menu).
    var shown: Bool
    /// Shown, but under a clear layer of the page's that takes the taps (the
    /// tap-outside-to-close layer of an open menu): taps go through to it.
    var inert: Bool
    /// What its containers' opacity leaves of it, while they fade.
    var opacity: Double
    var items: [GlassItem]

    enum CodingKeys: String, CodingKey {
        case id, bar, field, rect, radius, shown, inert, opacity, items
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        bar = try c.decodeIfPresent(Bool.self, forKey: .bar) ?? false
        field = try c.decodeIfPresent(Bool.self, forKey: .field) ?? false
        rect = try c.decode(PageRect.self, forKey: .rect)
        radius = try c.decodeIfPresent(Double.self, forKey: .radius) ?? 0
        shown = try c.decodeIfPresent(Bool.self, forKey: .shown) ?? true
        inert = try c.decodeIfPresent(Bool.self, forKey: .inert) ?? false
        opacity = try c.decodeIfPresent(Double.self, forKey: .opacity) ?? 1
        items = try c.decodeIfPresent([GlassItem].self, forKey: .items) ?? []
    }
}

struct GlassChromeState: Decodable, Equatable {
    /// The page's layout width in CSS pixels.
    var width: Double
    /// The visual viewport against the layout one: `[left, top, scale]`.
    var viewport: [Double]
    /// Content is scrolled up under the header.
    var scrolled: Bool
    var groups: [GlassGroup]

    enum CodingKeys: String, CodingKey {
        case width, viewport, scrolled, groups
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        width = try c.decode(Double.self, forKey: .width)
        viewport = try c.decodeIfPresent([Double].self, forKey: .viewport) ?? [0, 0, 1]
        scrolled = try c.decodeIfPresent(Bool.self, forKey: .scrolled) ?? false
        groups = try c.decodeIfPresent([GlassGroup].self, forKey: .groups) ?? []
    }

    /// Every icon the state draws, search bars' marks included.
    var iconIDs: Set<String> {
        Set(groups.flatMap { $0.items.flatMap { item in item.marks.map(\.icon) + [item.icon].compactMap { $0 } } })
    }

    /// What appears and disappears with a fade: the bar and the header's
    /// bubbles, and the soft edge. Search bars and moves are left out, so a
    /// search bar hands over without a fade and glass follows the page's own
    /// movements frame by frame.
    var fading: [String] {
        groups.filter { !$0.field }.map { "\($0.id):\($0.shown):\($0.inert)" } + ["edge:\(scrolled)"]
    }
}

/// One message from glass-chrome.js. `state` is null when there is nothing
/// to draw (a desktop-width layout, a page without the bar). `icons` carries
/// only those the page has not sent before: a PNG data URL, or an address
/// for a picture the page could not copy (another site's photo).
struct GlassMessage: Decodable {
    var state: GlassChromeState?
    var icons: [String: String]?
}

// MARK: - From the page's pixels to the screen's points

struct PageMapping: Equatable {
    /// Points per CSS pixel at the page's own zoom.
    var scale: CGFloat
    var origin: CGPoint
    var zoom: CGFloat

    /// The overlay covers the web view exactly, so its width is the web
    /// view's. A pinch zoom shifts and scales what the page measures.
    init(state: GlassChromeState, size: CGSize) {
        let viewport = state.viewport
        scale = state.width > 0 ? size.width / CGFloat(state.width) : 1
        origin = CGPoint(x: viewport.count > 0 ? viewport[0] : 0, y: viewport.count > 1 ? viewport[1] : 0)
        zoom = viewport.count > 2 && viewport[2] > 0 ? CGFloat(viewport[2]) : 1
    }

    /// A rectangle measured against the page's viewport, on screen.
    func rect(_ r: PageRect) -> CGRect {
        CGRect(
            x: (CGFloat(r.x) - origin.x) * zoom * scale,
            y: (CGFloat(r.y) - origin.y) * zoom * scale,
            width: CGFloat(r.width) * zoom * scale,
            height: CGFloat(r.height) * zoom * scale
        )
    }

    /// A rectangle measured inside a group (or an item): no viewport shift.
    func local(_ r: PageRect) -> CGRect {
        let k = zoom * scale
        return CGRect(x: CGFloat(r.x) * k, y: CGFloat(r.y) * k, width: CGFloat(r.width) * k, height: CGFloat(r.height) * k)
    }

    func length(_ value: Double) -> CGFloat { CGFloat(value) * zoom * scale }
}

// MARK: - Colours and pictures as the page writes them

enum PageColor {
    /// `#rgb`, `#rrggbb`, `rgb(r, g, b)` and `rgba(r, g, b, a)`, the forms
    /// getComputedStyle and the page's own styles produce.
    static func rgba(_ css: String) -> (r: Double, g: Double, b: Double, a: Double)? {
        let s = css.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("#") {
            let hex = String(s.dropFirst())
            let full = hex.count == 3 ? hex.map { "\($0)\($0)" }.joined() : hex
            guard full.count == 6, let n = UInt32(full, radix: 16) else { return nil }
            return (Double((n >> 16) & 0xFF) / 255, Double((n >> 8) & 0xFF) / 255, Double(n & 0xFF) / 255, 1)
        }
        guard s.hasPrefix("rgb"), let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") else { return nil }
        let parts = s[s.index(after: open)..<close]
            .split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
            .compactMap { Double($0) }
        guard parts.count >= 3 else { return nil }
        return (parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.count > 3 ? parts[3] : 1)
    }

    static func color(_ css: String?, fallback: Color) -> Color {
        guard let css, let c = rgba(css), c.a > 0 else { return fallback }
        return Color(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: c.a)
    }
}

enum PageImage {
    /// A `data:image/...;base64,` URL as the page's canvas writes it. The
    /// page draws at three times its CSS size.
    static func decode(dataURL: String, scale: CGFloat = 3) -> UIImage? {
        guard dataURL.hasPrefix("data:image/"), let comma = dataURL.firstIndex(of: ","),
              dataURL[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data, scale: scale)
    }
}

// MARK: - The model

@MainActor
final class GlassChrome: ObservableObject {
    @Published private(set) var state: GlassChromeState?
    @Published private(set) var icons: [String: UIImage] = [:]

    /// Clicks the page's button for a key (PortalModel).
    var onTap: ((String) -> Void)?
    /// Asks the page to send every icon again, when one never arrived.
    var onMissingIcons: (() -> Void)?

    private var fetching: Set<String> = []
    private var asked: Set<String> = []

    /// Liquid Glass is iOS 26 and later. Before that the page draws its own.
    static var available: Bool {
        if #available(iOS 26.0, *) { return true }
        return false
    }

    func receive(_ json: String) {
        guard let data = json.data(using: .utf8),
              let message = try? JSONDecoder().decode(GlassMessage.self, from: data) else { return }
        for (id, source) in message.icons ?? [:] where icons[id] == nil {
            load(id, from: source)
        }
        if state != message.state {
            // A fade when something appears or goes; Reduce Motion keeps it short.
            if (state?.fading ?? []) != (message.state?.fading ?? []) {
                let fade: Animation = UIAccessibility.isReduceMotionEnabled ? .easeInOut(duration: 0.15) : .smooth(duration: 0.24)
                withAnimation(fade) { state = message.state }
            } else {
                state = message.state
            }
        }
        let missing = (message.state?.iconIDs ?? [])
            .subtracting(icons.keys).subtracting(fetching).subtracting(asked)
        if !missing.isEmpty {
            asked.formUnion(missing)
            onMissingIcons?()
        }
    }

    /// A new page: nothing of the old one stays on screen.
    func reset() {
        state = nil
        asked = []
    }

    func tap(_ key: String) {
        onTap?(key)
    }

    private func load(_ id: String, from source: String) {
        if let image = PageImage.decode(dataURL: source) {
            icons[id] = image
            return
        }
        guard let url = URL(string: source), url.scheme == "https" || url.scheme == "http" else { return }
        fetching.insert(id)
        Task {
            let data = try? await URLSession.shared.data(from: url).0
            fetching.remove(id)
            if let data, let image = UIImage(data: data) { icons[id] = image }
        }
    }
}

// MARK: - Drawing

/// A capsule when the radius reaches halfway across, else a rounded rectangle.
struct GlassShape: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        if radius >= min(rect.width, rect.height) / 2 - 0.5 {
            return Capsule(style: .continuous).path(in: rect)
        }
        return RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: rect)
    }
}

@available(iOS 26.0, *)
struct GlassChromeOverlay: View {
    @ObservedObject var chrome: GlassChrome

    /*
     * The page's viewport is the safe area: the web view keeps its content
     * clear of the status bar and the home indicator, and what the page
     * measures starts at the safe area's corner. So this lays out in the safe
     * area too (only the keyboard is ignored: it does not move the page's
     * viewport), and the glass lands where the page's own copies sit.
     */
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if let state = chrome.state {
                    let map = PageMapping(state: state, size: geo.size)
                    let shown = state.groups.filter(\.shown)
                    ScrollEdge(state: state, map: map)
                    GlassEffectContainer(spacing: 0) {
                        ZStack(alignment: .topLeading) {
                            ForEach(shown) { group in
                                GlassGroupView(group: group, map: map, chrome: chrome)
                            }
                        }
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                    }
                    // Counts sit on top of the glass, not in it, as the
                    // system's do: inside the container they took on the glass.
                    ForEach(shown) { group in
                        GlassBadges(group: group, map: map)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            // The page reports its own transitions frame by frame and the
            // glass follows them; appearing and going fade (GlassChrome.receive).
        }
        .ignoresSafeArea(.keyboard)
    }
}

/// The soft edge iOS puts under a bar when content scrolls beneath it: what
/// is under the status bar and the header's bubbles blurs and fades, so the
/// clock and the buttons stay legible. Only while something is scrolled up.
@available(iOS 26.0, *)
private struct ScrollEdge: View {
    let state: GlassChromeState
    let map: PageMapping

    var body: some View {
        let header = state.groups.filter { !$0.bar && $0.shown }.map { map.rect($0.rect).maxY }.max()
        if state.scrolled, let bottom = header {
            // Up under the status bar as well, past the top of the safe area.
            GeometryReader { geo in
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask(
                        LinearGradient(
                            stops: [
                                .init(color: .black, location: 0),
                                .init(color: .black.opacity(0.85), location: 0.55),
                                .init(color: .clear, location: 1),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: geo.size.width, height: geo.safeAreaInsets.top + bottom + 16)
            }
            .ignoresSafeArea(.container, edges: .top)
            .allowsHitTesting(false)
            .transition(.opacity)
            .accessibilityHidden(true)
        }
    }
}

@available(iOS 26.0, *)
private struct GlassGroupView: View {
    let group: GlassGroup
    let map: PageMapping
    @ObservedObject var chrome: GlassChrome

    var body: some View {
        let frame = map.rect(group.rect)
        content
            .frame(width: frame.width, height: frame.height)
            .glassEffect(.regular.interactive(), in: GlassShape(radius: map.length(group.radius)))
            .opacity(group.opacity)
            .allowsHitTesting(!group.inert)
            // A search input's glass passes taps to the page's input, which
            // VoiceOver reaches directly; a search button is a button here.
            .accessibilityHidden(group.field && group.inert)
            .position(x: frame.midX, y: frame.midY)
            .transition(group.field ? .identity : .opacity.combined(with: .scale(scale: 0.96)))
    }

    @ViewBuilder private var content: some View {
        if group.bar {
            GlassBar(group: group, map: map, chrome: chrome)
        } else {
            ZStack(alignment: .topLeading) {
                ForEach(group.items) { item in
                    let r = map.local(item.rect)
                    Button { chrome.tap(item.key) } label: {
                        GlassItemFace(item: item, map: map, icons: chrome.icons)
                            .frame(width: r.width, height: r.height)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(GlassButtonStyle(on: item.expanded))
                    .accessibilityLabel(item.label)
                    .position(x: r.midX, y: r.midY)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }
}

/// A group's counts, in the page's own colours, over its glass. The buttons'
/// labels already carry the counts for VoiceOver.
@available(iOS 26.0, *)
private struct GlassBadges: View {
    let group: GlassGroup
    let map: PageMapping

    var body: some View {
        let frame = map.rect(group.rect)
        ZStack(alignment: .topLeading) {
            ForEach(group.items) { item in
                if let badge = item.badge {
                    let r = map.local(badge.rect)
                    Text(badge.text)
                        .font(.system(size: max(9, r.height * 0.64), weight: .semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .foregroundStyle(PageColor.color(badge.foreground, fallback: .white))
                        .padding(.horizontal, 3)
                        .frame(minWidth: r.width, minHeight: r.height)
                        .background(Capsule().fill(PageColor.color(badge.background, fallback: .red)))
                        .position(x: r.midX, y: r.midY)
                }
            }
        }
        .frame(width: frame.width, height: frame.height, alignment: .topLeading)
        .opacity(group.opacity)
        .position(x: frame.midX, y: frame.midY)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .transition(.opacity)
    }
}

/// A button in a header bubble. Pressed, and while its popup is open, it sits
/// in a soft platter, as a selected item in a system toolbar does.
@available(iOS 26.0, *)
private struct GlassButtonStyle: ButtonStyle {
    var on: Bool
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                Capsule(style: .continuous)
                    .fill(Color.primary.opacity(contrast == .increased ? 0.18 : 0.09))
                    .padding(3)
                    .opacity(configuration.isPressed || on ? 1 : 0)
            }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.smooth(duration: 0.18), value: configuration.isPressed)
    }
}

/// The bottom bar. The open tab sits in a platter; pressing the bar brings the
/// platter under the finger, it follows a drag across the tabs, and letting go
/// opens the tab underneath, as the system's bar does.
@available(iOS 26.0, *)
private struct GlassBar: View {
    let group: GlassGroup
    let map: PageMapping
    @ObservedObject var chrome: GlassChrome

    @State private var fingerX: CGFloat?
    @State private var chosen: String?
    @State private var chosenAt = Date.distantPast
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Cell {
        let item: GlassItem
        let rect: CGRect
    }

    var body: some View {
        let frame = map.rect(group.rect)
        let cells = group.items.map { Cell(item: $0, rect: map.local($0.rect)) }
        ZStack(alignment: .topLeading) {
            if let platter = platterRect(cells, height: frame.height) {
                Capsule(style: .continuous)
                    .fill(Color.primary.opacity(contrast == .increased ? 0.16 : 0.08))
                    .frame(width: platter.width, height: platter.height)
                    .scaleEffect(fingerX != nil && !reduceMotion ? 1.06 : 1)
                    .position(x: platter.midX, y: platter.midY)
                    .animation(platterAnimation, value: platter)
                    .accessibilityHidden(true)
            }
            ForEach(cells, id: \.item.key) { cell in
                GlassItemFace(item: cell.item, map: map, icons: chrome.icons)
                    .frame(width: cell.rect.width, height: cell.rect.height)
                    .position(x: cell.rect.midX, y: cell.rect.midY)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(cell.item.label)
                    .accessibilityAddTraits(cell.item.active ? [.isButton, .isSelected] : .isButton)
                    .accessibilityAction { chrome.tap(cell.item.key) }
            }
        }
        .frame(width: frame.width, height: frame.height)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { fingerX = $0.location.x }
                .onEnded { value in
                    fingerX = nil
                    // Let go well off the bar and nothing opens.
                    let reach = CGRect(origin: .zero, size: frame.size).insetBy(dx: -12, dy: -28)
                    guard reach.contains(value.location),
                          let hit = cells.min(by: { abs($0.rect.midX - value.location.x) < abs($1.rect.midX - value.location.x) })
                    else { return }
                    if !hit.item.active {
                        chosen = hit.item.key
                        chosenAt = Date()
                    }
                    chrome.tap(hit.item.key)
                }
        )
        .accessibilityElement(children: .contain)
        .onChange(of: group.items.first(where: \.active)?.key) { _, key in
            if key == chosen { chosen = nil }
        }
    }

    private var platterAnimation: Animation? {
        if reduceMotion { return nil }
        return fingerX != nil
            ? .interactiveSpring(response: 0.22, dampingFraction: 0.82)
            : .spring(response: 0.36, dampingFraction: 0.8)
    }

    /// Under the finger while pressed; on the tab just chosen until the page
    /// opens it (so it does not slide back and then forward again); else on
    /// the open tab.
    private func platterRect(_ cells: [Cell], height: CGFloat) -> CGRect? {
        guard let first = cells.first else { return nil }
        let width = min(first.rect.width - 4, map.length(76))
        let platterHeight = max(0, height - map.length(8))
        let centerX: CGFloat
        if let fingerX, let lo = cells.map(\.rect.midX).min(), let hi = cells.map(\.rect.midX).max() {
            centerX = min(max(fingerX, lo), hi)
        } else if let chosen, Date().timeIntervalSince(chosenAt) < 0.8,
                  let cell = cells.first(where: { $0.item.key == chosen }) {
            centerX = cell.rect.midX
        } else if let cell = cells.first(where: { $0.item.active }) {
            centerX = cell.rect.midX
        } else {
            return nil
        }
        return CGRect(x: centerX - width / 2, y: (height - platterHeight) / 2, width: width, height: platterHeight)
    }
}

/// An item's face: its icon (in the bar's ink, or in its own colours for a
/// logo or a photo), a status dot, or a short label.
@available(iOS 26.0, *)
private struct GlassItemFace: View {
    let item: GlassItem
    let map: PageMapping
    let icons: [String: UIImage]

    var body: some View {
        let box = map.local(item.rect)
        ZStack(alignment: .topLeading) {
            if !item.marks.isEmpty {
                ForEach(Array(item.marks.enumerated()), id: \.offset) { _, mark in
                    if let image = icons[mark.icon] {
                        let r = map.local(mark.rect)
                        markImage(image, mark)
                            .frame(width: r.width, height: r.height)
                            .position(x: r.midX, y: r.midY)
                    }
                }
            } else if let id = item.icon, let image = icons[id] {
                let r = item.iconRect.map { map.local($0) }
                    ?? CGRect(x: (box.width - 24) / 2, y: (box.height - 24) / 2, width: 24, height: 24)
                icon(image)
                    .frame(width: r.width, height: r.height)
                    .clipShape(GlassShape(radius: item.round ? r.width / 2 : 0))
                    .position(x: r.midX, y: r.midY)
            } else if let dot = item.dot {
                let r = map.local(dot.rect)
                Circle()
                    .fill(PageColor.color(dot.color, fallback: .green))
                    .frame(width: r.width, height: r.height)
                    .position(x: r.midX, y: r.midY)
            } else if let text = item.text {
                Text(text)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(width: box.width, height: box.height)
            }
        }
        .frame(width: box.width, height: box.height, alignment: .topLeading)
    }

    @ViewBuilder private func icon(_ image: UIImage) -> some View {
        if item.original {
            Image(uiImage: image).resizable().scaledToFill()
        } else {
            Image(uiImage: image).renderingMode(.template).resizable().scaledToFit().foregroundStyle(.primary)
        }
    }

    /// A search bar's icon or words, inked by the glass's own hierarchy so
    /// they stay legible over whatever is underneath and with Increase Contrast.
    @ViewBuilder private func markImage(_ image: UIImage, _ mark: GlassMark) -> some View {
        if mark.original {
            Image(uiImage: image).resizable().scaledToFit()
        } else {
            switch mark.tone {
            case "secondary":
                Image(uiImage: image).renderingMode(.template).resizable().foregroundStyle(.secondary)
            case "tertiary":
                Image(uiImage: image).renderingMode(.template).resizable().foregroundStyle(.tertiary)
            default:
                Image(uiImage: image).renderingMode(.template).resizable().foregroundStyle(.primary)
            }
        }
    }
}
