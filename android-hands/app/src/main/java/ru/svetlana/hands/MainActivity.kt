package ru.svetlana.hands

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Настройка сопряжения: адрес ядра + ключ устройства, что разрешено, включение службы специальных возможностей. */
class MainActivity : Activity() {
    private lateinit var state: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad) }
        fun add(v: android.view.View) = root.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        add(TextView(this).apply { text = "Светлана Руки"; textSize = 24f })
        add(TextView(this).apply { text = "Даёт Светлане видеть экран и нажимать за вас. Каждое действие вы подтверждаете в приложении Светланы." })
        val url = EditText(this).apply { hint = "wss://ваш-домен/ws/device"; setText(prefs.url); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val token = EditText(this).apply { hint = if (prefs.token.isNotBlank()) "Ключ сохранён (введите новый, чтобы заменить)" else "Ключ устройства dev_…"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val screen = CheckBox(this).apply { text = "Разрешить видеть экран"; isChecked = prefs.allowScreen }
        val control = CheckBox(this).apply { text = "Разрешить управлять (нажатия, ввод)"; isChecked = prefs.allowControl }
        add(url); add(token); add(screen); add(control)
        add(Button(this).apply { text = "Сохранить и подключить"; setOnClickListener {
            prefs.urlError(url.text.toString())?.let { state.text = it; return@setOnClickListener }
            prefs.url = url.text.toString(); if (token.text.isNotBlank()) prefs.token = token.text.toString(); prefs.allowScreen = screen.isChecked; prefs.allowControl = control.isChecked
            HandsService.instance?.connect() ?: startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); refresh()
        } })
        add(Button(this).apply { text = "Включить / выключить службу"; setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } })
        add(Button(this).apply { text = "Открыть Светлану (чат и голос)"; setOnClickListener {
            val web = prefs.url.replace(Regex("^wss://"), "https://").replace(Regex("^ws://"), "http://").substringBefore("/ws/")
            if (web.startsWith("http")) startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(web)))
        } })
        state = TextView(this); add(state)
        setContentView(root)
    }
    override fun onResume() { super.onResume(); refresh() }
    private fun refresh() { state.text = "Служба: " + (if (HandsService.instance != null) "включена · ${HandsService.status}" else "выключена") }
}
