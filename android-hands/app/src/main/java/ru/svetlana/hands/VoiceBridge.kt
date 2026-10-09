package ru.svetlana.hands

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

/**
 * Голос телефона для веб-чата: распознавание речи (часто работает и без интернета) и озвучка системным голосом.
 * События уходят в страницу: window.__svVoice(kind, text) и window.__svSpoke().
 * Для губ аватара: window.__svSpeechStart() — голос зазвучал, window.__svRange(i) — сейчас произносится символ i.
 */
class VoiceBridge(private val a: Activity, private val web: WebView) {
    private var sr: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsFailed = false
    private var pendingSay: String? = null
    // у каждой фразы свой id: события старой фразы (после QUEUE_FLUSH или stop) не должны завершать или двигать новую
    @Volatile private var activeId: String? = null
    private var seq = 0
    var askMic: (() -> Unit)? = null

    init {
        tts = TextToSpeech(a) { st ->
            ttsReady = st == TextToSpeech.SUCCESS; ttsFailed = !ttsReady
            if (ttsFailed && pendingSay != null) { pendingSay = null; js("window.__svSpoke&&window.__svSpoke()") } // нет голосового движка — не зависаем в «говорю…»
            if (ttsReady) {
                tts?.setLanguage(Locale("ru", "RU"))
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) { if (id == activeId) js("window.__svSpeechStart&&window.__svSpeechStart()") }
                    override fun onDone(id: String?) { if (id == activeId) { activeId = null; js("window.__svSpoke&&window.__svSpoke()") } }
                    @Deprecated("Deprecated in Java") override fun onError(id: String?) { if (id == activeId) { activeId = null; js("window.__svSpoke&&window.__svSpoke()") } }
                    // Android 8+: движок сообщает, какое слово звучит, — по нему губы аватара держат темп голоса
                    override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) { if (id == activeId) js("window.__svRange&&window.__svRange($start)") }
                })
                pendingSay?.let { pendingSay = null; say(it) }
            }
        }
    }

    private fun js(code: String) = a.runOnUiThread { web.evaluateJavascript(code, null) }
    private fun voice(kind: String, text: String = "") = js("window.__svVoice&&window.__svVoice(${JSONObject.quote(kind)},${JSONObject.quote(text)})")

    @JavascriptInterface fun listen() = a.runOnUiThread {
        if (a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { askMic?.invoke(); voice("error", "permission"); voice("end"); return@runOnUiThread }
        if (!SpeechRecognizer.isRecognitionAvailable(a)) { voice("error", "unavailable"); voice("end"); return@runOnUiThread }
        sr?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(a); sr = r
        var ended = false
        fun end() { if (!ended) { ended = true; voice("end") } }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: Bundle?) {}
            override fun onPartialResults(b: Bundle?) { b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { voice("partial", it) } }
            override fun onResults(b: Bundle?) { voice("final", b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""); end() }
            override fun onError(e: Int) { if (e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) voice("error", "permission"); end() }
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU").putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true))
    }
    @JavascriptInterface fun stopListening() = a.runOnUiThread { sr?.stopListening() }
    @JavascriptInterface fun speak(text: String) = a.runOnUiThread { say(text) }
    @JavascriptInterface fun stopSpeaking() = a.runOnUiThread { activeId = null; pendingSay = null; tts?.stop() }
    /** Из чата: «нет модели и ключа» → экран выбора модели. */
    @JavascriptInterface fun openModels() = a.runOnUiThread { a.startActivity(Intent(a, ModelsActivity::class.java)) }

    private fun say(text: String) {
        if (ttsFailed) { js("window.__svSpoke&&window.__svSpoke()"); return }
        if (!ttsReady) { pendingSay = text; return }
        val id = "sv-${++seq}"; activeId = id
        if (tts?.speak(text.take(3900), TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) { activeId = null; js("window.__svSpoke&&window.__svSpoke()") } // движок отказал — не висим в «говорю…»
    }
    fun destroy() { sr?.destroy(); tts?.shutdown() }
}
