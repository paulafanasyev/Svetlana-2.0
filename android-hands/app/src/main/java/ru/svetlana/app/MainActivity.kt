package ru.svetlana.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeProvider
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
import java.io.ByteArrayInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * WebView, который замечает «клик» экранного диктора (TalkBack): двойное касание приходит не касанием,
 * а действием ACTION_CLICK к элементу страницы. Скрипт страницы такое действие подать не может.
 */
@SuppressLint("ViewConstructor")
class ClickAwareWebView(ctx: Context, private val onA11yClick: () -> Unit) : WebView(ctx) {
    companion object {
        fun isActivation(action: Int): Boolean =
            action == AccessibilityNodeInfo.ACTION_CLICK || action == AccessibilityNodeInfo.ACTION_LONG_CLICK
    }

    private var inner: AccessibilityNodeProvider? = null
    private var wrapped: AccessibilityNodeProvider? = null

    override fun getAccessibilityNodeProvider(): AccessibilityNodeProvider? {
        val p = super.getAccessibilityNodeProvider() ?: return null
        if (p !== inner) {
            inner = p
            wrapped = ClickTracking(p, onA11yClick)
        }
        return wrapped
    }

    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        if (isActivation(action)) onA11yClick()
        return super.performAccessibilityAction(action, arguments)
    }
}

/** Всё передаёт WebView как есть, только отмечает «клик» диктора. */
private class ClickTracking(private val inner: AccessibilityNodeProvider, private val onClick: () -> Unit) : AccessibilityNodeProvider() {
    override fun createAccessibilityNodeInfo(virtualViewId: Int): AccessibilityNodeInfo? =
        inner.createAccessibilityNodeInfo(virtualViewId)

    override fun findAccessibilityNodeInfosByText(text: String, virtualViewId: Int): MutableList<AccessibilityNodeInfo>? =
        inner.findAccessibilityNodeInfosByText(text, virtualViewId)

    override fun findFocus(focus: Int): AccessibilityNodeInfo? = inner.findFocus(focus)

    override fun performAction(virtualViewId: Int, action: Int, arguments: Bundle?): Boolean {
        if (ClickAwareWebView.isActivation(action)) onClick()
        return inner.performAction(virtualViewId, action, arguments)
    }

    override fun addExtraDataToAccessibilityNodeInfo(virtualViewId: Int, info: AccessibilityNodeInfo, extraDataKey: String, arguments: Bundle?) {
        if (Build.VERSION.SDK_INT >= 26) inner.addExtraDataToAccessibilityNodeInfo(virtualViewId, info, extraDataKey, arguments)
    }
}

/**
 * Светлана для Android: тот же интерфейс, что на сайте и в Windows (собранный dist из корня репозитория),
 * в WebView по адресу https://appassets.androidplatform.net. Ключи, облако, голос и руки — через Bridge.
 *
 * WebView закрыт: без доступа к файлам и content://, без смешанного контента, с Safe Browsing, без отладки;
 * чужие адреса открываются во внешнем браузере (только https, mailto, tel, sms), микрофон — только своей странице,
 * только пока приложение на экране, и первый раз за запуск — только по нажатию.
 * Файлы (экспорт CRM, документы, .ics) сохраняются через системное окно «Сохранить как»: место выбирает человек.
 * Печать и PDF — системное окно печати (документ рисуется в отдельном WebView без JavaScript и без сети).
 * Буфер обмена и микрофон распознавания — только сразу после настоящего нажатия (касание не сквозь чужое окно поверх,
 * Enter или пробел на клавиатуре, клик экранного диктора), одно нажатие — одно действие.
 * Системная кнопка «Назад» сначала закрывает открытое окно страницы (CRM, мастер настройки), и только потом выходит.
 */
