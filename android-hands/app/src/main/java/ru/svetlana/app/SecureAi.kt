package ru.svetlana.app

import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.locks.ReentrantReadWriteLock
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
 *
 * «Свой ИИ» (custom, только Android): любой OpenAI-совместимый сервер по https. Адрес лежит ВМЕСТЕ с ключом
 * в защищённом хранилище и меняется только через нативное окно, где адрес показан целиком: страница
 * не может незаметно увести ключ или переписку на другой сервер. Смена адреса сбрасывает разрешения.
 *
 * GigaChat (Сбер): в хранилище лежит «Ключ авторизации» из Studio; по нему получается временный токен
 * (храним 25 минут и только в памяти, привязан к отпечатку ключа и поколению). Корневой сертификат Минцифры
 * подключён через res/xml/network_security_config.xml ТОЛЬКО для адресов GigaChat.
 *
 * Полное удаление (wipeAll) — «забор»: поколение ключей меняется, разрешения и токен GigaChat сбрасываются,
 * идущие запросы рвутся. Последняя проверка поколения и отправка тела запроса идут под замком чтения,
 * а смена поколения — под замком записи: тело, уже уходящее в момент нажатия «Удалить», досылается
 * и затем обрывается, а ни одна новая отправка после этой черты не начинается. Запрос или
 * сохранение ключа, начатые до удаления, после него ничего не отправят и не запишут.
 */
object SecureAi {
    class Fail(message: String) : Exception(message)

    /** Свой ИИ: адрес и ключ (ключ может быть пустым, если сервер работает без него). */
    class CustomAi(val endpoint: String, val key: String)

    const val MAX_SECRET = 4096
    const val MAX_BODY = 2 * 1024 * 1024
    const val MAX_RESPONSE = 8 * 1024 * 1024
    const val MAX_MESSAGES = 200
    const val MAX_TEXT = 200_000
    val PROVIDERS = listOf("openai", "groq", "openrouter", "deepseek", "mistral", "anthropic", "google", "svetlana", "gigachat")
    /** «Свой ИИ»: только в приложении для Android (в Windows его нет, поэтому он не в PROVIDERS). */
    const val CUSTOM = "custom"
    const val MAX_CUSTOM_URL = 200
    const val CUSTOM_BAD = "Свой ИИ: нужен адрес вида https://api.example.com/v1 (только https, без логина и параметров) и ключ без пробелов"
    const val CUSTOM_NOT_SET = "Свой ИИ не настроен: откройте «Модели ИИ» → «Свой ИИ» и сохраните адрес"
    /** Единая Светлана на своём сервере (мир-самозанятых.рф), профиль полного режима Svetlana 2.0. */
    const val SVETLANA_CORE = "https://xn----8sba1acxdkgqms3b9euc.xn--p1ai/api/v1/assistant/svetlana2/chat"
    const val SVETLANA_MODEL = "svetlana2"
    const val SVETLANA_MAX_HISTORY = 10
    /** GigaChat: вход по ключу авторизации и запрос (как в secure_ai.rs). */
    const val GIGACHAT_OAUTH = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    const val GIGACHAT_CHAT = "https://api.giga.chat/v1/chat/completions"
    const val GIGACHAT_SCOPE = "GIGACHAT_API_PERS"
    const val GIGACHAT_TOKEN_TTL_MS = 25 * 60 * 1000L
    const val MAX_TOKEN_RESPONSE = 64 * 1024
    const val GIGACHAT_BAD_KEY = "GigaChat не принял ключ: вставьте «Ключ авторизации» из проекта GigaChat API в Studio (developers.sber.ru/studio)"
    const val GIGACHAT_NO_TOKENS = "GigaChat: закончились токены на счёте (проверьте лимит в Studio или выберите другую модель)"
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
    const val WIPED = "Ключи удалены: запрос остановлен"
    const val WIPE_QUESTION = "Удалить с этого телефона все ключи ИИ и сам ключ шифрования? Отменить нельзя."

