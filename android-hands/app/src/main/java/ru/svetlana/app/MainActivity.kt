package ru.svetlana.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale
import java.util.concurrent.Executors

/** Чат со Светланой: текст и голос, ответы вслух, действия на телефоне через «руки». */
class MainActivity : Activity() {

    companion object {
        private const val REQ_MIC = 7
        private const val BG = 0xFF0F1020.toInt()
        private const val BAR = 0xFF17183A.toInt()
        private const val BOT = 0xFF26285A.toInt()
        private const val USER = 0xFF4F46E5.toInt()
        private const val WHITE = 0xFFFFFFFF.toInt()
        private const val MUTED = 0xFFA5A8D0.toInt()
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    }

    private val io = Executors.newSingleThreadExecutor()
    private val history = ArrayList<Turn>()
    private lateinit var list: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var mic: Button
    private lateinit var voiceToggle: Button
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var speakReplies = true
    private var recognizer: SpeechRecognizer? = null
    private var busy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        speakReplies = getSharedPreferences("svetlana_ui", MODE_PRIVATE).getBoolean("speak", true)
        updateVoiceToggle()
        tts = TextToSpeech(this) { st ->
            if (st == TextToSpeech.SUCCESS) {
                tts?.setLanguage(Locale.forLanguageTag("ru-RU"))
                ttsReady = true
            }
        }
        bot("Привет! Я Светлана. Пишите или нажмите 🎤 и говорите.\n\nЯ умею отвечать на вопросы и делать дела на телефоне: «открой Telegram», «нажми Поиск», «пролистай вниз», «назад», «что на экране». Для действий в других приложениях включите «Руки».")
        if (Keys.svetlana(this) == null) askKey()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onDestroy() {
        tts?.shutdown()
        recognizer?.destroy()
        io.shutdownNow()
        super.onDestroy()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun smallButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setOnClickListener { onClick() }
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(BAR)
            setPadding(dp(16), dp(8), dp(8), dp(8))
        }
        val titleBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleBox.addView(TextView(this).apply {
            text = "Светлана"
            textSize = 20f
            setTextColor(WHITE)
            typeface = Typeface.DEFAULT_BOLD
        })
        status = TextView(this).apply {
            textSize = 12f
            setTextColor(MUTED)
        }
        titleBox.addView(status)
        top.addView(titleBox, LinearLayout.LayoutParams(0, WRAP, 1f))
        voiceToggle = smallButton("🔊") { toggleVoice() }
        top.addView(voiceToggle)
        top.addView(smallButton("Руки") { explainHands() })
        top.addView(smallButton("Ключ") { askKey() })
        root.addView(top, LinearLayout.LayoutParams(MATCH, WRAP))