class MainActivity : Activity() {
    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        private const val REQ_AUDIO = 41
        private const val REQ_FILE = 42
        private const val REQ_SAVE = 43
        private const val REQ_CONTACTS = 44
        private const val CONFIRM_TIMEOUT_MIN = 3L
        /** Сколько ждать, пока документ для печати отрисуется (дальше — ошибка и освобождение WebView). */
        private const val PRINT_LOAD_TIMEOUT_MS = 15_000L
        const val PRINT_BUSY = "Печать уже открыта: закройте окно печати и попробуйте снова"
        /** Сколько после касания считается «по нажатию» (как user activation в браузере). */
        private const val ACTIVATION_MS = 5_000L
        /** Клавиши, которыми нажимают кнопку без касания (физическая клавиатура, пульт, кнопочный телефон). */
        private val ACTIVATION_KEYS = setOf(
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_SPACE,
            KeyEvent.KEYCODE_DPAD_CENTER,
        )
        /** Спросить страницу: есть ли что закрыть по «Назад» (src/services/BackStack.ts). */
        private const val BACK_JS = "(function(){try{var f=window.__svetlanaBack;return typeof f==='function'&&f()===true;}catch(e){return false;}})()"
        private const val OUTDATED = "<html><body style='font-family:sans-serif;padding:24px;background:#0b1020;color:#fff'>" +
            "<h2>Обновите Android System WebView</h2>" +
            "<p>Светлане нужен свежий компонент WebView (или Chrome). Обновите его в Google Play и откройте приложение снова.</p>" +
            "</body></html>"
        /** Разрешения, которые страница может попросить (через команды моста), и их коды запроса. */
        private val PERM_CODES = mapOf(
            Manifest.permission.RECORD_AUDIO to REQ_AUDIO,
            Manifest.permission.READ_CONTACTS to REQ_CONTACTS,
        )
    }

    private class PendingSave(val text: String, val done: Done)

    /** Адаптер печати WebView с уведомлением: системное окно печати закрыто — документ больше не нужен. */
    private class ReleasingAdapter(private val inner: PrintDocumentAdapter, private val onFinished: () -> Unit) : PrintDocumentAdapter() {
        override fun onStart() = inner.onStart()

        override fun onLayout(
            oldAttributes: PrintAttributes?,
            newAttributes: PrintAttributes?,
            cancellationSignal: CancellationSignal?,
            callback: PrintDocumentAdapter.LayoutResultCallback?,
            extras: Bundle?,
        ) = inner.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras)

        override fun onWrite(
            pages: Array<out PageRange>?,
            destination: ParcelFileDescriptor?,
            cancellationSignal: CancellationSignal?,
            callback: PrintDocumentAdapter.WriteResultCallback?,
        ) = inner.onWrite(pages, destination, cancellationSignal, callback)

        override fun onFinish() {
            try {
                inner.onFinish()
            } finally {
                onFinished()
            }
        }
    }

    val main = Handler(Looper.getMainLooper())
    private lateinit var web: WebView
    private var bridge: Bridge? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: PendingSave? = null
    /** WebView документа для печати: живёт, пока открыто системное окно печати (только главный поток). */
    private var printView: WebView? = null
    /** Единственный путь освобождения printView (окно печати закрыто, таймаут, ошибка или onDestroy): destroy ровно один раз. */
    private var releasePrint: (() -> Unit)? = null
    private val permWaiters = HashMap<String, ArrayList<(Boolean) -> Unit>>()
    private val confirmLock = Any()
    /** Открытое окно подтверждения (только главный поток). */
    private var confirmDialog: AlertDialog? = null
    /** Когда человек последний раз настоящим касанием отпустил палец на экране приложения (или нажал Enter, или клик диктора). */
    @Volatile private var lastTouchAt = 0L
    /** Приложение на экране (между onResume и onPause): в фоне страница микрофон не получает. */
    @Volatile private var resumed = false
    /** Микрофон страницы уже разрешён по нажатию в этом запуске (дальше режим «без рук» слушает сам). Только главный поток. */
    private var micSession = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(false)
        web = ClickAwareWebView(this) { markActivation() }
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
                // В фоне — никогда; первый раз за запуск — только сразу после нажатия (скрипт сам комнату не послушает).
                if (!resumed || !(micSession || activatedRecently())) {
                    request.deny()
                    return
                }
                withAudio { ok ->
                    if (ok) {
                        micSession = true
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        request.deny()
                    }
                }
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

    private fun markActivation() {
        lastTouchAt = SystemClock.uptimeMillis()
    }

    /** Запоминаем настоящие касания (не сквозь чужое окно поверх): только после них можно писать в буфер и слушать. */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_UP && (ev.flags and MotionEvent.FLAG_WINDOW_IS_OBSCURED) == 0) {
            markActivation()
        }
        return super.dispatchTouchEvent(ev)
    }

    /** Enter, пробел или центр джойстика на клавиатуре: тоже настоящее нажатие кнопки (скрипт клавиши не нажимает). */
    override fun dispatchKeyEvent(ev: KeyEvent): Boolean {
        if (ev.action == KeyEvent.ACTION_UP && ev.keyCode in ACTIVATION_KEYS) {
            markActivation()
        }
        return super.dispatchKeyEvent(ev)
    }

    /** Нажатие было только что (не расходует его). */
    private fun activatedRecently(): Boolean {
        val t = lastTouchAt
        return t > 0 && SystemClock.uptimeMillis() - t in 0..ACTIVATION_MS
    }

    /**
     * Человек только что нажал кнопку (как user activation в браузере). Нажатие расходуется:
     * одно нажатие — одно копирование или одна фраза в микрофон. С TalkBack нажатие — это клик диктора
     * (ClickAwareWebView), поэтому особого обхода для диктора нет: скрипт и при включённом TalkBack
     * сам не скопирует и не послушает. Вызывать в главном потоке.
     */
    fun touchedRecently(): Boolean {
        val ok = activatedRecently()
        if (ok) lastTouchAt = 0L
        return ok
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

    /**
     * Печать или PDF: документ рисуется в отдельном WebView без JavaScript, файлов и сети, потом
     * открывается системное окно печати (там же «Сохранить как PDF»). Вызывать в главном потоке.
     * Одно окно за раз; WebView документа освобождается, когда окно печати закрыто, или если
     * документ не отрисовался за 15 секунд (тогда ответ — ошибка, а не вечное ожидание).
     */
    fun printHtml(html: String, title: String, done: Done) {
        if (isFinishing || isDestroyed) { done(false, "Приложение закрыто"); return }
        if (printView != null) { done(false, PRINT_BUSY); return }
        val v = WebView(this)
        printView = v
        val ps = v.settings
        ps.javaScriptEnabled = false
        ps.allowFileAccess = false
        ps.allowContentAccess = false
        ps.blockNetworkLoads = true
        ps.setGeolocationEnabled(false)
        var started = false
        var released = false
        val release = {
            if (!released) {
                released = true
                if (printView === v) printView = null
                releasePrint = null
                v.destroy()
            }
        }
        releasePrint = release
        v.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val scheme = request.url.scheme
                return if (scheme == "data" || scheme == "about") null
                else WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (started || printView !== view) return
                started = true
                try {
                    val pm = getSystemService(Context.PRINT_SERVICE) as PrintManager
                    val job = title.ifBlank { "Светлана" }
                    val adapter = ReleasingAdapter(view.createPrintDocumentAdapter(job)) { main.post { release() } }
                    pm.print(job, adapter, PrintAttributes.Builder().build())
                    done(true, true)
                } catch (e: Exception) {
                    main.post { release() }
                    done(false, "Не удалось открыть печать")
                }
            }
        }
        main.postDelayed({
            if (!started && !released) {
                started = true
                release()
                done(false, "Не удалось подготовить документ к печати")
            }
        }, PRINT_LOAD_TIMEOUT_MS)
        v.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    /** Скопировать текст в буфер обмена телефона. */
    fun copyText(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Светлана", text))
    }

    /** Разрешение Android (микрофон, контакты): спросить, если его ещё нет. Вызывать в главном потоке. */
    fun withPermission(permission: String, cb: (Boolean) -> Unit) {
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            cb(true)
            return
        }
        val code = PERM_CODES[permission]
        if (code == null || isFinishing || isDestroyed) {
            cb(false)
            return
        }
        val list = permWaiters.getOrPut(permission) { ArrayList() }
        list.add(cb)
        if (list.size == 1) requestPermissions(arrayOf(permission), code)
    }

    /** Микрофон: спросить разрешение Android, если его ещё нет. Вызывать в главном потоке. */
    fun withAudio(cb: (Boolean) -> Unit) = withPermission(Manifest.permission.RECORD_AUDIO, cb)

    /** Всем, кто ждёт разрешение, ответить сразу: ни один запрос не висит бесконечно. */
    private fun drainWaiters(permission: String, ok: Boolean) {
        val waiting = permWaiters.remove(permission)?.toList() ?: return
        waiting.forEach { runCatching { it(ok) } }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val permission = PERM_CODES.entries.firstOrNull { it.value == requestCode }?.key ?: return
        val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        drainWaiters(permission, ok)
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
        if (!::web.isInitialized || bridge == null) {
            systemBack()
            return
        }
        // Сначала страница: открытое окно (CRM, Бизнес, Кабинет, мастер настройки) закрывается, а не всё приложение.
        web.evaluateJavascript(BACK_JS) { r ->
            if (r == "true" || isFinishing || isDestroyed) return@evaluateJavascript
            if (web.canGoBack()) web.goBack() else systemBack()
        }
    }

    private fun systemBack() {
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    override fun onPause() {
        resumed = false
        // Ушли с экрана: распознавание телефона не слушает дальше в фоне, старое нажатие не действует.
        lastTouchAt = 0L
        bridge?.pause()
        super.onPause()
        if (::web.isInitialized) web.onPause()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (::web.isInitialized) web.onResume()
    }

    override fun onDestroy() {
        confirmDialog?.dismiss()
        confirmDialog = null
        PERM_CODES.keys.forEach { drainWaiters(it, false) }
        pendingSave?.done?.invoke(false, "Приложение закрыто")
        pendingSave = null
        // Тот же путь, что и для закрытого окна печати: поздний onFinish уже ничего не уничтожит повторно.
        releasePrint?.invoke()
        releasePrint = null
        printView = null
        bridge?.close()
        bridge = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
