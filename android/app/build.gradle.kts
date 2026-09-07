import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// Which portal this build talks to. Debug points at the Docker stack through the
// emulator's host alias; release at production. Override either with
//   ./gradlew assembleDebug -PportalOrigin=http://192.168.1.20:8001
val portalOrigin: String? = (project.findProperty("portalOrigin") as String?)?.takeIf { it.isNotBlank() }

/*
 * Firebase for push (docs/android-app-prompt.md §13). The values come from
 * the Firebase console's Android app (the same ones google-services.json
 * carries) via android/firebase.properties or -Pfirebase.*; all blank means
 * push is off and the app builds and runs without it.
 */
val firebaseProps = Properties().apply {
    val f = rootProject.projectDir.resolve("firebase.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
/* The console's google-services.json, dropped into app/ (gitignored), is read directly: no plugin. */
val googleServices: Map<String, String> = run {
    val f = projectDir.resolve("google-services.json")
    if (!f.exists()) return@run emptyMap()
    runCatching {
        val json = groovy.json.JsonSlurper().parse(f) as Map<*, *>
        val info = json["project_info"] as Map<*, *>
        val client = (json["client"] as List<*>).first() as Map<*, *>
        val clientInfo = client["client_info"] as Map<*, *>
        val apiKey = ((client["api_key"] as List<*>).first() as Map<*, *>)["current_key"] as String
        mapOf(
            "projectId" to info["project_id"] as String,
            "senderId" to info["project_number"] as String,
            "appId" to clientInfo["mobilesdk_app_id"] as String,
            "apiKey" to apiKey,
        )
    }.getOrDefault(emptyMap())
}
fun firebase(key: String): String = (project.findProperty("firebase.$key") as String?)
    ?: firebaseProps.getProperty(key)
    ?: googleServices[key]
    ?: ""

android {
    namespace = "com.tmantoinelaw.portal"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.tmantoinelaw.portal"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Push (docs/android-app-prompt.md §13); all blank = off.
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebase("projectId")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${firebase("appId")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebase("apiKey")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${firebase("senderId")}\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "PORTAL_ORIGIN", "\"${portalOrigin ?: "http://10.0.2.2:8001"}\"")
            // The Docker stack reports its websocket host as localhost; the emulator reaches it at 10.0.2.2.
            buildConfigField("boolean", "REWRITE_LOCALHOST", "true")
        }
        release {
            buildConfigField("String", "PORTAL_ORIGIN", "\"${portalOrigin ?: "https://portal.tmantoinelaw.com"}\"")
            buildConfigField("boolean", "REWRITE_LOCALHOST", "false")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:ui"))
    implementation(project(":core:network"))
    implementation(project(":core:data"))
    implementation(libs.androidx.webkit)
    implementation(libs.firebase.messaging)
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(libs.androidx.browser)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.hilt.navigation.compose)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}


/*
 * The page-side bridge is the desktop app's own (desktop/host-bridge.js) so the
 * two shells never drift: it is copied into the APK's assets before every build
 * with the CommonJS wrapper stripped. signin-waiting.html rides along unchanged.
 * Both copies are gitignored.
 */
val copyDesktopBridge = tasks.register<Copy>("copyDesktopBridge") {
    val desktop = rootProject.projectDir.resolve("../desktop")
    from(desktop.resolve("host-bridge.js")) {
        filter { line -> line.replace("module.exports = `", "").replace(Regex("`;\\s*$"), "") }
    }
    from(desktop.resolve("signin-waiting.html"))
    into(projectDir.resolve("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(copyDesktopBridge) }
