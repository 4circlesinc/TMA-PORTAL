import ObjectiveC
import UIKit
import WebKit

/// Typing in the portal the way typing in an app is.
///
/// WebKit puts a bar above the keyboard for any field in a page: up and down
/// arrows to hop between fields and a tick to close it (its form assistant).
/// A messaging app has none of that over its composer, so it goes. With the
/// tick gone, dragging the page down puts the keyboard away, as in Messages.
/// (Zooming in on a field is the page's viewport, capped in preload.js.)
enum WebKeyboard {
    private static let suffix = "_TMANoAccessory"

    static func plain(_ webView: WKWebView) {
        webView.scrollView.keyboardDismissMode = .interactive
        hideAccessoryBar(in: webView)
    }

    /// WebKit's content view supplies the bar as its inputAccessoryView. A
    /// subclass of that view that supplies none takes its place; the class is
    /// made once and reused.
    static func hideAccessoryBar(in webView: WKWebView) {
        guard let content = webView.scrollView.subviews.first(where: {
            NSStringFromClass(type(of: $0)).hasPrefix("WKContent")
        }) else { return }

        let base: AnyClass = type(of: content)
        let baseName = NSStringFromClass(base)
        if baseName.hasSuffix(suffix) { return }

        let name = baseName + suffix
        if let made = NSClassFromString(name) {
            object_setClass(content, made)
            return
        }

        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let method = class_getInstanceMethod(UIView.self, selector),
              let subclass = objc_allocateClassPair(base, name, 0) else { return }
        let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        class_addMethod(subclass, selector, imp_implementationWithBlock(none), method_getTypeEncoding(method))
        objc_registerClassPair(subclass)
        object_setClass(content, subclass)
    }

    /// For the tests: whether the bar is gone from this web view.
    static func accessoryBarHidden(in webView: WKWebView) -> Bool {
        guard let content = webView.scrollView.subviews.first(where: {
            NSStringFromClass(type(of: $0)).hasPrefix("WKContent")
        }) else { return false }
        return content.inputAccessoryView == nil && NSStringFromClass(type(of: content)).hasSuffix(suffix)
    }
}