        scroll = ScrollView(this).apply { isFillViewport = true }
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        scroll.addView(list, ViewGroup.LayoutParams(MATCH, WRAP))
        root.addView(scroll, LinearLayout.LayoutParams(MATCH, 0, 1f))

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(BAR)
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        mic = smallButton("🎤") { listen() }
        mic.textSize = 20f
        input = EditText(this).apply {
            hint = "Напишите Светлане…"
            setTextColor(WHITE)
            setHintTextColor(MUTED)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND
            maxLines = 4
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_SEND) {
                    send(null)
                    true
                } else {
                    false
                }
            }
        }
        val sendButton = smallButton("➤") { send(null) }
        sendButton.textSize = 20f
        bottom.addView(mic, LinearLayout.LayoutParams(dp(56), WRAP))
        bottom.addView(input, LinearLayout.LayoutParams(0, WRAP, 1f))
        bottom.addView(sendButton, LinearLayout.LayoutParams(dp(56), WRAP))
        root.addView(bottom, LinearLayout.LayoutParams(MATCH, WRAP))

        // Android 15 рисует окно под системными панелями: отступаем от них и от клавиатуры.
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        return root
    }

    private fun bubble(message: String, mine: Boolean) {
        val tv = TextView(this).apply {
            text = message
            textSize = 16f
            setTextColor(WHITE)
            setTextIsSelectable(true)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(if (mine) USER else BOT)
            }
            maxWidth = (resources.displayMetrics.widthPixels * 0.82).toInt()
        }
        val lp = LinearLayout.LayoutParams(WRAP, WRAP).apply {
            topMargin = dp(6)
            gravity = if (mine) Gravity.END else Gravity.START
        }
        list.addView(tv, lp)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun bot(message: String) = bubble(message, false)

    private fun setStatus(text: String) {
        status.text = text
    }

    private fun refreshStatus() {
        val head = if (Keys.svetlana(this) != null) "голова ✓" else "голова: нужен ключ"
        val hands = if (HandsService.instance != null) "руки ✓" else "руки выключены"
        setStatus(if (busy) "Светлана думает…" else "$head · $hands")
    }

    private fun toggleVoice() {
        speakReplies = !speakReplies
        getSharedPreferences("svetlana_ui", MODE_PRIVATE).edit().putBoolean("speak", speakReplies).apply()
        if (!speakReplies) tts?.stop()
        updateVoiceToggle()
    }

    private fun updateVoiceToggle() {
        voiceToggle.text = if (speakReplies) "🔊" else "🔇"
    }

    private fun speak(text: String) {
        if (!speakReplies || !ttsReady) return
        tts?.speak(text.take(3500), TextToSpeech.QUEUE_FLUSH, null, "svetlana")
    }

    private fun systemPrompt(): String {
        val handsOn = HandsService.instance != null
        val apps = try { Apps.labels(this).joinToString(", ") } catch (e: Exception) { "" }
        val handsState = if (handsOn) "включены" else "выключены (можно только открывать приложения)"
        return listOf(
            "Ты Светлана в Android-приложении на телефоне владельца. Отвечай по-русски, коротко и по делу: ответ часто звучит вслух.",
            "У тебя есть «руки»: ты можешь действовать на этом телефоне. Руки сейчас $handsState.",
            "Если владелец просит что-то сделать на телефоне, в конце ответа добавь РОВНО один блок вида:",
            "```json",
            "{\"actions\":[{\"type\":\"open_app\",\"name\":\"Telegram\"},{\"type\":\"tap\",\"target\":\"Поиск\"},{\"type\":\"type\",\"text\":\"Мама\"}]}",
            "```",
            "Доступные шаги: open_app(name), tap(target: текст или подпись кнопки на экране), type(text, field необязательно), scroll(direction: down или up), back, home, recents, notifications, read_screen, wait(ms).",
            "Не больше 12 шагов. Не придумывай кнопки, которых может не быть; если не знаешь, что на экране, сначала read_screen.",
            "Отправку сообщений, звонки, оплату и удаление владелец подтверждает сам: приложение покажет ему список шагов.",
            "Если действие на телефоне не нужно, блок json не добавляй.",
            "Приложения на телефоне: $apps"
        ).joinToString("\n")
    }

    private fun send(textArg: String?) {
        val text = (textArg ?: input.text.toString()).trim()
        if (text.isEmpty()) return
        if (busy) {
            bot("Секунду, ещё думаю над прошлым вопросом.")
            return
        }
        if (textArg == null) input.setText("")
        bubble(text, true)

        val quick = Steps.quick(text)
        if (quick != null) {
            runSteps(quick, Steps.risky(quick))
            return
        }

        val key = Keys.svetlana(this)
        if (key == null) {
            bot("Чтобы я могла отвечать, нужен ключ Светланы: кнопка «Ключ» вверху. Команды телефону («открой Telegram», «назад») работают и без ключа.")
            return
        }

        busy = true
        refreshStatus()
        val past = ArrayList(history)
        val system = systemPrompt()
        io.execute {
            val result = try {
                Result.success(SvetlanaClient(key).chat(text, past, system))
            } catch (e: Exception) {
                Result.failure<String>(e)
            }
            runOnUiThread {
                busy = false
                refreshStatus()
                result.onSuccess { reply ->
                    history.add(Turn("user", text))
                    history.add(Turn("assistant", reply))
                    while (history.size > 20) history.removeAt(0)
                    val (say, steps) = Steps.split(reply)
                    if (say.isNotBlank()) {
                        bot(say)
                        speak(say)
                    }
                    if (steps.isNotEmpty()) runSteps(steps, true)
                }.onFailure { e ->
                    bot("⚠️ " + (e.message ?: "Не удалось связаться со Светланой"))
                }
            }
        }
    }

    private fun runSteps(steps: List<Step>, confirm: Boolean) {
        if (Steps.needsHands(steps) && HandsService.instance == null) {
            bot("Для этого нужны «руки». Нажмите «Руки» вверху и включите «Светлана: руки» в Специальных возможностях.")
            return
        }
        val plan = steps.mapIndexed { i, s -> "${i + 1}. ${s.title}" }.joinToString("\n")
        val go: () -> Unit = {
            if (steps.size > 1 || confirm) bot("Делаю:\n$plan")
            val ctx = applicationContext
            io.execute {
                val report = Steps.run(ctx, steps)
                runOnUiThread { bot(report) }
            }
        }
        if (!confirm) {
            go()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Светлана хочет сделать на телефоне")
            .setMessage(plan)
            .setPositiveButton("Выполнить") { _, _ -> go() }
            .setNegativeButton("Отмена") { _, _ -> bot("Хорошо, ничего не делаю.") }
            .show()
    }

    private fun explainHands() {
        val on = HandsService.instance != null
        AlertDialog.Builder(this)
            .setTitle(if (on) "Руки включены" else "Включить руки")
            .setMessage(
                "Руки позволяют мне по вашей команде нажимать кнопки, печатать, листать и читать экран в других приложениях.\n\n" +
                    "Как включить: Настройки → Специальные возможности → Установленные приложения (или «Скачанные») → «Светлана: руки» → Вкл.\n\n" +
                    "Если переключатель серый (Android 13+): Настройки → Приложения → Светлана → ⋮ → «Разрешить ограниченные настройки», потом снова включите.\n\n" +
                    "Без вашей команды я ничего не делаю, а свои предложения сначала показываю списком."
            )
            .setPositiveButton("Открыть настройки") { _, _ ->
                try {
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                } catch (e: Exception) {
                    bot("Не получилось открыть настройки, откройте их вручную.")
                }
            }
            .setNegativeButton("Закрыть", null)
            .show()
    }

    private fun askKey() {
        val field = EditText(this).apply {
            hint = "Ключ Светланы"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(field, LinearLayout.LayoutParams(MATCH, WRAP))
        }
        AlertDialog.Builder(this)
            .setTitle("Ключ «Светлана Сервер»")
            .setMessage("Тот же ключ, что в Windows-версии и на сайте. Хранится зашифрованным только на этом телефоне.")
            .setView(box)
            .setPositiveButton("Сохранить") { _, _ ->
                val k = field.text.toString().trim()
                if (k.isNotEmpty()) {
                    try {
                        Keys.setSvetlana(this, k)
                        bot("Ключ сохранён. Спрашивайте!")
                    } catch (e: Exception) {
                        bot("Не удалось сохранить ключ: ${e.message ?: "ошибка хранилища"}")
                    }
                }
                refreshStatus()
            }
            .setNeutralButton("Удалить ключ") { _, _ ->
                Keys.setSvetlana(this, null)
                refreshStatus()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun listen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            bot("На телефоне нет службы распознавания речи. Включите голосовой ввод Google (приложение «Google») или пишите текстом.")
            return
        }
        tts?.stop()
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also { recognizer = it }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                setStatus("Слушаю…")
                mic.text = "⏺"
            }

            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                mic.text = "🎤"
            }

            override fun onError(error: Int) {
                mic.text = "🎤"
                refreshStatus()
                if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    setStatus("Не расслышала, нажмите 🎤 ещё раз")
                } else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
                    bot("Для распознавания речи нужен интернет (или скачанный русский язык в настройках голосового ввода Google).")
                } else {
                    bot("Не получилось послушать (код $error). Попробуйте ещё раз.")
                }
            }

            override fun onResults(results: Bundle?) {
                mic.text = "🎤"
                refreshStatus()
                val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!heard.isNullOrBlank()) send(heard)
            }

            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        r.startListening(intent)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) listen()
            else bot("Без доступа к микрофону я не услышу вас. Можно писать текстом.")
        }
    }
}
