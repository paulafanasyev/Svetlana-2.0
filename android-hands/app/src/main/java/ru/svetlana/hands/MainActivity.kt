package ru.svetlana.hands

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast

/** Главное окно: тот же чат Светланы (с живым аватаром), что на компьютере, но ядро и модель — в этом телефоне. */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var splash: LinearLayout
    private lateinit var splashText: TextView
    private var voice: VoiceBridge? = null
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val main = Handler(Looper.getMainLooper())
    private var loaded = false
    private var waitingSince = 0L
    private var restarted = false
    private var onboarded = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CoreConfig.load(this) // пароль и порт ядра появятся до запуска службы
        CoreService.start(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.BG) }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(Ui.dp(this@MainActivity, 8), Ui.dp(this@MainActivity, 4), Ui.dp(this@MainActivity, 8), Ui.dp(this@MainActivity, 4)); setBackgroundColor(android.graphics.Color.WHITE) }
        fun gap() = View(this).also { bar.addView(it, LinearLayout.LayoutParams(Ui.dp(this, 6), 1)) }
        bar.addView(Ui.chip(this, "🧠 Модель ИИ") { startActivity(Intent(this, ModelsActivity::class.java)) }); gap()
        bar.addView(Ui.chip(this, "🖐 Экран и руки") { startActivity(Intent(this, HandsActivity::class.java)) }); gap()
        bar.addView(Ui.chip(this, "⟳") { if (loaded) web.reload() })
        root.addView(bar, Ui.lp())
        val stack = FrameLayout(this)
        web = WebView(this)
        stack.addView(web, FrameLayout.LayoutParams(-1, -1))
        splash = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Ui.BG) }
        splash.addView(ProgressBar(this)); splashText = Ui.text(this, "Светлана просыпается…", 16f).apply { gravity = Gravity.CENTER }; splash.addView(splashText, Ui.lp())
        stack.addView(splash, FrameLayout.LayoutParams(-1, -1))
        root.addView(stack, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root); Ui.insets(root)

        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false; allowFileAccess = false; allowContentAccess = false; setSupportMultipleWindows(false) }
        voice = VoiceBridge(this, web).also { it.askMic = { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1) }; web.addJavascriptInterface(it, "SvetlanaAndroid") }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean = route(req.url)
            override fun onPageFinished(view: WebView, url: String?) { splash.visibility = View.GONE }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, p: WebChromeClient.FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                return runCatching { startActivityForResult(Intent.createChooser(i, "Фото для Светланы"), 2); true }.getOrElse { fileCb = null; false }
            }
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 3)
        waitForCore()
    }

    /** Ждём ядро, входим без пароля, подключаем «Руки» этого телефона и открываем чат. */
    private fun waitForCore() {
        if (waitingSince == 0L) waitingSince = System.currentTimeMillis()
        Thread {
            val ok = CoreApi.health(this) != null
            if (!ok) {
                val sec = (System.currentTimeMillis() - waitingSince) / 1000
                if (sec >= 30 && !restarted) { restarted = true; CoreService.start(this) } // служба могла перезапускаться
                main.post { splashText.text = if (sec < 8) "Светлана просыпается…" else "Первый запуск готовит ядро (до минуты)… $sec с" }
                main.postDelayed({ waitForCore() }, 700); return@Thread
            }
            val cookie = CoreApi.loginCookie(this)
            val prefs = Prefs(this)
            if (!prefs.remote) CoreApi.ensureDevice(this, prefs)
            // первый запуск: ни модели, ни облачного ключа — сразу показываем выбор (иначе Светлане нечем думать)
            val welcome = !onboarded && CoreConfig.load(this).optString("llm", "").isBlank() && CoreApi.providersEmpty(this)
            main.post {
                val base = CoreConfig.base(this)
                if (cookie != null) { CookieManager.getInstance().setCookie(base, "$cookie; Path=/"); CookieManager.getInstance().flush() }
                HandsService.instance?.connect()
                web.loadUrl("$base/"); loaded = true; waitingSince = 0L; restarted = false
                if (welcome) { onboarded = true; startActivity(Intent(this, ModelsActivity::class.java).putExtra("welcome", true)) }
            }
        }.start()
    }

    /** Чат — здесь; запущенные проекты (127.0.0.1:другой порт) — в окне просмотра; файлы — в «Загрузки»; остальное — в браузере. */
    private fun route(u: Uri): Boolean {
        val base = Uri.parse(CoreConfig.base(this))
        val local = u.host == "127.0.0.1" || u.host == "localhost"
        if (local && u.port == base.port) {
            if (u.path?.startsWith("/api/artifacts/") == true) { download(u); return true }
            return false
        }
        if (local && u.scheme == "http") { startActivity(Intent(this, PreviewActivity::class.java).setData(u)); return true }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
        return true
    }

    /** Документ из чата → «Загрузки/Светлана» и сразу открыть. Качаем сами: пароль ядра не уходит системному загрузчику. */
    private fun download(u: Uri) {
        val name = Uri.decode(u.lastPathSegment ?: "файл").replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val path = u.encodedPath ?: return
        Toast.makeText(this, "Сохраняю «$name»…", Toast.LENGTH_SHORT).show()
        Thread {
            val bytes = CoreApi.fetchBytes(this, path)
            val mime = when (name.substringAfterLast('.').lowercase()) { "pdf" -> "application/pdf"; "html" -> "text/html"; "csv" -> "text/csv"; "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "mp4" -> "video/mp4"; else -> "application/octet-stream" }
            val saved: Uri? = if (bytes == null) null else runCatching {
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = android.content.ContentValues().apply { put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name); put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime); put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Светлана") }
                    val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)!!
                    contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }; uri
                } else { val f = java.io.File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name); f.writeBytes(bytes); Uri.fromFile(f) }
            }.getOrNull()
            main.post {
                when {
                    saved == null -> Toast.makeText(this, "Не удалось сохранить «$name»", Toast.LENGTH_LONG).show()
                    Build.VERSION.SDK_INT >= 29 -> runCatching { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(saved, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
                        .onFailure { Toast.makeText(this, "«$name» сохранён в Загрузки/Светлана", Toast.LENGTH_LONG).show() }
                    else -> Toast.makeText(this, "«$name» сохранён: ${saved.path}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 2) return
        val uris = mutableListOf<Uri>()
        if (resultCode == RESULT_OK && data != null) { data.clipData?.let { c -> for (i in 0 until c.itemCount) uris += c.getItemAt(i).uri }; if (uris.isEmpty()) data.data?.let { uris += it } }
        fileCb?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray()); fileCb = null
    }

    override fun onResume() { super.onResume(); if (loaded) Thread { if (CoreApi.health(this) == null) main.post { loaded = false; splash.visibility = View.VISIBLE; waitForCore() } }.start() }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() { voice?.destroy(); web.destroy(); super.onDestroy() }
}
