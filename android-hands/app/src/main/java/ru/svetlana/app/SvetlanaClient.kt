package ru.svetlana.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.Reader
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.HttpsURLConnection

data class Turn(val role: String, val content: String)

/**
 * Голова: единая Светлана на своём сервере (мир-самозанятых.рф), тот же адрес и формат, что у сайта
 * и Windows-версии Светланы 2.0 (src/services/SvetlanaCore.ts). Только https, без перенаправлений.
 */
class SvetlanaClient(private val key: String) {
    companion object {
        const val CHAT_URL = "https://xn----8sba1acxdkgqms3b9euc.xn--p1ai/api/v1/assistant/svetlana2/chat"
        private const val MAX_MESSAGE = 16000
        private const val MAX_TURN = 8000
        private const val MAX_HISTORY = 10
        private const val MAX_SYSTEM = 20000
        private const val MAX_RESPONSE = 2 * 1024 * 1024
    }

    fun chat(message: String, history: List<Turn>, system: String): String {
        val turns = JSONArray()
        history.takeLast(MAX_HISTORY).forEach { t ->
            turns.put(JSONObject().put("role", if (t.role == "assistant") "assistant" else "user").put("content", t.content.take(MAX_TURN)))
        }
        val body = JSONObject()
            .put("message", message.take(MAX_MESSAGE))
            .put("history", turns)
            .put("system", system.take(MAX_SYSTEM))
            .toString()
            .toByteArray(Charsets.UTF_8)

        val conn = try {
            URL(CHAT_URL).openConnection() as HttpsURLConnection
        } catch (e: Exception) {
            throw IOException("Не удалось подготовить запрос")
        }
        conn.requestMethod = "POST"
        conn.connectTimeout = 20_000
        conn.readTimeout = 120_000
        conn.doOutput = true
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $key")
        try {
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { readLimited(it) } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) throw IOException(explain(code, json.optString("message")))
            val content = json.optString("content")
            if (content.isBlank()) throw IOException("Светлана прислала пустой ответ, попробуйте ещё раз")
            return content
        } catch (e: UnknownHostException) {
            throw IOException("Нет интернета или сервер Светланы недоступен")
        } catch (e: SocketTimeoutException) {
            throw IOException("Сервер Светланы долго не отвечает, попробуйте ещё раз")
        } finally {
            conn.disconnect()
        }
    }

    private fun readLimited(r: Reader): String {
        val sb = StringBuilder()
        val buf = CharArray(8192)
        while (true) {
            val n = r.read(buf)
            if (n < 0) break
            sb.append(buf, 0, n)
            if (sb.length > MAX_RESPONSE) throw IOException("Слишком большой ответ сервера")
        }
        return sb.toString()
    }

    private fun explain(code: Int, message: String): String = when {
        code == 401 || code == 403 -> "Сервер не принял ключ. Проверьте его: кнопка «Ключ» вверху."
        code == 429 -> "Слишком много запросов, подождите минуту."
        code >= 500 -> "Сервер Светланы временно недоступен (код $code). Попробуйте позже."
        message.isNotBlank() -> "Ошибка $code: ${message.take(200)}"
        else -> "Ошибка сервера (код $code)"
    }
}
