package ru.svetlana.app

import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URL
import java.security.SecureRandom
import javax.net.ssl.HttpsURLConnection

/**
 * Ключи облачных ИИ в приложении для Android. Порт src-tauri/src/secure_ai.rs (Windows) с теми же командами,
 * проверками и лимитами (совпадение проверяет тест androidParity.test.ts).
 *
 * Ключ хранится зашифрованным ключом из Android Keystore (SecretStore) и никогда не возвращается в
 * JavaScript: у страницы есть только «сохранить», «есть ли ключ» и «сделать запрос». Запрос идёт только на
 * фиксированный официальный адрес выбранного сервиса, без редиректов, с ограничением размера и времени.
 * Любое изменение ключа и отправка переписки в облако подтверждаются в НАТИВНОМ окне телефона;
 * разрешение привязано к провайдеру, модели и случайному ID разговора (128 бит SecureRandom), 15 минут и 30 запросов.
 */
object SecureAi {
    class Fail(message: String) : Exception(message)

    const val MAX_SECRET = 4096
    const val MAX_BODY = 2 * 1024 * 1024
    const val MAX_RESPONSE = 8 * 1024 * 1024
    const val MAX_MESSAGES = 200
    const val MAX_TEXT = 200_000
    val PROVIDERS = listOf("openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google", "svetlana")
    /** Единая Светлана на своём сервере (мир-самозанятых.рф), профиль полного режима Svetlana 2.0. */
    const val SVETLANA_CORE = "https://xn----8sba1acxdkgqms3b9euc.xn--p1ai/api/v1/assistant/svetlana2/chat"
    const val SVETLANA_MODEL = "svetlana2"
    const val SVETLANA_MAX_HISTORY = 10
    const val CHAT_PER_MINUTE = 30
    const val SECRET_WRITES_PER_MINUTE = 10
    const val CONSENT_TTL_MS = 15 * 60 * 1000L
    const val CONSENT_MAX_USES = 30
    const val CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000L
    const val MAX_CONVERSATIONS = 32
    const val CONVERSATIONS_PER_MINUTE = 10
    const val CONVERSATION_UNKNOWN = "CONVERSATION_UNKNOWN: разговор не выдан приложением или устарел"
    const val TOO_BIG_RESPONSE = "Ответ слишком большой"
    const val CANCELLED = "Отменено пользователем"

    private class Consent(val provider: String, val model: String, val conversation: String, val at: Long, var uses: Int)
    private class Issued(val id: String, val at: Long)

    private val chatCalls = RateLimit(CHAT_PER_MINUTE)
    private val secretWrites = RateLimit(SECRET_WRITES_PER_MINUTE)
    private val newConversations = RateLimit(CONVERSATIONS_PER_MINUTE)
    private val consents = ArrayList<Consent>()
    private val issued = ArrayDeque<Issued>()
    private val random = SecureRandom()

    private fun now() = SystemClock.elapsedRealtime()

    fun providerOfSecret(name: String): String? {
        if (!name.startsWith("ai.")) return null
        val p = name.removePrefix("ai.")
        return PROVIDERS.firstOrNull { it == p }
    }

    private fun storeName(provider: String) = "native.ai.$provider"

    fun secretHas(ctx: Context, name: String): Boolean {
        val provider = providerOfSecret(name) ?: throw Fail("Недопустимое имя ключа")
        return SecretStore.get(ctx, storeName(provider)) != null
    }

    fun secretSet(ctx: Context, name: String, value: String?, confirm: (String) -> Boolean) {
        val provider = providerOfSecret(name) ?: throw Fail("Недопустимое имя ключа")
        val v = value?.takeIf { it.isNotEmpty() }
        if (v != null) {
            if (v.toByteArray(Charsets.UTF_8).size > MAX_SECRET || v.any { it.isISOControl() }) throw Fail("Некорректный ключ")
        } else if (SecretStore.get(ctx, storeName(provider)) == null) {
            return
        }
        if (!secretWrites.ok()) throw Fail("Слишком частое изменение ключей, подождите минуту")
        revokeConsents(provider)
        val question = if (v != null) {
            "Сохранить новый API-ключ для «$provider» в защищённом хранилище телефона?"
        } else {
            "Удалить API-ключ «$provider» из хранилища телефона?"
        }
        if (!confirm(question)) throw Fail(CANCELLED)
        SecretStore.put(ctx, storeName(provider), v)
    }

