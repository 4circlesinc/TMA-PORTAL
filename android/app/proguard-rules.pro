# kotlinx.serialization keeps its own metadata; nothing else needs rules yet.
-keepattributes *Annotation*, InnerClasses
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

# The page calls these by name (preload.js → TMAAndroidHost); R8 must keep them.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.tmantoinelaw.portal.web.PortalWebHost$HostBridge { *; }
-keep class org.json.** { *; }
