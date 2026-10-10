package ru.svetlana.hands

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.print.PdfPrinter
import android.print.PrintAttributes
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * Сердце приложения: ядро Светланы (Node.js) и модель на телефоне в фоновой службе с уведомлением.
 * Отдельный процесс «:core» — Node запускается один раз за процесс, при сбое система поднимет службу заново.
 * Долгие задачи: пока Светлана работает над задачей, держим процессор включённым (частичная блокировка сна).
 */
class CoreService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var llama: Llama
    private var wake: PowerManager.WakeLock? = null
    @Volatile private var stopped = false
    private var pdfServer: ServerSocket? = null
    private val printing = java.util.concurrent.Semaphore(1)
    private val pdfConns = java.util.concurrent.Semaphore(4)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 28) runCatching { WebView.setDataDirectorySuffix("core") } // WebView в двух процессах — у каждого своя папка
        llama = Llama(this) { log(it) }
        startForegroundCompat("Светлана просыпается…")
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "svetlana:work").apply { setReferenceCounted(false) }
        Thread({ boot() }, "sv-boot").start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_LLM_START -> Models.byId(intent.getStringExtra("model"))?.let { m ->
                CoreConfig.update(this) { it.put("llm", m.id) }
                Thread({ startLlm(m) }, "sv-llm").start()
            }
            ACTION_LLM_STOP -> { CoreConfig.update(this) { it.remove("llm") } // желание «выключить» записываем сразу: идущий запуск увидит его и не зарегистрирует модель
                Thread({ synchronized(this) { llama.stop(); CoreApi.removeProvider(this, "local"); CoreConfig.setLlmStatus(this, "off", "Модель на телефоне выключена") } }, "sv-llm").start() }
        }
        return START_STICKY
    }

    override fun onDestroy() { stopped = true; llama.stop(); runCatching { pdfServer?.close() }; runCatching { wake?.release() }; super.onDestroy() }

    private fun log(s: String) { runCatching { File(filesDir, "core-service.log").appendText("${System.currentTimeMillis()} $s\n") } }

    // ---------- запуск ядра ----------
    private fun boot() {
        try {
            val core = extractCore()
            val cfg = CoreConfig.load(this)
            if (!portFree(cfg.getInt("port"))) CoreConfig.update(this) { it.put("port", CoreConfig.freePort()) } // 8787 занят другим приложением
            val c = CoreConfig.load(this)
            val pdfPort = startPdfBridge(c.getString("pdfToken"))
            val data = File(filesDir, "core-data").apply { mkdirs() }
            val ws = (getExternalFilesDir("Projects") ?: File(filesDir, "projects")).apply { mkdirs() }
            val env = arrayOf(
                "HOST=127.0.0.1", "PORT=${c.getInt("port")}", "SVETLANA_DATA_DIR=${data.path}", "SVETLANA_WORKSPACE=${ws.path}",
                "SVETLANA_ADMIN_TOKEN=${c.getString("adminToken")}", "SVETLANA_SECRET=${c.getString("secret")}",
                "SVETLANA_MAX_STEPS=40", "SVETLANA_MAX_TOKENS=3000", "SVETLANA_COMMAND_ALLOW=none", "SVETLANA_TZ=${TimeZone.getDefault().id}",
                "SVETLANA_PDF_BRIDGE=http://127.0.0.1:$pdfPort/pdf", "SVETLANA_PDF_TOKEN=${c.getString("pdfToken")}",
                "HOME=${filesDir.path}", "TMPDIR=${cacheDir.path}", "LANG=ru_RU.UTF-8", "NODE_OPTIONS=--max-old-space-size=384",
            )
            if (!nodeStarted) {
                nodeStarted = true
                Thread(null, {
                    val code = runCatching { NodeBridge.startNode(arrayOf("node", File(core, "server.mjs").path), env, File(filesDir, "core.log").path) }.getOrElse { log("node: $it"); -1 }
                    log("ядро завершилось с кодом $code"); stopSelf(); android.os.Process.killProcess(android.os.Process.myPid()) // новый процесс = новый Node
                }, "node", 32L * 1024 * 1024).start()
            }
            // ждём ядро и восстанавливаем модель, если она была включена
            val t0 = System.currentTimeMillis()
            while (CoreApi.health(this) == null && System.currentTimeMillis() - t0 < 60_000 && !stopped) Thread.sleep(300)
            notifyText("Светлана на связи")
            llama.killStale()
            Models.byId(CoreConfig.load(this).optString("llm", ""))?.let { startLlm(it) }
            watch()
        } catch (e: Throwable) { log("boot: $e"); notifyText("Ошибка запуска: ${e.message}") }
    }

    /** Ядро из APK → личная папка (только когда обновилось приложение). */
    private fun extractCore(): File {
        val dir = File(filesDir, "core"); val stamp = File(dir, ".version")
        val want = assets.open("core.version").use { it.readBytes().decodeToString().trim() }
        if (stamp.isFile && stamp.readText() == want) return dir
        dir.deleteRecursively(); dir.mkdirs()
        ZipInputStream(assets.open("core.zip")).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                val f = File(dir, e.name); if (!f.canonicalPath.startsWith(dir.canonicalPath + File.separator)) continue
                if (e.isDirectory) f.mkdirs() else { f.parentFile?.mkdirs(); f.outputStream().use { z.copyTo(it) } }
            }
        }
        stamp.writeText(want); return dir
    }

    private fun portFree(p: Int) = runCatching { ServerSocket(p, 1, InetAddress.getByName("127.0.0.1")).close(); true }.getOrDefault(false)

    /** Запуски модели идут по одному (загрузка, мастер, сторож): повторный запрос той же живой модели — без перезапуска. */
    @Synchronized private fun startLlm(m: Model) {
        if (llama.model?.id == m.id && llama.alive()) { CoreApi.upsertProvider(this, llama.provider(m)); return } // та же модель уже работает: повторное «Включить» её не перезапускает
        val t0 = System.currentTimeMillis()
        while (CoreApi.health(this) == null && System.currentTimeMillis() - t0 < 60_000) Thread.sleep(500) // провайдера регистрируем в уже запущенном ядре
        if (CoreConfig.load(this).optString("llm", "") != m.id) return // пока ждали ядро, модель выключили или сменили
        if (llama.start(m)) {
            if (CoreConfig.load(this).optString("llm", "") != m.id) { llama.stop(); CoreApi.removeProvider(this, "local"); CoreConfig.setLlmStatus(this, "off", "Модель на телефоне выключена"); return }
            if (!CoreApi.upsertProvider(this, llama.provider(m))) { // ядро не приняло — не оставляем полуживого «local», иначе мастер решит, что думать есть чем
                CoreApi.removeProvider(this, "local"); llama.stop(); CoreConfig.setLlmStatus(this, "error", "Модель работает, но ядро её не приняло", m.id) } }
        else CoreApi.removeProvider(this, "local")
    }

    /** Каждые 10 секунд: работает ли Светлана над задачей (держим процессор) и жива ли модель. */
    private fun watch() {
        var busySince = 0L
        while (!stopped) {
            val h = CoreApi.health(this)
            val busy = h?.optBoolean("busy") == true
            if (busy) { if (busySince == 0L) { busySince = System.currentTimeMillis(); notifyText("Светлана работает над задачей…") }; runCatching { wake?.acquire(15 * 60_000L) } }
            else if (busySince != 0L) { busySince = 0L; runCatching { wake?.release() }; notifyText("Светлана на связи") }
            val want = CoreConfig.load(this).optString("llm", "")
            if (want.isNotBlank() && llama.model?.id == want && !llama.alive()) { log("модель упала — перезапускаю"); Models.byId(want)?.let { startLlm(it) } }
            Thread.sleep(10_000)
        }
    }

    // ---------- PDF: ядро присылает путь к HTML, печатаем через WebView ----------
    private fun startPdfBridge(token: String): Int {
        val ss = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")); pdfServer = ss
        Thread({ while (!stopped) { val s = runCatching { ss.accept() }.getOrNull() ?: break; if (!pdfConns.tryAcquire()) { runCatching { s.close() }; continue }
            Thread({ try { handlePdf(s, token) } catch (_: Throwable) {} finally { pdfConns.release() } }, "sv-pdf").start() } }, "sv-pdf-accept").start()
        return ss.localPort
    }

    private fun handlePdf(s: Socket, token: String) = s.use {
        s.soTimeout = 15_000 // заголовки и тело — быстро; печать ждём отдельно
        val inp = java.io.BufferedInputStream(s.getInputStream())
        fun line(): String? { val b = java.io.ByteArrayOutputStream(); while (true) { val c = inp.read(); if (c < 0) return if (b.size() == 0) null else b.toString("UTF-8"); if (c == '\n'.code) return b.toString("UTF-8").trimEnd('\r'); b.write(c); if (b.size() > 8192) return null } }
        val head = generateSequence { line()?.takeIf { l -> l.isNotEmpty() } }.toList()
        val len = head.firstOrNull { it.startsWith("Content-Length:", true) }?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0
        val ok = head.any { it.equals("Authorization: Bearer $token", true) }
        val body = ByteArray(len.coerceIn(0, 100_000)).also { var n = 0; while (n < it.size) { val r = inp.read(it, n, it.size - n); if (r < 0) break; n += r } }
        fun reply(code: Int, text: String) { val b = text.toByteArray(); s.getOutputStream().apply { write("HTTP/1.1 $code X\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n".toByteArray()); write(b); flush() } }
        if (!ok) return@use reply(401, "нет доступа")
        val j = runCatching { JSONObject(String(body, Charsets.UTF_8)) }.getOrNull() ?: return@use reply(400, "ожидается JSON")
        val data = File(filesDir, "core-data/artifacts").canonicalPath + File.separator
        val html = File(j.optString("html")); val pdf = File(j.optString("pdf"))
        if (!html.canonicalPath.startsWith(data) || !pdf.canonicalPath.startsWith(data) || !html.isFile || !pdf.name.endsWith(".pdf")) return@use reply(400, "файлы вне папки Светланы")
        if (!printing.tryAcquire()) return@use reply(503, "уже печатаю другой документ")
        val latch = CountDownLatch(1); var err: String? = "не напечатано"
        main.post {
            try {
                val w = WebView(applicationContext)
                w.settings.javaScriptEnabled = false
                w.measure(1280, 720); w.layout(0, 0, 1280, 720)
                w.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String?) {
                        val slides = j.optBoolean("slides")
                        val media = if (slides) PrintAttributes.MediaSize("svetlana_slides", "16:9", 13333, 7500) else PrintAttributes.MediaSize.ISO_A4
                        val attrs = PrintAttributes.Builder().setMediaSize(media).setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300)).setMinMargins(PrintAttributes.Margins.NO_MARGINS).build()
                        PdfPrinter.print(view.createPrintDocumentAdapter("svetlana"), attrs, pdf) { done, e -> err = if (done) null else (e ?: "ошибка печати"); view.destroy(); latch.countDown() }
                    }
                }
                w.loadDataWithBaseURL("about:blank", html.readText(), "text/html", "utf-8", null)
            } catch (e: Throwable) { err = e.message; latch.countDown() }
        }
        latch.await(80, TimeUnit.SECONDS); printing.release()
        if (err == null && pdf.isFile && pdf.length() > 500) reply(200, "ok") else reply(500, err ?: "пустой PDF")
    }

    // ---------- уведомление ----------
    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) nm.createNotificationChannel(NotificationChannel(CH, "Светлана работает", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CH).setContentTitle("Светлана").setContentText(text).setSmallIcon(android.R.drawable.stat_notify_sync_noanim).setContentIntent(open).setOngoing(true).build()
    }
    private fun startForegroundCompat(text: String) {
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification(text), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, notification(text))
    }
    private fun notifyText(t: String) = runCatching { getSystemService(NotificationManager::class.java).notify(1, notification(t)) }

    companion object {
        const val ACTION_LLM_START = "ru.svetlana.LLM_START"
        const val ACTION_LLM_STOP = "ru.svetlana.LLM_STOP"
        private const val CH = "svetlana-core"
        @Volatile private var nodeStarted = false
        fun start(ctx: Context, action: String? = null, model: String? = null) {
            val i = Intent(ctx, CoreService::class.java).setAction(action).apply { if (model != null) putExtra("model", model) }
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }
}