    private class Consent(val provider: String, val model: String, val conversation: String, val at: Long, var uses: Int)
    private class Issued(val id: String, val at: Long)
    /** Временный токен GigaChat: только в памяти, для того же ключа и того же поколения. */
    private class GigaToken(val keyHash: String, val gen: Long, val token: String, val at: Long)

    private val chatCalls = RateLimit(CHAT_PER_MINUTE)
    private val secretWrites = RateLimit(SECRET_WRITES_PER_MINUTE)
    private val newConversations = RateLimit(CONVERSATIONS_PER_MINUTE)
    private val consents = ArrayList<Consent>()
    private val issued = ArrayDeque<Issued>()
    private val random = SecureRandom()
    @Volatile
    private var gigaToken: GigaToken? = null

    /** Забор полного удаления: поколение ключей и идущие соединения (всё под wipeLock). */
    private val wipeLock = Any()
    /** Отправка тела запроса — замок чтения (можно параллельно), смена поколения — замок записи. Честный: удаление не голодает. */
    private val dispatch = ReentrantReadWriteLock(true)
    @Volatile
    private var generation = 0L
    private val active = HashSet<HttpsURLConnection>()

    private fun now() = SystemClock.elapsedRealtime()

    fun providerOfSecret(name: String): String? {
        if (!name.startsWith("ai.")) return null
        val p = name.removePrefix("ai.")
        return PROVIDERS.firstOrNull { it == p } ?: CUSTOM.takeIf { it == p }
    }

    private fun storeName(provider: String) = "native.ai.$provider"

