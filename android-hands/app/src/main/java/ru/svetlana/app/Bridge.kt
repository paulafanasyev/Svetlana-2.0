package ru.svetlana.app

import android.Manifest
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Нативный мост для общего интерфейса. Страница видит те же команды, что в Windows (Tauri invoke):
 * secret_set, secret_has, ai_new_conversation, ai_cloud_chat, local_stt_* (GigaAM на устройстве), плюс то,
 * чего в WebView нет самого по себе: голос (voice_*, tts_*), руки (hands_*), файлы (save_file), печать
 * (print_html), буфер обмена (clipboard_set), контакты телефона (contacts_list), домашняя сеть по http
 * (lan_http: Ollama/LM Studio на компьютере и Svetlana-home) и полное удаление ключей (secret_wipe_all).
 * Любая другая команда отклоняется.
 *
 * Сообщения принимаются только из главного окна своего адреса (проверка в MainActivity), размер — до
 * разбора JSON. Ключи, облако, руки, контакты, скачивание модели и первая отправка данных на новое
 * устройство домашней сети всегда спрашивают человека в нативном окне; файл сохраняется только туда,
 * куда человек сам выбрал в системном окне.
 */
class Bridge(private val act: MainActivity) {
    companion object {
        private val ID_RE = Regex("^\\{\"id\":(\\d{1,9}),")
        private const val MAX_MESSAGE = 3 * 1024 * 1024
        private const val MAX_SAVE_CHARS = 2_500_000
        private const val MAX_CLIP_CHARS = 100_000
        private val SAVE_MIMES = setOf("text/csv", "application/json", "text/html", "text/calendar", "text/plain")

        /** Имя файла без путей, управляющих и служебных символов. */
        fun safeFileName(raw: String): String {
            val s = Steps.safe(raw).replace(Regex("[\\\\/:*?\"<>|]"), "_").trim('.', ' ')
            return s.take(100).ifBlank { "svetlana.txt" }
        }

        /** Ставится до загрузки страницы: тот же window.__TAURI_INTERNALS__.invoke, что в Windows. */
        val SHIM = """
(function () {
  'use strict';
  if (window.__SVETLANA_PLATFORM__ === 'android') return;
  var port = window.SvetlanaNative;
  if (!port || typeof port.postMessage !== 'function') return;
  var pending = new Map();
  var seq = 0;
  port.onmessage = function (event) {
    var m;
    try { m = JSON.parse(event.data); } catch (e) { return; }
    if (!m || typeof m.id !== 'number') return;
    var p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value); else p.reject(String(m.error || 'Ошибка приложения'));
  };
  function invoke(cmd, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        port.postMessage(JSON.stringify({ id: id, cmd: String(cmd), args: args || {} }));
      } catch (e) {
        pending.delete(id);
        reject('Связь с приложением недоступна');
      }
    });
  }
  Object.defineProperty(window, '__SVETLANA_PLATFORM__', { value: 'android', writable: false, configurable: false });
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: Object.freeze({ invoke: invoke }), writable: false, configurable: false });
})();
"""
    }

    private val pool = Executors.newFixedThreadPool(4)
    private val voice = NativeVoice(act)
    private val handsBusy = AtomicBoolean(false)

