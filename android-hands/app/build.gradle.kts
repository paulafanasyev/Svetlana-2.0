import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

// ---------- что встраиваем в APK ----------
// Node.js для Android (ядро Светланы работает прямо в телефоне) и llama.cpp (модель без интернета, только 64-бит).
val nodeVer = "18.20.4"
val nodeZipUrl = "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v$nodeVer/nodejs-mobile-v$nodeVer-android.zip"
val llamaTag = "b10486"
val llamaUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$llamaTag/llama-$llamaTag-bin-android-arm64.tar.gz"

val cache = rootProject.file(".cache").apply { mkdirs() }
fun download(url: String, to: File): File {
    if (to.isFile && to.length() > 1_000_000) return to
    println("скачиваю $url")
    var u = url; var hops = 0
    while (true) {
        val c = URI(u).toURL().openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false; c.connectTimeout = 30000; c.readTimeout = 120000
        c.setRequestProperty("User-Agent", "svetlana-build")
        val code = c.responseCode
        if (code in 300..399 && hops++ < 8) { u = c.getHeaderField("Location"); c.disconnect(); continue }
        if (code != 200) throw GradleException("не скачалось $url: HTTP $code")
        val tmp = File(to.path + ".part"); c.inputStream.use { i -> tmp.outputStream().use { o -> i.copyTo(o) } }
        tmp.renameTo(to); return to
    }
}

// libnode.so + заголовки
val nodeDir = File(cache, "nodejs-mobile-$nodeVer")
if (!File(nodeDir, "ok").exists()) {
    val zip = download(nodeZipUrl, File(cache, "nodejs-mobile-$nodeVer.zip"))
    copy { from(zipTree(zip)); into(nodeDir) }
    File(nodeDir, "ok").writeText("ok")
}
val nodeRoot: File = nodeDir.walkTopDown().first { File(it, "include/node/node.h").isFile && File(it, "bin/arm64-v8a/libnode.so").isFile }

// llama-server и его библиотеки → jniLibs/arm64-v8a (исполняемый файл кладём как lib*.so: Android 10+ запускает только из папки библиотек)
val jniOut = layout.buildDirectory.dir("generated/svjni").get().asFile
val llamaDir = File(cache, "llama-$llamaTag")
if (!File(llamaDir, "ok").exists()) {
    val tgz = download(llamaUrl, File(cache, "llama-$llamaTag-android-arm64.tar.gz"))
    copy { from(tarTree(resources.gzip(tgz))); into(llamaDir) }
    File(llamaDir, "ok").writeText("ok")
}
run {
    val files = llamaDir.walkTopDown().filter { it.isFile }.toList()
    println("::notice title=llama.cpp $llamaTag::" + files.joinToString(", ") { it.relativeTo(llamaDir).path }.take(1500))
    val arm = File(jniOut, "arm64-v8a").apply { mkdirs() }
    val server = files.firstOrNull { it.name == "llama-server" } ?: throw GradleException("в архиве llama.cpp нет llama-server")
    server.copyTo(File(arm, "libllama_server.so"), overwrite = true)
    for (f in files) if (Regex("^lib.+\\.so$").matches(f.name) && f.name != "libc++_shared.so") f.copyTo(File(arm, f.name), overwrite = true)
    for (abi in listOf("arm64-v8a", "armeabi-v7a")) File(nodeRoot, "bin/$abi/libnode.so").copyTo(File(jniOut, "$abi/libnode.so").apply { parentFile.mkdirs() }, overwrite = true)
}

