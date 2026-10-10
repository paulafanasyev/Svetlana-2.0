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
    private var loggedAt = -100L
    @Volatile private var destroyed = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CoreConfig.load(this) // пароль и порт ядра появятся до запуска службы
        CoreService.start(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.BG) }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(Ui.dp(this@MainActivity, 8), Ui.dp(this@MainActivity, 4), Ui.dp(this@MainActivity, 8), Ui.dp(this@MainActivity, 4)); setBackgroundColor(android.graphics.Color.WHITE) }
        fun gap() = View(this).also { bar.addView(it, LinearLayout.LayoutParams(Ui.dp(this, 6), 1)) }
        // «Мозг»: тот же мастер, что при первом запуске (модель на телефоне или облако); пока чат не загрузился — нативный экран
        bar.addView(Ui.chip(this, "🧠 Модель ИИ") { openBrain() }); gap()
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
        web.addJavascriptInterface(SetupBridge(this), "SvetlanaSetup") // мастер первого запуска: оценка телефона, модели, облако
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
        if (destroyed) return // окно закрыто — опрос ядра больше не нужен
        if (waitingSince == 0L) waitingSince = System.currentTimeMillis()
        Thread {
            val ok = CoreApi.health(this) != null
            if (destroyed) return@Thread
            if (!ok) {
                val sec = (System.currentTimeMillis() - waitingSince) / 1000
                if (sec >= 30 && !restarted) { restarted = true; CoreService.start(this) } // служба могла перезапускаться
                // ядро долго молчит — показываем его журнал прямо на экране (и в logcat), чтобы было видно, что сломалось
                val tail = if (sec >= 40) coreTail() else ""
                if (tail.isNotEmpty() && sec - loggedAt >= 10) { loggedAt = sec; android.util.Log.w("SvetlanaCore", "ядро не отвечает $sec с\n$tail") }
                main.post {
                    if (destroyed) return@post
                    if (tail.isEmpty()) splashText.text = if (sec < 8) "Светлана просыпается…" else "Первый запуск готовит ядро (до минуты)… $sec с"
                    else { splashText.textSize = 12f; splashText.setTextIsSelectable(true); splashText.text = "Ядро не отвечает уже $sec с. Журнал ниже — нажмите и удерживайте, чтобы скопировать, и пришлите разработчику:\n\n$tail" }
                }
                main.postDelayed({ if (!destroyed) waitForCore() }, 700); return@Thread
            }
            val cookie = CoreApi.loginCookie(this)
            val prefs = Prefs(this)
            if (!prefs.remote) CoreApi.ensureDevice(this, prefs)
            // первый запуск: ни модели, ни облачного ключа — чат сразу открывает мастер (аватар, оценка телефона, модель или облако)
            // модель «выбрана», но не запустилась (ошибка/выключена) — думать всё равно нечем, мастер нужен
            val welcome = !onboarded && !ModelStore.skipped(this) && !ModelStore.usable(this) && CoreApi.providersEmpty(this)
            if (destroyed) return@Thread
            main.post {
                if (destroyed) return@post
                val base = CoreConfig.base(this)
                if (cookie != null) { CookieManager.getInstance().setCookie(base, "$cookie; Path=/"); CookieManager.getInstance().flush() }
                HandsService.instance?.connect()
                if (welcome) onboarded = true
                splashText.textSize = 16f; splashText.setTextIsSelectable(false); loggedAt = -100L
                web.loadUrl(if (welcome) "$base/#setup" else "$base/"); loaded = true; waitingSince = 0L; restarted = false
            }
        }.start()
    }

    /** Хвосты журналов ядра (Node) и службы — для экрана ожидания и logcat. */
    private fun coreTail(): String = listOf("core.log" to "ядро", "core-service.log" to "служба").mapNotNull { (f, name) ->
        tail(java.io.File(filesDir, f), 2048)?.takeLast(700)?.trim()?.takeIf { it.isNotEmpty() }?.let { "— $name —\n$it" }
    }.joinToString("\n\n").ifEmpty { "журналов нет: служба ядра, похоже, не запустилась (проверьте, не ограничен ли фон для приложения)" }

    /** Последние [max] байт файла — без чтения всего журнала в память. */
    private fun tail(f: java.io.File, max: Int): String? = runCatching {
        if (!f.isFile) return@runCatching null
        java.io.RandomAccessFile(f, "r").use { r ->
            val start = maxOf(0L, r.length() - max); r.seek(start)
            val b = ByteArray((r.length() - start).toInt()); r.readFully(b); String(b, Charsets.UTF_8)
        }
    }.getOrNull()

    /** 🧠: мастер в чате (оценка телефона, модели, облако). Страница ещё грузится и мастера нет — нативный экран моделей. */
    private fun openBrain() {
        if (!loaded) { startActivity(Intent(this, ModelsActivity::class.java)); return }
        web.evaluateJavascript("(function(){if(window.svSetup){window.svSetup.open('brain');return 'ok'}return 'no'})()") { r ->
            if (r?.contains("ok") != true) startActivity(Intent(this, ModelsActivity::class.java))
        }
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

    override fun onResume() { super.onResume(); if (loaded) Thread { if (CoreApi.health(this) == null && !destroyed) main.post { if (destroyed) return@post; loaded = false; splash.visibility = View.VISIBLE; waitForCore() } }.start() }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onDestroy() { destroyed = true; main.removeCallbacksAndMessages(null); voice?.destroy(); web.destroy(); super.onDestroy() }
}
