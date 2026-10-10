package ru.svetlana.hands

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.view.Display
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * «Руки и глаза» Светланы на Android. Подключается К ядру по WebSocket и выполняет команды протокола
 * (screen.capture, ui.tree, apps.list, app.launch, input.*, nav.*, clipboard.*). Каждое действие владелец
 * подтверждает в приложении Светланы; здесь — только исполнение и проверка результата.
 */
class HandsService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()          // очередь команд по одной
    private val shotCallbacks = Executors.newSingleThreadExecutor()   // отдельный поток для колбэка скриншота (иначе взаимоблокировка)
    @Volatile private var lastShotAt = 0L
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var ws: WebSocket? = null
    private var stopped = false
    private var lastShotW = 0
    private var lastShotH = 0

    override fun onServiceConnected() { instance = this; connect() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
    override fun onDestroy() { stopped = true; instance = null; ws?.close(1000, "off"); worker.shutdownNow(); shotCallbacks.shutdownNow(); super.onDestroy() }

    /** API специальных возможностей вызываем на главном потоке; рабочий поток ждёт результат (главный не блокируется). */
    private fun <T> onMain(timeoutSec: Long = 10, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val f = CompletableFuture<T>()
        val posted = main.post { if (f.isCancelled) return@post; try { f.complete(block()) } catch (e: Throwable) { f.completeExceptionally(e) } }
        if (!posted) throw IllegalStateException("служба останавливается")
        return try { f.get(timeoutSec, TimeUnit.SECONDS) }
        catch (e: java.util.concurrent.TimeoutException) { f.cancel(false); throw IllegalStateException("устройство занято — команда отменена") }
        catch (e: java.util.concurrent.ExecutionException) { throw (e.cause ?: e) }
    }

    fun connect() {
        val prefs = Prefs(this)
        if (prefs.url.isBlank() || prefs.token.isBlank()) return
        prefs.urlError()?.let { status = it; return }
        ws?.cancel()
        val req = Request.Builder().url(prefs.url).header("Sec-WebSocket-Protocol", prefs.token).build()
        ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val dm = realMetrics()
                webSocket.send(JSONObject().put("type", "hello").put("platform", "android").put("name", Build.MODEL)
                    .put("capabilities", JSONArray(prefs.capabilities()))
                    .put("screen", JSONObject().put("width", dm.widthPixels).put("height", dm.heightPixels)).toString())
                status = "в сети"
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                worker.execute {
                    val m = JSONObject(text); val id = m.optLong("id")
                    val out = JSONObject().put("id", id)
                    try { out.put("result", handle(m.optString("method"), m.optJSONObject("params") ?: JSONObject(), prefs)) }
                    catch (e: Exception) { out.put("error", (e.message ?: e.javaClass.simpleName).take(300)) }
                    webSocket.send(out.toString())
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { status = "нет связи: ${t.message}"; retry() }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { status = "отключено"; if (code != 1000) retry() }
        })
    }
    private fun retry() { if (!stopped) main.postDelayed({ connect() }, 5000) }

    private fun realMetrics(): DisplayMetrics {
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION") (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(dm)
        return dm
    }

    private fun handle(method: String, p: JSONObject, prefs: Prefs): Any {
        val needControl = method.startsWith("input.") || method.startsWith("nav.") || method == "app.launch" || method == "clipboard.set"
        if (needControl && !prefs.allowControl) throw IllegalStateException("управление выключено в «Светлана Руки»")
        if ((method == "screen.capture" || method == "ui.tree") && !prefs.allowScreen) throw IllegalStateException("просмотр экрана выключен")
        return when (method) {
            "screen.capture" -> capture(p.optInt("maxSide", 1280).coerceIn(64, 4096), p.optString("format", "jpeg"))
            "ui.tree" -> JSONObject().put("root", onMain { withRoot { tree(it, 0, intArrayOf(0)) } } ?: JSONObject.NULL)
            "apps.list" -> apps()
            "app.launch" -> act { onMain { launch(p.getString("app")) } }
            "input.tap" -> act { gesture(sx(p.getDouble("x")), sy(p.getDouble("y")), sx(p.getDouble("x")), sy(p.getDouble("y")), 60) }
            "input.swipe" -> act { gesture(sx(p.getDouble("x")), sy(p.getDouble("y")), sx(p.getDouble("x2")), sy(p.getDouble("y2")), 400) }
            "input.type" -> act { onMain { typeText(p.getString("text")) } }
            "input.key" -> act { onMain { key(p.getString("key")) } }
            "nav.back" -> act { onMain { performGlobalAction(GLOBAL_ACTION_BACK) } }
            "nav.home" -> act { onMain { performGlobalAction(GLOBAL_ACTION_HOME) } }
            "clipboard.set" -> act { onMain { (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("svetlana", p.getString("text"))); true } }
            else -> throw IllegalArgumentException("команда не поддерживается: $method")
        }
    }

    /** Действие + проверка: изменилось ли дерево интерфейса после команды. */
    private fun act(block: () -> Boolean): JSONObject {
        val before = signature()
        val executed = block()
        Thread.sleep(700)
        val after = signature()
        return JSONObject().put("executed", executed).put("verified", executed && before != after)
    }
    private fun signature(): Int = onMain { withRoot { tree(it, 0, intArrayOf(0)).toString().hashCode() } ?: 0 }

    // координаты приходят в пикселях последнего скриншота → в реальные пиксели экрана
    private fun sx(v: Double): Float { val w = realMetrics().widthPixels; return (if (lastShotW > 0) v * w / lastShotW else v).toFloat().coerceIn(0f, w - 1f) }
    private fun sy(v: Double): Float { val h = realMetrics().heightPixels; return (if (lastShotH > 0) v * h / lastShotH else v).toFloat().coerceIn(0f, h - 1f) }

    private fun capture(maxSide: Int, format: String): JSONObject {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw IllegalStateException("скриншоты доступны с Android 11")
        val wait = 1100 - (System.currentTimeMillis() - lastShotAt)   // система разрешает ~1 снимок в секунду
        if (wait > 0) Thread.sleep(wait)
        val f = CompletableFuture<Bitmap>()
        val posted = main.post {
            try {
            takeScreenshot(Display.DEFAULT_DISPLAY, shotCallbacks, object : TakeScreenshotCallback {
                    override fun onSuccess(r: ScreenshotResult) {
                        try {
                            val hw = Bitmap.wrapHardwareBuffer(r.hardwareBuffer, r.colorSpace)
                            if (hw == null) f.completeExceptionally(IllegalStateException("пустой кадр"))
                            else { if (!f.isDone) { val copy = hw.copy(Bitmap.Config.ARGB_8888, false); if (!f.complete(copy)) copy.recycle() }; hw.recycle() }
                        } catch (e: Throwable) { f.completeExceptionally(e) } finally { r.hardwareBuffer.close() }
                    }
                    override fun onFailure(code: Int) { f.completeExceptionally(IllegalStateException("скриншот не сделан (код $code; защищённые окна, например банки, снимать нельзя)")) }
                })
            } catch (t: Throwable) { if (!f.isDone) f.completeExceptionally(t) }
        }
        if (!posted) throw IllegalStateException("служба останавливается")
        lastShotAt = System.currentTimeMillis()
        val bmp = try { f.get(10, TimeUnit.SECONDS) } catch (e: java.util.concurrent.ExecutionException) { throw (e.cause ?: e) }
        var scaled: Bitmap = bmp
        try {
            val k = minOf(1.0, maxSide.toDouble() / maxOf(bmp.width, bmp.height))
            if (k < 1) scaled = Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true)
            lastShotW = scaled.width; lastShotH = scaled.height
            val png = format.equals("png", true)
            val out = ByteArrayOutputStream(); scaled.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 80, out)
            val app = onMain { withRoot { it.packageName?.toString() } }
            return JSONObject().put("image", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)).put("mime", if (png) "image/png" else "image/jpeg")
                .put("width", scaled.width).put("height", scaled.height).put("app", app ?: JSONObject.NULL)
        } finally { if (scaled !== bmp) scaled.recycle(); bmp.recycle() }
    }

    private fun tree(n: AccessibilityNodeInfo, depth: Int, count: IntArray): JSONObject {
        count[0]++
        val r = Rect(); n.getBoundsInScreen(r)
        val o = JSONObject().put("class", n.className?.toString()?.substringAfterLast('.')).put("text", n.text?.toString()?.take(200))
            .put("desc", n.contentDescription?.toString()?.take(200)).put("id", n.viewIdResourceName)
            .put("bounds", JSONArray(listOf(r.left, r.top, r.right, r.bottom))).put("click", n.isClickable).put("edit", n.isEditable)
        if (n.isPassword) o.put("text", "***") // пароли не отдаём никогда
        if (depth < 25 && count[0] < 400) {
            val kids = JSONArray()
            for (i in 0 until n.childCount) n.getChild(i)?.let { c -> try { if (count[0] < 400) kids.put(tree(c, depth + 1, count)) } finally { @Suppress("DEPRECATION") c.recycle() } }
            if (kids.length() > 0) o.put("children", kids)
        }
        return o
    }

    private fun apps(): JSONArray {
        val pm = packageManager
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val arr = JSONArray()
        @Suppress("DEPRECATION") pm.queryIntentActivities(i, 0).sortedBy { it.loadLabel(pm).toString() }.forEach {
            arr.put(JSONObject().put("id", it.activityInfo.packageName).put("name", it.loadLabel(pm).toString()))
        }
        return arr
    }

    private fun launch(app: String): Boolean {
        val pm = packageManager
        val pkg = pm.getLaunchIntentForPackage(app)?.let { app } ?: run {
            val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            @Suppress("DEPRECATION") pm.queryIntentActivities(i, 0).firstOrNull { it.loadLabel(pm).toString().equals(app, true) }?.activityInfo?.packageName
        } ?: throw IllegalArgumentException("приложение «$app» не найдено")
        startActivity(pm.getLaunchIntentForPackage(pkg)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long): Boolean {
        val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        val f = CompletableFuture<Boolean>()
        val ok = onMain {
            dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms)).build(), object : GestureResultCallback() {
                override fun onCompleted(d: GestureDescription?) { f.complete(true) }
                override fun onCancelled(d: GestureDescription?) { f.complete(false) }
            }, main)
        }
        return ok && f.get(5, TimeUnit.SECONDS)
    }

    /** Корень активного окна с гарантированным освобождением (на старых Android узлы — системный ресурс). */
    @Suppress("DEPRECATION")
    private fun <T> withRoot(block: (AccessibilityNodeInfo) -> T): T? { val r = rootInActiveWindow ?: return null; return try { block(r) } finally { r.recycle() } }
    @Suppress("DEPRECATION")
    private fun <T> withFocus(block: (AccessibilityNodeInfo?) -> T): T = withRoot { root -> val f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT); try { block(f) } finally { f?.recycle() } } ?: block(null)

    private fun typeText(text: String): Boolean = withFocus { node ->
        if (node == null) throw IllegalStateException("нет активного поля ввода — сначала нажмите на поле")
        if (node.isPassword) throw IllegalStateException("в поле пароля Светлана не печатает")
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, (node.text?.toString() ?: "") + text) }
        node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun key(k: String): Boolean = when (k.lowercase()) {
        "enter" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) withFocus { it?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id) ?: false } else false
        "back", "esc" -> performGlobalAction(GLOBAL_ACTION_BACK)
        "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
        "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
        "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
        else -> throw IllegalArgumentException("клавиша «$k» на телефоне не поддерживается")
    }

    companion object {
        @Volatile var instance: HandsService? = null
        @Volatile var status: String = "не подключено"
    }
}
