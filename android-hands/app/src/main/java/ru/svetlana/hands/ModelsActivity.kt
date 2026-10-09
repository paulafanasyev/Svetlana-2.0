package ru.svetlana.hands

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/**
 * «Модель ИИ»: Светлана сама ИИ не встраивает — пользователь выбирает под свой телефон.
 * Показываем характеристики, советуем модель по ОЗУ, качаем её системным загрузчиком (докачка, уведомление),
 * включаем на телефоне. Без модели можно работать через облачного провайдера (свой ключ, вкладка «ИИ-провайдеры»).
 */
class ModelsActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var dev: Device
    private val dm by lazy { getSystemService(DOWNLOAD_SERVICE) as DownloadManager }
    private val prefs by lazy { getSharedPreferences("models", MODE_PRIVATE) }
    private var ticking = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dev = Device.detect(this)
        val pad = Ui.dp(this, 16)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        if (intent.getBooleanExtra("welcome", false)) {
            root.addView(Ui.title(this, "Привет! Я Светлана 👋"), Ui.lp())
            root.addView(Ui.text(this, "Чтобы я могла думать, выберите одно (можно и оба):\n• модель на телефоне — работает без интернета, скачивается один раз;\n• облако со своим ключом — быстрее и умнее: в чате вкладка «ИИ-провайдеры» (GigaChat, YandexGPT, DeepSeek…).", 15f), Ui.lp())
        }
        root.addView(Ui.title(this, "Модель ИИ"), Ui.lp())
        root.addView(Ui.text(this, "Ваш телефон: ${dev.tierName}\n${dev.describe()}", 14f, Ui.SOFT), Ui.lp())
        status = Ui.text(this, "", 15f); root.addView(status, Ui.lp())
        if (!dev.offline) root.addView(Ui.text(this, if (!dev.serverBundled && dev.arm64) "Это 32-битная версия приложения. Для модели на телефоне установите версию arm64-v8a."
            else "На этом телефоне модель без интернета не запустится (нужен 64-битный процессор и Android 9+). Светлана будет работать через облако: добавьте ключ во вкладке «ИИ-провайдеры» в чате (GigaChat, YandexGPT, DeepSeek и др.).", 14f, 0xFFC62828.toInt()), Ui.lp())
        root.addView(Ui.text(this, "Модели на телефоне работают без интернета, но медленнее облака. Скачивать лучше по Wi-Fi.", 13f, Ui.SOFT), Ui.lp())
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; root.addView(list, Ui.lp())
        root.addView(Ui.button(this, "Выключить модель на телефоне") { CoreService.start(this, CoreService.ACTION_LLM_STOP); toast("Выключаю…") }, Ui.lp())
        root.addView(Ui.text(this, "Облако вместо модели: в чате → вкладка «ИИ-провайдеры» → выберите сервис и вставьте свой ключ. Можно и то и другое: Светлана берёт первую доступную.", 13f, Ui.SOFT), Ui.lp())
        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll); Ui.insets(scroll)
    }

    override fun onResume() { super.onResume(); ticking = true; tick() }
    override fun onPause() { super.onPause(); ticking = false }

    private fun tick() { if (!ticking) return; render(); main.postDelayed({ tick() }, 1500) }

    private fun render() {
        val st = CoreConfig.llmStatus(this)
        status.text = when (st.optString("state")) { "ready" -> "✅ " ; "starting" -> "⏳ "; "error" -> "⚠ "; else -> "" } + st.optString("text", "Модель на телефоне не включена")
        val active = st.optString("model").takeIf { st.optString("state") in setOf("ready", "starting") }
        val rec = Models.recommended(dev)
        list.removeAllViews()
        for (m in Models.catalog) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(this@ModelsActivity, 12), Ui.dp(this@ModelsActivity, 10), Ui.dp(this@ModelsActivity, 12), Ui.dp(this@ModelsActivity, 10))
                background = GradientDrawable().apply { cornerRadius = Ui.dp(this@ModelsActivity, 14).toFloat(); setColor(Color.WHITE); setStroke(Ui.dp(this@ModelsActivity, if (m == rec) 2 else 1), if (m == rec) Ui.BLUE else 0xFFE4E1F4.toInt()) }
            }
            val badge = when { m == rec -> "  ★ советую для вашего телефона"; m.minRamGb > dev.ramGb -> "  ⚠ тяжеловата для этого телефона"; else -> "" }
            card.addView(Ui.text(this, m.title + badge, 16f), Ui.lp())
            card.addView(Ui.text(this, "%s · %.1f ГБ · от %.0f ГБ ОЗУ".format(m.note, m.totalGb, m.minRamGb), 13f, Ui.SOFT), Ui.lp())
            val ids = downloads(m)
            val running = ids.mapNotNull { progress(it) }
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            fun btn(t: String, primary: Boolean = false, f: () -> Unit) = row.addView(Ui.button(this, t, primary, f), LinearLayout.LayoutParams(-2, -2).apply { rightMargin = Ui.dp(this@ModelsActivity, 8) })
            when {
                running.isNotEmpty() -> {
                    val done = running.sumOf { it.first }; val total = maxOf(1L, running.sumOf { it.second })
                    card.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000; progress = (done * 1000 / total).toInt() }, Ui.lp())
                    card.addView(Ui.text(this, "Скачивается: %.2f из %.2f ГБ".format(done / 1e9, total / 1e9), 13f, Ui.SOFT), Ui.lp())
                    btn("Отменить") { ids.forEach { dm.remove(it) }; prefs.edit().remove(m.id).apply() }
                }
                Models.ready(this, m) -> {
                    if (active == m.id) card.addView(Ui.text(this, "Включена", 13f, 0xFF2F7D55.toInt()), Ui.lp())
                    else if (dev.offline) btn("Включить", primary = true) { CoreService.start(this, CoreService.ACTION_LLM_START, m.id); toast("Загружаю модель — до пары минут") }
                    btn("Удалить") { confirm("Удалить «${m.title}» (%.1f ГБ)?".format(m.totalGb)) { if (active == m.id) CoreService.start(this, CoreService.ACTION_LLM_STOP); Models.path(this, m).delete(); Models.mmprojPath(this, m)?.delete() } }
                }
                dev.offline -> btn("Скачать %.1f ГБ".format(m.totalGb), primary = m == rec) { download(m) }
            }
            card.addView(row, Ui.lp())
            list.addView(card, Ui.lp().apply { topMargin = Ui.dp(this@ModelsActivity, 10) })
        }
    }

    private fun downloads(m: Model): List<Long> = (prefs.getString(m.id, "") ?: "").split(",").mapNotNull { it.toLongOrNull() }
    /** (скачано, всего) или null, если загрузка закончилась. */
    private fun progress(id: Long): Pair<Long, Long>? {
        dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
            if (!c.moveToFirst()) return null
            val s = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            if (s == DownloadManager.STATUS_FAILED) { val r = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)); status.text = "⚠ Загрузка не удалась (код $r) — попробуйте ещё раз по Wi-Fi"; return null }
            if (s == DownloadManager.STATUS_SUCCESSFUL) return null
            return c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)) to maxOf(0L, c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
        }
    }

    private fun download(m: Model) {
        val need = m.totalGb * 1.05
        if (Device.detect(this).freeGb < need) { toast("Не хватает места: нужно %.1f ГБ свободных".format(need)); return }
        val go = {
            val ids = mutableListOf<Long>()
            fun enqueue(url: String, file: File, title: String) {
                file.delete(); File(file.path + ".part").delete()
                ids += dm.enqueue(DownloadManager.Request(Uri.parse(url)).setTitle(title).setDescription("Модель для Светланы")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE).setDestinationInExternalFilesDir(this@ModelsActivity, "models", file.name).setAllowedOverMetered(true).setAllowedOverRoaming(false))
            }
            if (!Models.path(this, m).let { it.isFile && it.length() > m.bytes * 0.97 }) enqueue(m.url, Models.path(this, m), m.title)
            Models.mmprojPath(this, m)?.let { f -> if (!(f.isFile && f.length() > m.mmprojBytes * 0.97)) enqueue(m.mmprojUrl!!, f, m.title + " (зрение)") }
            prefs.edit().putString(m.id, ids.joinToString(",")).apply(); render()
        }
        if (m.minRamGb > dev.ramGb) confirm("Для «${m.title}» нужно от %.0f ГБ ОЗУ, а у телефона %.1f. Она может работать очень медленно или закрываться. Всё равно скачать?".format(m.minRamGb, dev.ramGb)) { go() } else go()
    }

    private fun confirm(text: String, yes: () -> Unit) { AlertDialog.Builder(this).setMessage(text).setPositiveButton("Да") { _, _ -> yes(); render() }.setNegativeButton("Нет", null).show() }
    private fun toast(t: String) = android.widget.Toast.makeText(this, t, android.widget.Toast.LENGTH_LONG).show()
}