    fun handle(raw: String, reply: (String) -> Unit) {
        val id = ID_RE.find(raw)?.groupValues?.get(1)?.toLongOrNull() ?: return
        val done: Done = { ok, value ->
            act.main.post {
                runCatching {
                    val out = JSONObject().put("id", id).put("ok", ok)
                    if (ok) out.put("value", value ?: JSONObject.NULL) else out.put("error", (value as? String) ?: "Ошибка приложения")
                    reply(out.toString())
                }
            }
        }
        if (raw.length > MAX_MESSAGE) { done(false, "Запрос слишком большой"); return }
        val msg = try { JSONObject(raw) } catch (e: Exception) { done(false, "Некорректный запрос"); return }
        val args = msg.optJSONObject("args") ?: JSONObject()
        when (msg.optString("cmd")) {
            "app_info" -> done(true, JSONObject().put("platform", "android").put("version", act.versionName()))
            "secret_has" -> bg(done) { SecureAi.secretHas(act, args.optString("name")) }
            "secret_set" -> bg(done) {
                val value = if (args.isNull("value")) null else args.opt("value") as? String ?: throw SecureAi.Fail("Некорректный ключ")
                SecureAi.secretSet(act, args.optString("name"), value, act::confirm)
                null
            }
            // Одно нативное подтверждение; идущие запросы в облако обрываются (SecureAi.wipeAll).
            // Вместе с ключами забываются разрешённые устройства домашней сети.
            "secret_wipe_all" -> bg(done) {
                val n = SecureAi.wipeAll(act, act::confirm)
                LanHttp.forgetAll(act)
                n
            }
            "save_file" -> {
                val mime = args.optString("mime").substringBefore(';').trim().lowercase()
                val text = args.optString("text")
                when {
                    mime !in SAVE_MIMES -> done(false, "Этот тип файла нельзя сохранить")
                    text.length > MAX_SAVE_CHARS -> done(false, "Файл слишком большой")
                    else -> act.saveFile(safeFileName(args.optString("name")), mime, text, done)
                }
            }
            // Печать и PDF: системное окно печати Android (там же «Сохранить как PDF»).
            "print_html" -> {
                val html = args.optString("html")
                if (html.isEmpty() || html.length > MAX_SAVE_CHARS) done(false, "Нечего печатать или документ слишком большой")
                else act.printHtml(html, Steps.safe(args.optString("title"), 80), done)
            }
            "clipboard_set" -> {
                val text = args.optString("text")
                if (text.length > MAX_CLIP_CHARS) done(false, "Текст слишком большой")
                else { act.copyText(text); done(true, null) }
            }
            // Контакты этого телефона в CRM: разрешение Android «Контакты» + нативное подтверждение.
            "contacts_list" -> act.withPermission(Manifest.permission.READ_CONTACTS) { granted ->
                if (!granted) {
                    done(false, "Нет доступа к контактам: разрешите «Контакты» для Светланы в настройках телефона")
                } else {
                    bg(done) {
                        if (!act.confirm("Перенести контакты этого телефона (имена и номера) в CRM Светланы?\n\nОни останутся только на этом телефоне.")) {
                            throw SecureAi.Fail(SecureAi.CANCELLED)
                        }
                        Contacts.list(act)
                    }
                }
            }
            "lan_http" -> bg(done) {
                LanHttp.request(act, args.optString("url"), args.optString("method", "GET"), args.optString("body"), act::confirm)
            }
            "local_stt_status" -> bg(done) { LocalStt.status(act) }
            // Загрузка долгая: в своём потоке, чтобы не занимать общий пул (статус опрашивается страницей).
            "local_stt_install" -> Thread {
                try {
                    LocalStt.install(act, act::confirm)
                    done(true, null)
                } catch (e: SecureAi.Fail) {
                    done(false, e.message)
                } catch (e: Exception) {
                    done(false, e.message ?: e.javaClass.simpleName)
                }
            }.start()
            "local_stt_remove" -> bg(done) { LocalStt.remove(act, act::confirm); null }
            "local_stt_transcribe" -> bg(done) {
                LocalStt.transcribe(act, LocalStt.decodePcm16(args.optString("pcm16")), args.optInt("sampleRate"))
            }
            "ai_new_conversation" -> bg(done) { SecureAi.newConversation() }
            "ai_cloud_chat" -> bg(done) {
                SecureAi.cloudChat(
                    act,
                    args.optString("provider"),
                    args.optString("model"),
                    args.optString("conversation"),
                    args.opt("body"),
                    act::confirm,
                )
            }
            "voice_listen" -> voice.listen(done)
            "voice_stop" -> { voice.stopListening(); done(true, null) }
            "tts_speak" -> voice.speak(args.optString("text"), done)
            "tts_stop" -> { voice.stopSpeaking(); done(true, null) }
            "hands_status" -> done(true, JSONObject().put("enabled", HandsService.instance != null))
            "hands_open_settings" -> { act.openAccessibilitySettings(); done(true, null) }
            "hands_run" -> runHands(args, done)
            else -> done(false, "Команда недоступна на Android")
        }
    }

    private fun runHands(args: JSONObject, done: Done) {
        val steps = try { Steps.parse(args) } catch (e: Exception) { emptyList() }
        if (steps.isEmpty()) { done(false, "Нет шагов для выполнения"); return }
        if (Steps.needsHands(steps) && HandsService.instance == null) {
            done(false, "Руки выключены: нажмите «Включить руки» и включите «Светлана: руки» в специальных возможностях")
            return
        }
        if (!handsBusy.compareAndSet(false, true)) { done(false, "Руки уже выполняют команду"); return }
        val finish: Done = { ok, value -> handsBusy.set(false); done(ok, value) }
        bg(finish) {
            // Приложения ищем ДО подтверждения: в окне видно, какое именно откроется (название и пакет).
            val resolved = Steps.resolveApps(act.applicationContext, steps)
            val list = resolved.mapIndexed { i, s -> "${i + 1}. ${s.title}" }.joinToString("\n")
            val warn = if (Steps.risky(resolved)) "\n\n⚠ Есть шаг, похожий на отправку, оплату или удаление. Проверьте внимательно." else ""
            if (!act.confirm("Выполнить на телефоне?\n\n$list$warn")) throw SecureAi.Fail(SecureAi.CANCELLED)
            Steps.run(act.applicationContext, resolved)
        }
    }

    private fun bg(done: Done, work: () -> Any?) {
        try {
            pool.execute {
                try {
                    done(true, work())
                } catch (e: SecureAi.Fail) {
                    done(false, e.message)
                } catch (e: Exception) {
                    done(false, e.message ?: e.javaClass.simpleName)
                }
            }
        } catch (e: RejectedExecutionException) {
            done(false, "Приложение занято, попробуйте ещё раз")
        }
    }

    fun close() {
        voice.close()
        pool.shutdownNow()
    }
}