    /** Новый разговор: случайный ID, к которому будет привязано разрешение на облако. */
    fun newConversation(): String {
        if (!newConversations.ok()) throw Fail("Слишком много новых разговоров, подождите минуту")
        val bytes = ByteArray(16).also { random.nextBytes(it) }
        val id = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        synchronized(issued) {
            val t = now()
            issued.removeAll { t - it.at > CONVERSATION_TTL_MS }
            while (issued.size >= MAX_CONVERSATIONS) issued.removeFirst()
            issued.addLast(Issued(id, t))
        }
        return id
    }

    private fun isIssued(id: String): Boolean = synchronized(issued) {
        val t = now()
        issued.removeAll { t - it.at > CONVERSATION_TTL_MS }
        id.length == 32 && issued.any { it.id == id }
    }

    private fun takeConsent(provider: String, model: String, conversation: String): Boolean = synchronized(consents) {
        val t = now()
        consents.removeAll { t - it.at > CONSENT_TTL_MS || it.uses >= CONSENT_MAX_USES }
        val c = consents.firstOrNull { it.provider == provider && it.model == model && it.conversation == conversation }
        if (c == null) {
            false
        } else {
            c.uses += 1
            true
        }
    }

    private fun revokeConsents(provider: String) {
        synchronized(consents) { consents.removeAll { it.provider == provider } }
    }

    /** Начало первого сообщения пользователя — только для окна подтверждения. */
    fun previewOf(provider: String, body: JSONObject): String {
        val text: String = if (provider == "svetlana") {
            (opt(body, "message") as? String).orEmpty()
        } else {
            val list = opt(body, if (provider == "google") "contents" else "messages") as? JSONArray
            var first: JSONObject? = null
            if (list != null) {
                for (i in 0 until list.length()) {
                    val m = list.opt(i) as? JSONObject ?: continue
                    if (opt(m, "role") == "user") { first = m; break }
                }
            }
            val f = first
            when {
                f == null -> ""
                provider == "google" -> ((opt(f, "parts") as? JSONArray)?.opt(0) as? JSONObject)?.let { opt(it, "text") as? String }.orEmpty()
                else -> (opt(f, "content") as? String).orEmpty()
            }
        }
        return text.filter { !it.isISOControl() }.take(80)
    }

    fun cloudChat(ctx: Context, provider: String, model: String, conversation: String, body: Any?, confirm: (String) -> Boolean): String {
        val p = PROVIDERS.firstOrNull { it == provider } ?: throw Fail("Этот облачный сервис не поддерживается")
        val obj = body as? JSONObject ?: throw Fail("Тело запроса должно быть объектом")
        // Размер — до разбора схемы: огромное тело не должно проходить рекурсивную проверку.
        val bodyBytes = obj.toString().toByteArray(Charsets.UTF_8)
        if (bodyBytes.size > MAX_BODY) throw Fail("Запрос слишком большой")
        validateBody(p, model, obj)
        if (!isIssued(conversation)) throw Fail(CONVERSATION_UNKNOWN)
        if (!chatCalls.ok()) throw Fail("Слишком много запросов к облачному ИИ, подождите минуту")
        if (!takeConsent(p, model, conversation)) {
            val preview = previewOf(p, obj)
            val question = "Разрешить Светлане отправить переписку в облачный ИИ «$p», модель $model?\n" +
                "Разговор: «$preview»\n" +
                "Разрешение действует только для этого разговора: 15 минут и не больше $CONSENT_MAX_USES запросов."
            if (!confirm(question)) throw Fail(CANCELLED)
            synchronized(consents) { consents.add(Consent(p, model, conversation, now(), 1)) }
        }
        val key = SecretStore.get(ctx, storeName(p)) ?: throw Fail("API-ключ не задан")
        return post(p, model, key, bodyBytes)
    }

