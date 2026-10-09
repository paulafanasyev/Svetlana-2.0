package ru.svetlana.hands

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** «Экран и руки»: что Светлане можно на этом телефоне, служба специальных возможностей, работа в фоне. */
class HandsActivity : Activity() {
    private lateinit var state: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val pad = Ui.dp(this, 16)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        fun add(v: android.view.View) = root.addView(v, Ui.lp())
        add(Ui.title(this, "Экран и руки"))
        add(Ui.text(this, "Светлана видит экран и нажимает за вас в любых приложениях (1С, мессенджеры, браузер). Каждое действие вы подтверждаете в чате.", 14f, Ui.SOFT))
        val screen = CheckBox(this).apply { text = "Разрешить видеть экран"; isChecked = prefs.allowScreen }
        val control = CheckBox(this).apply { text = "Разрешить управлять (нажатия, ввод)"; isChecked = prefs.allowControl }
        add(screen); add(control)
        add(Ui.button(this, "Сохранить", primary = true) { prefs.allowScreen = screen.isChecked; prefs.allowControl = control.isChecked; HandsService.instance?.connect(); refresh() })
        add(Ui.button(this, "Включить службу «Светлана» в спец. возможностях") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
        add(Ui.text(this, if (Build.VERSION.SDK_INT >= 30) "Снимки экрана работают (Android 11+)." else "На Android ниже 11 Светлана читает экран как список элементов (без снимков).", 13f, Ui.SOFT))

        add(Ui.title(this, "Долгие задачи"))
        add(Ui.text(this, "Чтобы телефон не усыплял Светлану посреди задачи, разрешите ей работать в фоне без ограничений.", 14f, Ui.SOFT))
        add(Ui.button(this, "Разрешить работу в фоне") {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) { state.text = "Уже разрешено ✔"; return@button }
            runCatching { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
                .onFailure { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        })

        add(Ui.title(this, "Другой сервер (необязательно)"))
        add(Ui.text(this, "Если у вас Светлана на своём сервере (VPS), «руки» этого телефона можно отдать ей. Пусто — работают с Светланой в этом телефоне.", 13f, Ui.SOFT))
        val url = EditText(this).apply { hint = "wss://ваш-домен/ws/device"; setText(if (prefs.remote) prefs.url else ""); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val token = EditText(this).apply { hint = "Ключ устройства dev_…"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        add(url); add(token)
        add(Ui.button(this, "Подключить к серверу") {
            val u = url.text.toString().trim()
            if (u.isEmpty()) { prefs.remote = false; prefs.token = ""; state.text = "Руки вернутся к Светлане в этом телефоне при следующем открытии чата"; return@button }
            prefs.urlError(u)?.let { state.text = it; return@button }
            if (token.text.isBlank()) { state.text = "Введите ключ устройства с сервера"; return@button }
            prefs.remote = true; prefs.url = u; prefs.token = token.text.toString(); prefs.deviceId = ""
            HandsService.instance?.connect(); refresh()
        })
        state = TextView(this); add(state)
        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll); Ui.insets(scroll)
    }
    override fun onResume() { super.onResume(); refresh() }
    private fun refresh() { state.text = "Служба: " + (if (HandsService.instance != null) "включена · ${HandsService.status}" else "выключена — включите в спец. возможностях") }
}
