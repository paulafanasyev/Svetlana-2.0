package ru.svetlana.hands

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * Скачивание, проверка и включение моделей — общее для мастера первого запуска (веб-чат) и экрана «Модель ИИ».
 * Загрузки идут системным загрузчиком (докачка, уведомление); id загрузок — в prefs «models» (id через запятую).
 */
object ModelStore {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("models", Context.MODE_PRIVATE)
    private fun dm(ctx: Context) = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val verifying = Collections.synchronizedSet(mutableSetOf<String>())
    /** Модель, у которой не сошлась контрольная сумма (файл уже удалён), — показать пользователю один раз. */
    private val corrupt = ConcurrentHashMap<String, Boolean>()

    /** Почему модель не подходит этому телефону; null — подходит. */
    fun unfit(d: Device, m: Model): String? = when {
        !d.arm64 -> "нужен 64-битный процессор"
        d.sdk < 28 -> "нужен Android 9 или новее"
        !d.serverBundled -> "в этой версии приложения нет движка моделей — установите версию arm64-v8a"
        m.minRamGb > d.ramGb || Models.needGb(m) > d.ramGb * 0.75 -> "нужно от %.0f ГБ ОЗУ, у телефона %.1f".format(maxOf(m.minRamGb, Models.needGb(m) / 0.75), d.ramGb)
        else -> null
    }

    /** Итог оценки: local — советуем модель на телефоне; weak — модель запустится с трудом, лучше облако; cloud — только облако. */
    fun verdict(d: Device): String {
        if (!d.offline || Models.catalog.none { unfit(d, it) == null }) return "cloud"
        return if (Models.recommended(d) != null) "local" else "weak"
    }

    fun ids(ctx: Context, m: Model): List<Long> = (prefs(ctx).getString(m.id, "") ?: "").split(",").mapNotNull { it.toLongOrNull() }

