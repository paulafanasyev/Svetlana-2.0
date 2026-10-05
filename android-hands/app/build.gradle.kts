plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "ru.svetlana.hands"
    compileSdk = 35
    defaultConfig { applicationId = "ru.svetlana.hands"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0" }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("com.squareup.okhttp3:okhttp:4.12.0") }
