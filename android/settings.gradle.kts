pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "tma-portal-android"

include(":app")
include(":core:common")
include(":core:ui")
include(":core:network")
include(":core:data")
include(":feature:auth")
include(":core:navigation")
include(":core:database")
include(":feature:shell")
include(":feature:notifications")
include(":feature:home")
include(":feature:files")
include(":feature:clients")
