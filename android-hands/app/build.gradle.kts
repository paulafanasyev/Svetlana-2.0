plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Интерфейс приложения — тот же, что у сайта и Windows: собираем корень репозитория (npm run build)
// и кладём dist в assets/web. WebView открывает его с https://appassets.androidplatform.net (WebViewAssetLoader).
// Нужен Node.js 22+ (как для сайта). Работает и на Windows: npm запускается напрямую, без bash.
val repoRoot: File = rootProject.projectDir.parentFile
val webOut = layout.buildDirectory.dir("generated/web")
val npm = if (System.getProperty("os.name").lowercase().contains("windows")) "npm.cmd" else "npm"

val npmCi by tasks.registering(Exec::class) {
    description = "Ставит зависимости общего интерфейса (npm ci)"
    workingDir = repoRoot
    commandLine(npm, "ci", "--no-audit", "--no-fund")
}

val buildWeb by tasks.registering(Exec::class) {
    description = "Собирает общий интерфейс Светланы (как для сайта и Windows)"
    dependsOn(npmCi)
    workingDir = repoRoot
    commandLine(npm, "run", "build")
    inputs.dir(File(repoRoot, "src"))
    inputs.dir(File(repoRoot, "public"))
    inputs.files(
        File(repoRoot, "package.json"),
        File(repoRoot, "package-lock.json"),
        File(repoRoot, "index.html"),
        File(repoRoot, "vite.config.js"),
        File(repoRoot, "csp.mjs"),
    )
    outputs.dir(File(repoRoot, "dist"))
}

val copyWeb by tasks.registering(Sync::class) {
    dependsOn(buildWeb)
    from(File(repoRoot, "dist"))
    into(layout.buildDirectory.dir("generated/web/web"))
    doLast {
        // Без интерфейса приложение откроется пустым — лучше уронить сборку.
        val index = webOut.get().file("web/index.html").asFile
        check(index.isFile && index.length() > 100) { "Нет собранного интерфейса: $index" }
        val scripts = webOut.get().dir("web/assets").asFile.listFiles { f -> f.name.endsWith(".js") }?.size ?: 0
        check(scripts > 0) { "В сборке интерфейса нет скриптов" }
        println("Интерфейс Светланы в APK: index.html + $scripts js")
    }
}

android {
    namespace = "ru.svetlana.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.svetlana.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 210
        versionName = "2.1.0"
        // Модель речи (ONNX Runtime): только архитектуры реальных телефонов и эмулятора, чтобы APK был меньше.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(webOut.get().asFile)
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    // Распознавание речи на телефоне (GigaAM-v3, как в Windows-версии).
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
}