    // ---------- строгая схема тела запроса (как validate_body в secure_ai.rs) ----------

    private fun opt(o: JSONObject, k: String): Any? = if (o.isNull(k)) null else o.opt(k)

    private fun isText(v: Any?): Boolean = v is String && v.codePointCount(0, v.length) <= MAX_TEXT

    private fun onlyKeys(o: JSONObject, allowed: Set<String>) {
        for (k in o.keys()) if (k !in allowed) throw Fail("Поле «$k» не разрешено")
    }

    private fun checkNumber(o: JSONObject, key: String, min: Double, max: Double) {
        val v = opt(o, key) ?: return
        val n = (v as? Number)?.toDouble()
        if (n == null || n.isNaN() || n < min || n > max) throw Fail("Некорректное значение «$key»")
    }

    private fun checkParts(v: Any?) {
        val parts = v as? JSONArray ?: throw Fail("Нет частей сообщения")
        if (parts.length() == 0 || parts.length() > 20) throw Fail("Некорректное число частей сообщения")
        for (i in 0 until parts.length()) {
            val po = parts.opt(i) as? JSONObject ?: throw Fail("Часть сообщения должна быть объектом")
            onlyKeys(po, setOf("text"))
            if (!isText(opt(po, "text"))) throw Fail("Часть сообщения должна быть текстом")
        }
    }

    private fun checkMessage(provider: String, m: Any?) {
        val o = m as? JSONObject ?: throw Fail("Сообщение должно быть объектом")
        if (provider == "google") {
            onlyKeys(o, setOf("role", "parts"))
            val r = opt(o, "role") as? String
            if (r != "user" && r != "model") throw Fail("Недопустимая роль сообщения")
            checkParts(opt(o, "parts"))
            return
        }
        onlyKeys(o, setOf("role", "content"))
        val roles = if (provider == "anthropic" || provider == "svetlana") setOf("user", "assistant") else setOf("system", "user", "assistant")
        val r = opt(o, "role") as? String
        if (r == null || r !in roles) throw Fail("Недопустимая роль сообщения")
        if (!isText(opt(o, "content"))) throw Fail("Содержимое сообщения должно быть текстом")
    }

    private fun safeModelChar(c: Char): Boolean =
        c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '.' || c == '_' || c == '-'

    private fun validModel(provider: String, m: String): Boolean {
        if (m.isEmpty() || m.length > 100) return false
        if (provider == "google") return !m.contains("..") && m.all { safeModelChar(it) }
        return m.all { safeModelChar(it) || it == '/' || it == ':' }
    }

    /** Тело запроса к единой Светлане: { message, history?, system? } и ничего больше. */
    private fun validateSvetlana(model: String, obj: JSONObject) {
        if (model != SVETLANA_MODEL) throw Fail("Недопустимое имя модели")
        onlyKeys(obj, setOf("message", "history", "system"))
        val msg = opt(obj, "message") as? String
        if (msg == null || msg.isBlank() || msg.codePointCount(0, msg.length) > MAX_TEXT) throw Fail("Сообщение должно быть непустым текстом")
        opt(obj, "system")?.let { if (!isText(it)) throw Fail("Системная инструкция должна быть текстом") }
        opt(obj, "history")?.let { h ->
            val list = h as? JSONArray ?: throw Fail("Некорректная история разговора")
            if (list.length() > SVETLANA_MAX_HISTORY) throw Fail("Слишком длинная история разговора")
            for (i in 0 until list.length()) checkMessage("svetlana", list.opt(i))
        }
    }

