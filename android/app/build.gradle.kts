plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// Firebase Cloud Messaging lets the server wake the app for a remote "play
// here" while it is idle. Its config is the Firebase console's
// google-services.json, kept out of the repository:
// FERROTUNE_GOOGLE_SERVICES_JSON names the file, or put it at
// app/google-services.json (ignored by git). Without one, push stays off.
val firebaseConfig: Map<String, String> = run {
    val path = System.getenv("FERROTUNE_GOOGLE_SERVICES_JSON")?.takeIf { it.isNotBlank() }
    val source = path?.let(::file) ?: file("google-services.json")
    if (!source.isFile) return@run emptyMap()
    fun Any?.obj(key: String): Any? = (this as Map<*, *>)[key]
    fun Any?.list(key: String): List<*> = obj(key) as List<*>
    val json = groovy.json.JsonSlurper().parse(source)
    val project = json.obj("project_info")
    val client = json.list("client").first { client ->
        client.obj("client_info").obj("android_client_info").obj("package_name") == "com.ferrotune.music.native"
    }
    val apiKey = client.list("api_key").first().obj("current_key")
    mapOf(
        "FIREBASE_APP_ID" to client.obj("client_info").obj("mobilesdk_app_id").toString(),
        "FIREBASE_API_KEY" to apiKey.toString(),
        "FIREBASE_PROJECT_ID" to project.obj("project_id").toString(),
        "FIREBASE_SENDER_ID" to project.obj("project_number").toString(),
    )
}

android {
    namespace = "com.ferrotune.music"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.ferrotune.music.native"
        minSdk = 24
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = 1
        versionName = "0.1.0"
        for (key in listOf("FIREBASE_APP_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID")) {
            buildConfigField("String", key, "\"${firebaseConfig[key].orEmpty()}\"")
        }
    }

    buildTypes {
        release {
            // R8 matters a lot for Compose: unoptimized builds run the UI
            // noticeably slower, so release (and local deploys) are minified.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:network"))
    implementation(project(":core:datastore"))
    implementation(project(":core:designsystem"))
    implementation(project(":core:media"))
    implementation(project(":core:actions"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:home"))
    implementation(project(":feature:feedback"))
    implementation(project(":feature:library"))
    implementation(project(":feature:player"))
    implementation(project(":feature:playlists"))
    implementation(project(":feature:downloads"))
    implementation(project(":feature:settings"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.mediarouter)
    implementation(libs.play.services.cast.framework)
    implementation(libs.firebase.messaging)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.hilt.lifecycle.viewmodel.compose)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    debugImplementation(libs.androidx.compose.ui.tooling)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.junit)

    testImplementation(project(":core:testing"))
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
