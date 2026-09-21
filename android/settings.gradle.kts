pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
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

rootProject.name = "Ferrotune"

include(":app")
include(":core:model")
include(":core:network")
include(":core:datastore")
include(":core:database")
include(":core:designsystem")
include(":core:media")
include(":core:testing")
include(":feature:auth")
include(":feature:downloads")
include(":feature:settings")
include(":feature:home")
include(":feature:library")
include(":feature:playlists")
include(":feature:player")
