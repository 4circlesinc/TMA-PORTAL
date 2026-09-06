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
    implementation(project(":feature:auth"))
    implementation(project(":core:navigation"))
    implementation(project(":feature:shell"))
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
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
