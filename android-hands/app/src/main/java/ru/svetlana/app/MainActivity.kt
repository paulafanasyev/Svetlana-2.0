package ru.svetlana.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Светлана для Android: тот же интерфейс, что на сайте и в Windows (собранный dist из корня репозитория),
 * в WebView по адресу https://appassets.androidplatform.net. Ключи, облако, голос и руки — через Bridge.
 *
 * WebView закрыт: без доступа к файлам и content://, без смешанного контента, с Safe Browsing, без отладки;
 * чужие адреса открываются во внешнем браузере (только https, mailto, tel), микрофон — только своей странице.
 * Файлы (экспорт CRM, документы, .ics) сохраняются через системное окно «Сохранить как»: место выбирает человек.
 */
class MainActivity : Activity() {
    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        private const val REQ_AUDIO = 41
        private const val REQ_FILE = 42
        private const val REQ_SAVE = 43
        private const val CONFIRM_TIMEOUT_MIN = 3L
        private const val OUTDATED = "<html><body style='font-family:sans-serif;padding:24px;background:#0b1020;color:#fff'>" +
            "<h2>Обновите Android System WebView</h2>" +
            "<p>Светлане нужен свежий компонент WebView (или Chrome). Обновите его в Google Play и откройте приложение снова.</p>" +
            "</body></html>"
    }

    private class PendingSave(val text: String, val done: Done)

    val main = Handler(Looper.getMainLooper())
    private lateinit var web: WebView
    private var bridge: Bridge? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: PendingSave? = null
    private val audioWaiters = ArrayList<(Boolean) -> Unit>()
    private val confirmLock = Any()
    /** Открытое окно подтверждения (только главный поток). */
    private var confirmDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(false)
        web = WebView(this)
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFF0B1020.toInt())
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 30) {
            // Сами отступаем от строки состояния, жестов и клавиатуры (Android 15 всегда как edge-to-edge).
            window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { v, insets ->
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
                WindowInsets.CONSUMED
            }
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        ) {
            web.loadDataWithBaseURL(null, OUTDATED, "text/html", "utf-8", null)
            return
        }
        bridge = Bridge(this)
        setupWeb()
        web.loadUrl("$ORIGIN/index.html")
    }

    @SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
    private fun setupWeb() {
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.setSupportMultipleWindows(false)
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setGeolocationEnabled(false)
        s.safeBrowsingEnabled = true
        s.mediaPlaybackRequiresUserGesture = true

        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", WebAssets(this))
            .build()

        WebViewCompat.addDocumentStartJavaScript(web, Bridge.SHIM, setOf(ORIGIN))
        WebViewCompat.addWebMessageListener(web, "SvetlanaNative", setOf(ORIGIN)) { _, message, sourceOrigin, isMainFrame, replyProxy ->
            // Только главное окно нашего адреса: iframe и чужие страницы команды не подают.
            if (!isMainFrame || sourceOrigin.toString().trimEnd('/') != ORIGIN) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            bridge?.handle(data) { out -> replyProxy.postMessage(out) }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "https" && u.host == HOST) return false
                if (request.isForMainFrame && u.scheme in setOf("https", "mailto", "tel", "sms")) openExternal(u)
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val res = request.resources
                val audioOnly = res.isNotEmpty() && res.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (!audioOnly || request.origin.toString().trimEnd('/') != ORIGIN) {
                    request.deny()
                    return
                }
                withAudio { ok -> if (ok) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny() }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), REQ_FILE)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }

        web.setDownloadListener { url, _, _, _, _ ->
            val u = runCatching { Uri.parse(url) }.getOrNull()
            if (u != null && u.scheme == "https") openExternal(u)
        }
    }

    private fun openExternal(u: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: ActivityNotFoundException) {
            // нечем открыть — просто ничего не делаем
        }
    }

    fun openAccessibilitySettings() {
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    fun versionName(): String = try {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(packageName, 0).versionName ?: ""
    } catch (e: Exception) {
        ""
    }

    /**
     * Сохранить текстовый файл через системное окно «Сохранить как» (без разрешений на память).
     * Ответ: true — сохранён, false — человек отменил. Вызывать в главном потоке.
     */
    fun saveFile(name: String, mime: String, text: String, done: Done) {
        if (pendingSave != null) { done(false, "Уже сохраняю другой файл"); return }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime)
            .putExtra(Intent.EXTRA_TITLE, name)
        pendingSave = PendingSave(text, done)
        try {
            startActivityForResult(intent, REQ_SAVE)
        } catch (e: ActivityNotFoundException) {
            pendingSave = null
            done(false, "На телефоне нет приложения для сохранения файлов")
        }
    }

    /** Микрофон: спросить разрешение Android, если его ещё нет. Вызывать в главном потоке. */
    fun withAudio(cb: (Boolean) -> Unit) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            cb(true)
            return
        }
        if (isFinishing || isDestroyed) {
            cb(false)
            return
        }
        audioWaiters.add(cb)
        if (audioWaiters.size == 1) requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO)
    }

    /** Всем, кто ждёт микрофон, ответить сразу: ни один запрос не висит бесконечно. */
    private fun drainAudioWaiters(ok: Boolean) {
        val waiting = audioWaiters.toList()
        audioWaiters.clear()
        waiting.forEach { runCatching { it(ok) } }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_AUDIO) return
        val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        drainAudioWaiters(ok)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_SAVE) {
            val p = pendingSave ?: return
            pendingSave = null
            val uri = data?.data
            if (resultCode != RESULT_OK || uri == null) { p.done(true, false); return }
            Thread {
                try {
                    val out = contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("Нет доступа к файлу")
                    out.use { it.write(p.text.toByteArray(Charsets.UTF_8)) }
                    p.done(true, true)
                } catch (e: Exception) {
                    p.done(false, "Не удалось сохранить файл")
                }
            }.start()
            return
        }
        if (requestCode != REQ_FILE) return
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        fileCallback = null
    }

    /**
     * Нативное окно «ОК / Отмена» (как confirm в secure_ai.rs). Вызывается из фонового потока и ждёт ответа.
     * Окна идут по одному; «ОК» не нажимается, если поверх лежит чужое окно (защита от подмены нажатия).
     * Если человек не ответил за 3 минуты — окно закрывается, ответ «Отмена».
     */
    fun confirm(text: String): Boolean {
        check(Looper.myLooper() != Looper.getMainLooper()) { "confirm() нельзя вызывать из главного потока" }
        synchronized(confirmLock) {
            val latch = CountDownLatch(1)
            val ok = AtomicBoolean(false)
            main.post {
                if (isFinishing || isDestroyed) {
                    latch.countDown()
                    return@post
                }
                val d = AlertDialog.Builder(this)
                    .setTitle("Светлана — подтверждение")
                    .setMessage(text)
                    .setCancelable(false)
                    .setPositiveButton("ОК") { _, _ -> ok.set(true) }
                    .setNegativeButton("Отмена", null)
                    .create()
                d.setOnDismissListener {
                    if (confirmDialog === d) confirmDialog = null
                    latch.countDown()
                }
                confirmDialog = d
                d.show()
                d.getButton(AlertDialog.BUTTON_POSITIVE)?.filterTouchesWhenObscured = true
            }
            if (!latch.await(CONFIRM_TIMEOUT_MIN, TimeUnit.MINUTES)) {
                // Не оставляем висеть старое окно: иначе новое встанет за ним.
                ok.set(false)
                main.post { confirmDialog?.dismiss() }
                return false
            }
            return ok.get()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) {
            web.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        if (::web.isInitialized) web.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.onResume()
    }

    override fun onDestroy() {
        confirmDialog?.dismiss()
        confirmDialog = null
        drainAudioWaiters(false)
        pendingSave?.done?.invoke(false, "Приложение закрыто")
        pendingSave = null
        bridge?.close()
        bridge = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
