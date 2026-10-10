package ru.svetlana.hands

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView

/**
 * «Модель ИИ»: Светлана сама ИИ не встраивает — пользователь выбирает под свой телефон.
 * Показываем характеристики, советуем модель по ОЗУ, качаем её системным загрузчиком (докачка, уведомление),
 * включаем на телефоне. Без модели можно работать через облачного провайдера (свой ключ, вкладка «ИИ»).
 */
class ModelsActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var dev: Device
    private var ticking = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dev = Device.detect(this)
        val pad = Ui.dp(this, 16)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        if (intent.getBooleanExtra("welcome", false)) {
            root.addView(Ui.title(this, "Привет! Я Светлана 👋"), Ui.lp())
            root.addView(Ui.text(this, "Чтобы я могла думать, выберите одно (можно и оба):\n• модель на телефоне — работает без интернета, скачивается один раз;\n• облако со своим ключом — быстрее и умнее: в чате вкладка «ИИ» (GigaChat, YandexGPT, DeepSeek…).", 15f), Ui.lp())
        }
        root.addView(Ui.title(this, "Модель ИИ"), Ui.lp())
        root.addView(Ui.text(this, "Ваш телефон: ${dev.tierName}\n${dev.describe()}", 14f, Ui.SOFT), Ui.lp())
        status = Ui.text(this, "", 15f); root.addView(status, Ui.lp())
        if (!dev.offline) root.addView(Ui.text(this, if (!dev.serverBundled && dev.arm64) "Это 32-битная версия приложения. Для модели на телефоне установите версию arm64-v8a."
            else "На этом телефоне модель без интернета не запустится (нужен 64-битный процессор и Android 9+). Светлана будет работать через облако: добавьте ключ во вкладке «ИИ» в чате (GigaChat, YandexGPT, DeepSeek и др.).", 14f, 0xFFC62828.toInt()), Ui.lp())
        if (dev.offline && Models.recommended(dev) == null) root.addView(Ui.text(this, "Памяти у телефона мало для модели без интернета — советую облако со своим ключом (вкладка «ИИ» в чате). Лёгкую модель попробовать можно, но она может работать медленно и закрываться.", 14f, 0xFFC62828.toInt()), Ui.lp())
        root.addView(Ui.text(this, "Модели на телефоне работают без интернета, но медленнее облака. Скачивать лучше по Wi-Fi.", 13f, Ui.SOFT), Ui.lp())
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; root.addView(list, Ui.lp())
        root.addView(Ui.button(this, "Выключить модель на телефоне") { CoreService.start(this, CoreService.ACTION_LLM_STOP); toast("Выключаю…") }, Ui.lp())
        root.addView(Ui.text(this, "Облако вместо модели: в чате → вкладка «ИИ» → выберите сервис и вставьте свой ключ. Можно и то и другое: Светлана берёт первую доступную.", 13f, Ui.SOFT), Ui.lp())
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
            val badge = when { m == rec -> "  ★ советую для вашего телефона"; ModelStore.unfit(dev, m) != null -> "  ⚠ не для этого телефона: ${ModelStore.unfit(dev, m)}"; else -> "" }
            card.addView(Ui.text(this, m.title + badge, 16f), Ui.lp())
            card.addView(Ui.text(this, "%s · %.1f ГБ · от %.0f ГБ ОЗУ".format(m.note, m.totalGb, m.minRamGb), 13f, Ui.SOFT), Ui.lp())
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            fun btn(t: String, primary: Boolean = false, f: () -> Unit) = row.addView(Ui.button(this, t, primary, f), LinearLayout.LayoutParams(-2, -2).apply { rightMargin = Ui.dp(this@ModelsActivity, 8) })
            val s = ModelStore.state(this, m) { main.post { if (ticking) render() } }
            when (s.optString("phase")) {
                "downloading" -> {
                    val done = s.optLong("done"); val total = maxOf(1L, s.optLong("total"))
                    card.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000; progress = (done * 1000 / total).toInt() }, Ui.lp())
                    card.addView(Ui.text(this, "Скачивается: %.2f из %.2f ГБ".format(done / 1e9, total / 1e9), 13f, Ui.SOFT), Ui.lp())
                    btn("Отменить") { ModelStore.cancel(this, m) }
                }
                "ready" -> {
                    if (active == m.id) card.addView(Ui.text(this, if (st.optString("state") == "starting") "Загружается в память…" else "Включена", 13f, 0xFF2F7D55.toInt()), Ui.lp())
                    else if (dev.offline) btn("Включить", primary = true) { enable(m) }
                    btn("Удалить") { confirm("Удалить «${m.title}» (%.1f ГБ)?".format(m.totalGb)) { ModelStore.remove(this, m) } }
                }
                "verifying" -> card.addView(Ui.text(this, "Проверяю файл (контрольная сумма)…", 13f, Ui.SOFT), Ui.lp())
                else -> {
                    if (s.optString("phase") == "corrupt") card.addView(Ui.text(this, "Файл оказался повреждён или подменён — удалён, скачайте заново", 13f, 0xFFC62828.toInt()), Ui.lp())
                    if (s.optString("phase") == "failed") card.addView(Ui.text(this, "Загрузка не удалась (код ${s.optInt("reason")}) — попробуйте ещё раз по Wi-Fi", 13f, 0xFFC62828.toInt()), Ui.lp())
                    if (dev.offline && ModelStore.unfit(dev, m) == null) btn("Скачать %.1f ГБ".format(m.totalGb), primary = m == rec) { download(m) }
                }
            }
            card.addView(row, Ui.lp())
            list.addView(card, Ui.lp().apply { topMargin = Ui.dp(this@ModelsActivity, 10) })
        }
    }

    /** Только совместимые с телефоном: ModelStore.start сам скажет, почему нельзя (ОЗУ, место). */
    private fun download(m: Model) { ModelStore.start(this, m).takeIf { it.isNotEmpty() }?.let { toast(it) }; render() }

    /** Включить модель; если свободной памяти мало — предупредить (иначе система может закрыть Светлану). */
    private fun enable(m: Model) {
        val r = ModelStore.enable(this, m, false)
        when {
            r.startsWith("warn:") -> confirm(r.removePrefix("warn:")) { ModelStore.enable(this, m, true); toast("Загружаю модель — до пары минут") }
            r.isEmpty() -> toast("Загружаю модель — до пары минут")
            else -> toast(r)
        }
    }

    private fun confirm(text: String, yes: () -> Unit) { AlertDialog.Builder(this).setMessage(text).setPositiveButton("Да") { _, _ -> yes(); render() }.setNegativeButton("Нет", null).show() }
    private fun toast(t: String) = android.widget.Toast.makeText(this, t, android.widget.Toast.LENGTH_LONG).show()
}