// ---------- ядро Светланы (тот же код, что на ПК и сервере) → assets/core.zip ----------
val coreSrc = rootProject.file("../core")
val genAssets = layout.buildDirectory.dir("generated/svassets").get().asFile
val genRes = layout.buildDirectory.dir("generated/svres").get().asFile
val skip = Regex("^(test|desktop-agent|training|node_modules|data|scripts)(/|$)|^(Dockerfile|docker-compose\\.yml|\\.env.*|\\.dockerignore)$")
val coreFiles = coreSrc.walkTopDown().filter { it.isFile }.map { it to it.relativeTo(coreSrc).invariantSeparatorsPath }.filter { !skip.containsMatchIn(it.second) }.sortedBy { it.second }.toList()
val coreHash = MessageDigest.getInstance("SHA-256").run { for ((f, rel) in coreFiles) { update(rel.toByteArray()); update(f.readBytes()) }; digest().joinToString("") { "%02x".format(it) }.take(16) }
run {
    File(genAssets, "core.version").apply { parentFile.mkdirs() }.writeText(coreHash)
    @Suppress("UNCHECKED_CAST") val pics = groovy.json.JsonSlurper().parse(File(coreSrc, "web/assets.b64.json")) as Map<String, String>
    ZipOutputStream(File(genAssets, "core.zip").outputStream()).use { z ->
        fun put(name: String, bytes: ByteArray) { z.putNextEntry(ZipEntry(name)); z.write(bytes); z.closeEntry() }
        for ((f, rel) in coreFiles) put(rel, f.readBytes())
        for ((name, b64) in pics) put("web/$name", Base64.getDecoder().decode(b64))  // как scripts/restore-assets.mjs
        val face = rootProject.file("../public/images/avatar/svetlana-master.jpg")  // живой аватар: портрет с оснасткой лица
        if (face.isFile) put("web/svetlana-face.jpg", face.readBytes())
    }
    // значок приложения — та же Светлана
    val icon = Base64.getDecoder().decode(pics["icon-192.png"] ?: pics.values.first())
    File(genRes, "mipmap/ic_launcher.png").apply { parentFile.mkdirs() }.writeBytes(icon)
}

// Постоянный ключ подписи — только из секрета GitHub (репозиторий публичный, ключ в нём хранить нельзя).
// Без секрета сборка подписывается временным отладочным ключом: новую версию тогда придётся ставить после удаления старой.
val keystoreB64 = System.getenv("SVETLANA_KEYSTORE_B64")?.takeIf { it.isNotBlank() }
val keystore = keystoreB64?.let { b -> layout.buildDirectory.file("svetlana.keystore").get().asFile.apply { parentFile.mkdirs(); writeBytes(Base64.getMimeDecoder().decode(b)) } }
if (keystore == null) println("::warning title=подпись::нет секрета SVETLANA_KEYSTORE_B64 — APK подписан временным ключом, обновление поверх старой версии не встанет")

android {
    namespace = "ru.svetlana.hands"
    compileSdk = 35
    // NDK раннера GitHub: путь и версия должны совпадать (имя папки = версия NDK)
    System.getenv("ANDROID_NDK_LATEST_HOME")?.let { File(it) }?.takeIf { it.isDirectory }?.let { ndkPath = it.path; ndkVersion = it.name }
    defaultConfig {
        applicationId = "ru.svetlana.app"
        minSdk = 26; targetSdk = 35
        versionCode = 10; versionName = "1.0.0"
        buildConfigField("String", "CORE_HASH", "\"$coreHash\"")
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_shared", "-DLIBNODE_DIR=${nodeRoot.absolutePath}") } }
    }
    buildFeatures { buildConfig = true }
    if (keystore != null) signingConfigs { getByName("debug") { storeFile = keystore; storePassword = System.getenv("SVETLANA_KEYSTORE_PASS") ?: "android"; keyAlias = System.getenv("SVETLANA_KEY_ALIAS") ?: "svetlana"; keyPassword = System.getenv("SVETLANA_KEYSTORE_PASS") ?: "android" } }
    buildTypes { release { isMinifyEnabled = false } }
    splits { abi { isEnable = true; reset(); include("arm64-v8a", "armeabi-v7a"); isUniversalApk = true } }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt") } }
    sourceSets["main"].apply { jniLibs.srcDir(jniOut); assets.srcDir(genAssets); res.srcDir(genRes) }
    packaging { jniLibs { useLegacyPackaging = true; pickFirsts += listOf("**/libc++_shared.so", "**/libnode.so") } }
    androidResources { noCompress += listOf("zip") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("com.squareup.okhttp3:okhttp:4.12.0") }