    fun validateBody(provider: String, model: String, obj: JSONObject) {
        if (provider == "svetlana") {
            validateSvetlana(model, obj)
            return
        }
        if (!validModel(provider, model)) throw Fail("Недопустимое имя модели")
        val listKey = if (provider == "google") "contents" else "messages"
        if (provider == "google") {
            onlyKeys(obj, setOf("contents", "systemInstruction", "generationConfig"))
            opt(obj, "systemInstruction")?.let { si ->
                val so = si as? JSONObject ?: throw Fail("Некорректная системная инструкция")
                onlyKeys(so, setOf("parts"))
                checkParts(opt(so, "parts"))
            }
            opt(obj, "generationConfig")?.let { gc ->
                val go = gc as? JSONObject ?: throw Fail("Некорректные параметры генерации")
                onlyKeys(go, setOf("temperature", "maxOutputTokens"))
                checkNumber(go, "temperature", 0.0, 2.0)
                checkNumber(go, "maxOutputTokens", 1.0, 65536.0)
            }
        } else {
            val allowed = if (provider == "anthropic") {
                setOf("model", "max_tokens", "system", "messages", "temperature")
            } else {
                setOf("model", "messages", "temperature", "max_tokens")
            }
            onlyKeys(obj, allowed)
            if ((opt(obj, "model") as? String) != model) throw Fail("Модель в запросе не совпадает с выбранной")
            opt(obj, "system")?.let { if (!isText(it)) throw Fail("Системная инструкция должна быть текстом") }
            checkNumber(obj, "temperature", 0.0, 2.0)
            checkNumber(obj, "max_tokens", 1.0, 65536.0)
        }
        val list = opt(obj, listKey) as? JSONArray ?: throw Fail("Некорректный список сообщений")
        if (list.length() == 0 || list.length() > MAX_MESSAGES) throw Fail("Некорректный список сообщений")
        for (i in 0 until list.length()) checkMessage(provider, list.opt(i))
    }

    // ---------- запрос: фиксированные адреса, без редиректов, ответ читается по частям до лимита ----------

    private fun endpoint(p: String, model: String): String = when (p) {
        "openai" -> "https://api.openai.com/v1/chat/completions"
        "groq" -> "https://api.groq.com/openai/v1/chat/completions"
        "openrouter" -> "https://openrouter.ai/api/v1/chat/completions"
        "deepseek" -> "https://api.deepseek.com/v1/chat/completions"
        "mistral" -> "https://api.mistral.ai/v1/chat/completions"
        "anthropic" -> "https://api.anthropic.com/v1/messages"
        "google" -> "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent"
        "svetlana" -> SVETLANA_CORE
        else -> throw Fail("Этот облачный сервис не поддерживается")
    }

    private fun post(p: String, model: String, key: String, body: ByteArray): String {
        val c = URL(endpoint(p, model)).openConnection() as? HttpsURLConnection ?: throw Fail("Разрешены только https-адреса")
        try {
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.connectTimeout = 20_000
            c.readTimeout = 120_000
            c.requestMethod = "POST"
            c.doOutput = true
            c.setFixedLengthStreamingMode(body.size)
            c.setRequestProperty("Content-Type", "application/json")
            when (p) {
                "anthropic" -> {
                    c.setRequestProperty("x-api-key", key)
                    c.setRequestProperty("anthropic-version", "2023-06-01")
                }
                "google" -> c.setRequestProperty("x-goog-api-key", key)
                else -> c.setRequestProperty("Authorization", "Bearer $key")
            }
            c.outputStream.use { it.write(body) }
            val code = c.responseCode
            if (c.contentLengthLong > MAX_RESPONSE) throw Fail(TOO_BIG_RESPONSE)
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val out = ByteArrayOutputStream()
            stream?.use { s ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    if (out.size() + n > MAX_RESPONSE) throw Fail(TOO_BIG_RESPONSE)
                    out.write(buf, 0, n)
                }
            }
            val text = String(out.toByteArray(), Charsets.UTF_8)
            if (code !in 200..299) throw Fail("HTTP $code: ${text.take(500)}")
            return text
        } catch (e: Fail) {
            throw e
        } catch (e: IOException) {
            throw Fail("Нет связи с сервером, проверьте интернет (error sending request: ${e.javaClass.simpleName})")
        } finally {
            c.disconnect()
        }
    }
}