    /** «Ключ авторизации» из Studio — строка base64 (без пробелов и слова Basic). */
    fun validGigachatKey(k: String): Boolean =
        k.length in 16..1024 && k.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '+' || it == '/' || it == '=' }

    // ---------- «Свой ИИ»: адрес и значение в хранилище (как normalizeCustomEndpoint в AIGateway.ts) ----------

    private val CUSTOM_HOST = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
    private val CUSTOM_PATH = Regex("^(/[A-Za-z0-9._~-]+)*$")
    private const val COMPLETIONS = "/chat/completions"

    /** Адрес своего ИИ: только https, имя хоста без логина, параметров и #. Хвост /chat/completions отрезается. */
    fun customEndpoint(raw: String): String? {
        var s = raw.trim().trimEnd('/')
        if (s.endsWith(COMPLETIONS, ignoreCase = true)) s = s.dropLast(COMPLETIONS.length)
        if (s.length > MAX_CUSTOM_URL || !s.startsWith("https://", ignoreCase = true)) return null
        val u = try { URI(s) } catch (e: Exception) { return null }
        if (!"https".equals(u.scheme, ignoreCase = true)) return null
        if (u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) return null
        val host = u.host?.lowercase() ?: return null
        if (!CUSTOM_HOST.matches(host)) return null
        val port = u.port
        if (port != -1 && port !in 1..65535) return null
        val path = u.rawPath.orEmpty()
        if (!CUSTOM_PATH.matches(path)) return null
        return "https://$host" + (if (port == -1) "" else ":$port") + path
    }

    /** Значение со страницы или из хранилища: {"endpoint":"https://…","key":"…"} и ничего больше. */
    fun parseCustom(v: String): CustomAi? {
        val o = try { JSONObject(v) } catch (e: Exception) { return null }
        for (k in o.keys()) if (k != "endpoint" && k != "key") return null
        val endpoint = customEndpoint((o.opt("endpoint") as? String).orEmpty()) ?: return null
        val key = if (o.isNull("key")) "" else (o.opt("key") as? String ?: return null)
        // Ключ уйдёт в заголовок: только печатные ASCII-символы без пробелов.
        if (key.length > MAX_SECRET || key.any { it.code !in 0x21..0x7e }) return null
        return CustomAi(endpoint, key)
    }

    fun secretHas(ctx: Context, name: String): Boolean {
        val provider = providerOfSecret(name) ?: throw Fail("Недопустимое имя ключа")
        return SecretStore.get(ctx, storeName(provider)) != null
    }

    fun secretSet(ctx: Context, name: String, value: String?, confirm: (String) -> Boolean) {
        val gen = generation
        val provider = providerOfSecret(name) ?: throw Fail("Недопустимое имя ключа")
        val v = value?.takeIf { it.isNotEmpty() }
        var custom: CustomAi? = null
        if (v != null) {
            if (provider == CUSTOM) {
                if (v.length > MAX_SECRET + 1024) throw Fail(CUSTOM_BAD)
                custom = parseCustom(v) ?: throw Fail(CUSTOM_BAD)
            } else {
                if (v.toByteArray(Charsets.UTF_8).size > MAX_SECRET || v.any { it.isISOControl() }) throw Fail("Некорректный ключ")
                if (provider == "gigachat" && !validGigachatKey(v)) throw Fail(GIGACHAT_BAD_KEY)
            }
        } else if (SecretStore.get(ctx, storeName(provider)) == null) {
            return
        }
        if (!secretWrites.ok()) throw Fail("Слишком частое изменение ключей, подождите минуту")
        revokeConsents(provider)
        if (provider == "gigachat") gigaToken = null
        val c = custom
        val question = when {
            c != null -> "Подключить свой ИИ по адресу\n${c.endpoint}\n" +
                (if (c.key.isEmpty()) "без ключа" else "с API-ключом (он останется в защищённом хранилище телефона)") +
                "?\n\nПереписка со Светланой будет уходить на этот сервер. Подключайте только сервер, которому доверяете."
            v != null -> "Сохранить новый API-ключ для «$provider» в защищённом хранилище телефона?"
            provider == CUSTOM -> "Отключить свой ИИ и удалить его адрес и ключ из хранилища телефона?"
            else -> "Удалить API-ключ «$provider» из хранилища телефона?"
        }
        if (!confirm(question)) throw Fail(CANCELLED)
        // Свой ИИ: в хранилище ложится именно тот адрес, который человек видел в окне.
        val stored = if (c != null) JSONObject().put("endpoint", c.endpoint).put("key", c.key).toString() else v
        // Если пока ждали ответа, всё удалили — старый запрос ключ не восстанавливает.
        synchronized(wipeLock) {
            if (generation != gen) throw Fail(WIPED)
            SecretStore.put(ctx, storeName(provider), stored)
            if (provider == "gigachat") gigaToken = null
        }
    }

    /**
     * Удалить все ключи и ключ шифрования после нативного подтверждения. Ждёт отправки уже уходящих тел
     * запросов (замок записи), затем меняет поколение, сбрасывает разрешения и рвёт идущие соединения.
     */
    fun wipeAll(ctx: Context, confirm: (String) -> Boolean): Any? {
        if (!confirm(WIPE_QUESTION)) throw Fail(CANCELLED)
        val w = dispatch.writeLock()
        w.lock()
        try {
            synchronized(wipeLock) {
                generation++
                gigaToken = null
                synchronized(consents) { consents.clear() }
                active.forEach { runCatching { it.disconnect() } }
                active.clear()
                return SecretStore.clearAll(ctx)
            }
        } finally {
            w.unlock()
        }
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
        val gen = generation
        val p = PROVIDERS.firstOrNull { it == provider } ?: CUSTOM.takeIf { it == provider } ?: throw Fail("Этот облачный сервис не поддерживается")
        val obj = body as? JSONObject ?: throw Fail("Тело запроса должно быть объектом")
        // Размер — до разбора схемы: огромное тело не должно проходить рекурсивную проверку.
        val bodyBytes = obj.toString().toByteArray(Charsets.UTF_8)
        if (bodyBytes.size > MAX_BODY) throw Fail("Запрос слишком большой")
        validateBody(p, model, obj)
        if (!isIssued(conversation)) throw Fail(CONVERSATION_UNKNOWN)
        if (!chatCalls.ok()) throw Fail("Слишком много запросов к облачному ИИ, подождите минуту")
        if (!takeConsent(p, model, conversation)) {
            val preview = previewOf(p, obj)
            val question = if (p == CUSTOM) {
                // В окне — адрес из хранилища, а не со страницы: именно туда уйдёт запрос.
                val target = SecretStore.get(ctx, storeName(p))?.let { parseCustom(it) }?.endpoint ?: throw Fail(CUSTOM_NOT_SET)
                "Разрешить Светлане отправить переписку в свой ИИ по адресу $target, модель $model?\n" +
                    "Разговор: «$preview»\n" +
                    "Разрешение действует только для этого разговора: 15 минут и не больше $CONSENT_MAX_USES запросов."
            } else {
                "Разрешить Светлане отправить переписку в облачный ИИ «$p», модель $model?\n" +
                    "Разговор: «$preview»\n" +
                    "Разрешение действует только для этого разговора: 15 минут и не больше $CONSENT_MAX_USES запросов."
            }
            if (!confirm(question)) throw Fail(CANCELLED)
            synchronized(wipeLock) {
                if (generation != gen) throw Fail(WIPED)
                synchronized(consents) { consents.add(Consent(p, model, conversation, now(), 1)) }
            }
        }
        val key = synchronized(wipeLock) {
            if (generation != gen) throw Fail(WIPED)
            SecretStore.get(ctx, storeName(p))
        } ?: throw Fail(if (p == CUSTOM) CUSTOM_NOT_SET else "API-ключ не задан")
        if (p == CUSTOM) return postCustom(parseCustom(key) ?: throw Fail(CUSTOM_NOT_SET), bodyBytes, gen)
        return post(p, model, key, bodyBytes, gen)
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
            // GigaChat не принимает температуру 0.
            checkNumber(obj, "temperature", if (provider == "gigachat") 0.01 else 0.0, 2.0)
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
        "gigachat" -> GIGACHAT_CHAT
        else -> throw Fail("Этот облачный сервис не поддерживается")
    }

    private fun post(p: String, model: String, key: String, body: ByteArray, gen: Long): String {
        if (p == "gigachat") return gigachat(key, body, gen)
        val headers = LinkedHashMap<String, String>()
        headers["Content-Type"] = "application/json"
        when (p) {
            "anthropic" -> {
                headers["x-api-key"] = key
                headers["anthropic-version"] = "2023-06-01"
            }
            "google" -> headers["x-goog-api-key"] = key
            else -> headers["Authorization"] = "Bearer $key"
        }
        val (code, text) = exchange(endpoint(p, model), headers, body, gen, MAX_RESPONSE)
        if (code !in 200..299) throw Fail("HTTP $code: ${text.take(500)}")
        return text
    }

    /** Свой ИИ: OpenAI-совместимый /chat/completions по адресу из хранилища (те же лимиты, без редиректов). */
    private fun postCustom(c: CustomAi, body: ByteArray, gen: Long): String {
        val headers = linkedMapOf("Content-Type" to "application/json", "Accept" to "application/json")
        if (c.key.isNotEmpty()) headers["Authorization"] = "Bearer ${c.key}"
        val (code, text) = exchange(c.endpoint + COMPLETIONS, headers, body, gen, MAX_RESPONSE)
        if (code !in 200..299) throw Fail("Свой ИИ: HTTP $code: ${text.take(500)}")
        return text
    }

    // ---------- GigaChat: ключ авторизации → временный токен → запрос ----------

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    /** Токен из ответа входа: только печатные ASCII-символы и разумная длина (он уйдёт в заголовок). */
    private fun parseGigaToken(text: String): String? {
        val t = runCatching { JSONObject(text).opt("access_token") as? String }.getOrNull() ?: return null
        if (t.isEmpty() || t.length > 8192 || t.any { it.code !in 0x21..0x7e }) return null
        return t
    }

    private fun gigachatToken(key: String, gen: Long): String {
        val h = sha256(key)
        gigaToken?.let { if (it.keyHash == h && it.gen == gen && now() - it.at < GIGACHAT_TOKEN_TTL_MS) return it.token }
        val headers = linkedMapOf(
            "Authorization" to "Basic $key",
            "RqUID" to UUID.randomUUID().toString(),
            "Content-Type" to "application/x-www-form-urlencoded",
            "Accept" to "application/json",
        )
        val (code, text) = exchange(GIGACHAT_OAUTH, headers, "scope=$GIGACHAT_SCOPE".toByteArray(Charsets.UTF_8), gen, MAX_TOKEN_RESPONSE)
        if (code == 400 || code == 401 || code == 403) throw Fail(GIGACHAT_BAD_KEY)
        if (code !in 200..299) throw Fail("GigaChat: вход не удался, HTTP $code")
        val token = parseGigaToken(text) ?: throw Fail("GigaChat: в ответе нет токена")
        synchronized(wipeLock) {
            if (generation != gen) throw Fail(WIPED)
            gigaToken = GigaToken(h, gen, token, now())
        }
        return token
    }

    /** Запрос к GigaChat. Если токен устарел раньше срока (401) — один повтор с новым токеном. */
    private fun gigachat(key: String, body: ByteArray, gen: Long): String {
        if (!validGigachatKey(key)) throw Fail(GIGACHAT_BAD_KEY)
        for (attempt in 0..1) {
            val token = gigachatToken(key, gen)
            val headers = linkedMapOf(
                "Authorization" to "Bearer $token",
                "Content-Type" to "application/json",
                "Accept" to "application/json",
            )
            val (code, text) = exchange(GIGACHAT_CHAT, headers, body, gen, MAX_RESPONSE)
            when {
                code == 401 && attempt == 0 -> gigaToken = null
                code == 401 -> throw Fail(GIGACHAT_BAD_KEY)
                code == 402 -> throw Fail(GIGACHAT_NO_TOKENS)
                code !in 200..299 -> throw Fail("HTTP $code: ${text.take(500)}")
                else -> return text
            }
        }
        throw Fail(GIGACHAT_BAD_KEY)
    }

    /** Один HTTPS-запрос: без редиректов, под «забором» полного удаления, ответ читается по частям до [max]. */
    private fun exchange(url: String, headers: Map<String, String>, body: ByteArray, gen: Long, max: Int): Pair<Int, String> {
        val c = URL(url).openConnection() as? HttpsURLConnection ?: throw Fail("Разрешены только https-адреса")
        try {
            // Соединение видно «забору»: полное удаление его оборвёт.
            synchronized(wipeLock) {
                if (generation != gen) throw Fail(WIPED)
                active.add(c)
            }
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.connectTimeout = 20_000
            c.readTimeout = 120_000
            c.requestMethod = "POST"
            c.doOutput = true
            c.setFixedLengthStreamingMode(body.size)
            for ((k, v) in headers) c.setRequestProperty(k, v)
            // Последняя проверка и отправка — одно целое: поколение меняется только под замком записи.
            val r = dispatch.readLock()
            r.lock()
            try {
                if (generation != gen) throw Fail(WIPED)
                c.outputStream.use { it.write(body) }
            } finally {
                r.unlock()
            }
            val code = c.responseCode
            if (c.contentLengthLong > max) throw Fail(TOO_BIG_RESPONSE)
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val out = ByteArrayOutputStream()
            stream?.use { s ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    if (out.size() + n > max) throw Fail(TOO_BIG_RESPONSE)
                    out.write(buf, 0, n)
                }
            }
            if (generation != gen) throw Fail(WIPED)
            return code to String(out.toByteArray(), Charsets.UTF_8)
        } catch (e: Fail) {
            throw e
        } catch (e: IOException) {
            if (generation != gen) throw Fail(WIPED)
            throw Fail("Нет связи с сервером, проверьте интернет (error sending request: ${e.javaClass.simpleName})")
        } finally {
            synchronized(wipeLock) { active.remove(c) }
            c.disconnect()
        }
    }
}
