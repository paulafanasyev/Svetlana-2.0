package ru.svetlana.app

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

typealias Done = (Boolean, Any?) -> Unit

/**
 * Голос телефона для общего интерфейса: распознавание (SpeechRecognizer, ru-RU) и синтез (TextToSpeech).
 * В Android WebView нет ни Web Speech, ни speechSynthesis, поэтому они идут через нативный мост.
 * Все методы вызываются в главном потоке.
 */
class NativeVoice(private val act: MainActivity) : TextToSpeech.OnInitListener {
    private var tts: TextToSpeech? = TextToSpeech(act.applicationContext, this)
    private var ttsReady = false
    private val speaking = HashMap<String, Done>()
    private var seq = 0
    private var recognizer: SpeechRecognizer? = null
    private var listenDone: Done? = null

    override fun onInit(status: Int) {
        act.main.post {
            val t = tts ?: return@post
            if (status != TextToSpeech.SUCCESS) return@post
            t.setLanguage(Locale("ru", "RU"))
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) = finish(utteranceId)
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) = finish(utteranceId)
                override fun onError(utteranceId: String?, errorCode: Int) = finish(utteranceId)
                override fun onStop(utteranceId: String?, interrupted: Boolean) = finish(utteranceId)
            })
            ttsReady = true
        }
    }

    private fun finish(id: String?) {
        act.main.post { if (id != null) speaking.remove(id)?.invoke(true, null) }
    }

    private fun releaseSpeaking() {
        val waiting = speaking.values.toList()
        speaking.clear()
        waiting.forEach { it(true, null) }
    }

    fun speak(text: String, done: Done) {
        val t = tts
        if (t == null || !ttsReady) {
            done(false, "Голос телефона не готов: проверьте, что в настройках включён синтез речи (например, Google)")
            return
        }
        val clean = text.filter { !it.isISOControl() || it == '\n' }.take(3900).trim()
        if (clean.isEmpty()) { done(true, null); return }
        releaseSpeaking()
        val id = "u${++seq}"
        speaking[id] = done
        if (t.speak(clean, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            speaking.remove(id)
            done(false, "Не удалось озвучить")
        }
    }

    fun stopSpeaking() {
        tts?.stop()
        releaseSpeaking()
    }

    fun listen(done: Done) {
        if (!SpeechRecognizer.isRecognitionAvailable(act)) {
            done(false, "На телефоне нет службы распознавания речи. Установите или включите приложение Google.")
            return
        }
        act.withAudio { granted ->
            if (!granted) {
                done(false, "Нет доступа к микрофону. Разрешите микрофон для Светланы в настройках телефона.")
                return@withAudio
            }
            cancelListening()
            val r = SpeechRecognizer.createSpeechRecognizer(act)
            recognizer = r
            listenDone = done
            r.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onResults(results: Bundle?) {
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    end(true, text.take(500))
                }
                override fun onError(error: Int) {
                    when (error) {
                        SpeechRecognizer.ERROR_CLIENT -> end(true, "")
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> end(true, "")
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> end(false, "Нет доступа к микрофону. Разрешите микрофон для Светланы в настройках телефона.")
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> end(false, "Для распознавания речи нужен интернет.")
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> end(false, "Распознавание занято, попробуйте ещё раз.")
                        SpeechRecognizer.ERROR_AUDIO -> end(false, "Микрофон недоступен.")
                        else -> end(false, "Ошибка распознавания речи (код $error)")
                    }
                }
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            try {
                r.startListening(intent)
            } catch (e: Exception) {
                end(false, "Не удалось включить распознавание речи")
            }
        }
    }

    private fun end(ok: Boolean, value: Any?) {
        val d = listenDone
        listenDone = null
        recognizer?.destroy()
        recognizer = null
        d?.invoke(ok, value)
    }

    /** Дослушать и распознать уже сказанное (результат придёт в listen). */
    fun stopListening() {
        recognizer?.stopListening()
    }

    private fun cancelListening() {
        val d = listenDone
        listenDone = null
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
        d?.invoke(true, "")
    }

    fun close() {
        cancelListening()
        stopSpeaking()
        tts?.shutdown()
        tts = null
    }
}