    /** Состояние загрузок модели: running — (скачано, всего), failed — код причины, если загрузка упала. */
    data class Dl(val running: Boolean, val done: Long, val total: Long, val failed: Int?)
    fun dl(ctx: Context, m: Model): Dl {
        var running = false; var done = 0L; var total = 0L; var failed: Int? = null
        for (id in ids(ctx, m)) runCatching {
            dm(ctx).query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (!c.moveToFirst()) return@use
                when (c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                    DownloadManager.STATUS_FAILED -> failed = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    DownloadManager.STATUS_SUCCESSFUL -> {}
                    else -> { running = true; done += c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)); total += maxOf(0L, c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))) }
                }
            }
        }
        if (running && total <= 0) total = m.bytes + m.mmprojBytes
        return Dl(running, done, total, failed)
    }

    /** Фаза модели: ready / downloading / verifying / failed / corrupt / none. Скачанный файл сам уходит на проверку SHA-256. */
    fun state(ctx: Context, m: Model, onVerified: (() -> Unit)? = null): JSONObject {
        val o = JSONObject()
        if (Models.ready(ctx, m)) return o.put("phase", "ready")
        val d = dl(ctx, m)
        if (d.running) return o.put("phase", "downloading").put("done", d.done).put("total", d.total)
        if (Models.downloaded(ctx, m)) {
            if (verifying.add(m.id)) Thread({
                val ok = runCatching { Models.verify(ctx, m) }.getOrDefault(false)
                if (!ok) { corrupt[m.id] = true; prefs(ctx).edit().remove(m.id).apply() }
                verifying.remove(m.id); onVerified?.invoke()
            }, "sv-verify").start()
            return o.put("phase", "verifying")
        }
        if (corrupt[m.id] == true) return o.put("phase", "corrupt")
        if (d.failed != null) return o.put("phase", "failed").put("reason", d.failed)
        return o.put("phase", "none")
    }

    /** Начать загрузку. "" — пошла; иначе текст, почему нельзя. */
    fun start(ctx: Context, m: Model): String {
        val d = Device.detect(ctx)
        unfit(d, m)?.let { return "Эта модель не подойдёт: $it" }
        if (dl(ctx, m).running) return ""
        val need = m.totalGb * 1.05
        if (d.freeGb < need) return "Не хватает места: нужно %.1f ГБ свободных, а сейчас %.1f".format(need, d.freeGb)
        corrupt.remove(m.id)
        val ids = mutableListOf<Long>()
        fun enqueue(url: String, file: File, title: String) {
            file.delete(); File(file.path + ".ok").delete()
            ids += dm(ctx).enqueue(DownloadManager.Request(Uri.parse(url)).setTitle(title).setDescription("Модель для Светланы")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE).setDestinationInExternalFilesDir(ctx, "models", file.name)
                .setAllowedOverMetered(true).setAllowedOverRoaming(false))
        }
        return runCatching {
            if (!Models.path(ctx, m).let { it.isFile && it.length() == m.bytes }) enqueue(m.url, Models.path(ctx, m), m.title)
            Models.mmprojPath(ctx, m)?.let { f -> if (!(f.isFile && f.length() == m.mmprojBytes)) enqueue(m.mmprojUrl!!, f, m.title + " (зрение)") }
            prefs(ctx).edit().putString(m.id, ids.joinToString(",")).apply(); ""
        }.getOrElse { e -> ids.forEach { runCatching { dm(ctx).remove(it) } }; prefs(ctx).edit().remove(m.id).apply(); "Загрузчик телефона не запустился: ${e.message}" } // часть уже поставлена в очередь — снимаем, чтобы не осталось «сирот»
    }

    fun cancel(ctx: Context, m: Model) { ids(ctx, m).forEach { runCatching { dm(ctx).remove(it) } }; prefs(ctx).edit().remove(m.id).apply() }

    /** Включить модель. force=false и мало свободной памяти → "warn:текст" (спросить пользователя). "" — включаю. */
    fun enable(ctx: Context, m: Model, force: Boolean): String {
        val d = Device.detect(ctx)
        if (!d.offline) return "На этом телефоне модель без интернета не запустится"
        if (!Models.ready(ctx, m)) return "Модель ещё не скачана и не проверена"
        if (!force && d.availGb + 0.5 < Models.needGb(m))
            return "warn:Сейчас свободно %.1f ГБ памяти, а модели нужно около %.1f. Закройте лишние приложения или выберите модель полегче. Всё равно включить?".format(d.availGb, Models.needGb(m))
        val st = CoreConfig.llmStatus(ctx)
        val fresh = System.currentTimeMillis() - st.optLong("at") < 180_000
        if (st.optString("model") == m.id && CoreConfig.load(ctx).optString("llm") == m.id && (st.optString("state") == "ready" || (st.optString("state") == "starting" && fresh))) return "" // уже включается — второе нажатие ничего не запускает
        synchronized(this) {
            if (System.currentTimeMillis() - lastEnable < 3000 && lastEnableId == m.id) return ""
            lastEnable = System.currentTimeMillis(); lastEnableId = m.id
        }
        CoreConfig.setLlmStatus(ctx, "starting", "Загружаю «${m.title}» в память…", m.id)
        CoreService.start(ctx, CoreService.ACTION_LLM_START, m.id); return ""
    }
    private var lastEnable = 0L
    private var lastEnableId = ""

    /** Модель на телефоне реально есть: выбрана, статус про неё же, и он «готова» или свежее «загружаю» (не зависший с прошлого раза). */
    fun usable(ctx: Context): Boolean {
        val want = CoreConfig.load(ctx).optString("llm", ""); if (want.isBlank()) return false
        val st = CoreConfig.llmStatus(ctx); if (st.optString("model") != want) return false
        return st.optString("state") == "ready" || (st.optString("state") == "starting" && System.currentTimeMillis() - st.optLong("at") < 180_000)
    }

    /** «Позже» в мастере: при следующих запусках приложение не открывает его само (подсказка в чате остаётся). */
    fun setSkipped(ctx: Context, v: Boolean) = ctx.getSharedPreferences("setup", Context.MODE_PRIVATE).edit().putBoolean("skipped", v).apply()
    fun skipped(ctx: Context) = ctx.getSharedPreferences("setup", Context.MODE_PRIVATE).getBoolean("skipped", false)

    fun disable(ctx: Context) = CoreService.start(ctx, CoreService.ACTION_LLM_STOP)

    fun remove(ctx: Context, m: Model) {
        val st = CoreConfig.llmStatus(ctx)
        if (st.optString("model") == m.id || CoreConfig.load(ctx).optString("llm") == m.id) disable(ctx)
        cancel(ctx, m); Models.delete(ctx, m); corrupt.remove(m.id)
    }

    /** Всё для мастера: телефон, проверки, итог, модели со статусом и причиной, если не подходят. */
    fun report(ctx: Context): JSONObject {
        val d = Device.detect(ctx)
        val rec = if (d.offline) Models.recommended(d) else null
        val st = CoreConfig.llmStatus(ctx)
        val models = JSONArray()
        for (m in Models.catalog) {
            val why = unfit(d, m)
            val s = state(ctx, m)
            models.put(JSONObject().put("id", m.id).put("title", m.title).put("note", m.note).put("gb", m.totalGb).put("minRam", m.minRamGb)
                .put("needGb", Models.needGb(m)).put("vision", m.vision).put("rec", m == rec).put("fits", why == null).put("why", why ?: JSONObject.NULL)
                .put("space", Models.downloaded(ctx, m) || d.freeGb >= m.totalGb * 1.05).put("state", s))
        }
        return JSONObject()
            .put("ramGb", d.ramGb).put("availGb", d.availGb).put("freeGb", d.freeGb).put("cores", d.cores).put("soc", d.soc)
            .put("arm64", d.arm64).put("sdk", d.sdk).put("android", android.os.Build.VERSION.RELEASE).put("vulkan", d.vulkan)
            .put("serverBundled", d.serverBundled).put("offline", d.offline).put("tier", d.tier).put("tierName", d.tierName)
            .put("model", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim())
            .put("verdict", verdict(d)).put("rec", rec?.id ?: JSONObject.NULL).put("models", models)
            .put("llm", JSONObject().put("state", st.optString("state", "off")).put("text", st.optString("text", "")).put("model", st.opt("model") ?: JSONObject.NULL))
            .put("active", CoreConfig.load(ctx).optString("llm", "")).put("usable", usable(ctx))
    }
}
