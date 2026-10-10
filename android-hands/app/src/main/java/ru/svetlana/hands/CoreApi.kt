package ru.svetlana.hands

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Запросы к своему ядру на 127.0.0.1 (пароль владельца знает только приложение). */
object CoreApi {
    class Resp(val code: Int, val body: String, val headers: Map<String, List<String>>)

    fun call(ctx: Context, method: String, path: String, body: Any? = null, auth: Boolean = true, timeoutMs: Int = 5000): Resp {
        val c = URL(CoreConfig.base(ctx) + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs; c.useCaches = false
        if (auth) c.setRequestProperty("Authorization", "Bearer " + CoreConfig.admin(ctx))
        if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json"); c.outputStream.use { it.write(body.toString().toByteArray()) } }
        return try {
            val code = c.responseCode
            val text = (if (code < 400) c.inputStream else c.errorStream)?.use { it.readBytes().decodeToString() } ?: ""
            Resp(code, text, c.headerFields.filterKeys { it != null })
        } finally { c.disconnect() }
    }

    /** Ядро живо И это наше ядро: оно подписало случайный nonce нашим секретом. Чужой процесс на порту пароль не получит. */
    fun health(ctx: Context): JSONObject? = runCatching {
        val nonce = java.util.UUID.randomUUID().toString()
        val r = call(ctx, "GET", "/healthz?nonce=$nonce", auth = false, timeoutMs = 1500)
        val j = JSONObject(r.body)
        val mac = javax.crypto.Mac.getInstance("HmacSHA256").apply { init(javax.crypto.spec.SecretKeySpec(CoreConfig.load(ctx).getString("secret").toByteArray(), "HmacSHA256")) }
        val want = mac.doFinal("svetlana-health:$nonce".toByteArray()).joinToString("") { "%02x".format(it) }
        if (r.code == 200 && java.security.MessageDigest.isEqual(want.toByteArray(), j.optString("proof").toByteArray())) j else null
    }.getOrNull()

    /** Скачать файл из ядра (документ, PDF) внутри приложения — пароль не уходит системному загрузчику. */
    fun fetchBytes(ctx: Context, path: String): ByteArray? = runCatching {
        if (health(ctx) == null) return@runCatching null
        val c = URL(CoreConfig.base(ctx) + path).openConnection() as HttpURLConnection
        c.setRequestProperty("Authorization", "Bearer " + CoreConfig.admin(ctx)); c.connectTimeout = 5000; c.readTimeout = 60000
        try { if (c.responseCode == 200) c.inputStream.use { it.readBytes() } else null } finally { c.disconnect() }
    }.getOrNull()

    fun providersEmpty(ctx: Context): Boolean = runCatching { JSONArray(call(ctx, "GET", "/api/providers").body).length() == 0 }.getOrDefault(false)

    /** Вход в веб-чат без ввода пароля: получаем cookie сессии для WebView. */
    fun loginCookie(ctx: Context): String? = runCatching {
        val r = call(ctx, "POST", "/api/login", JSONObject().put("token", CoreConfig.admin(ctx)), auth = false)
        r.headers.entries.firstOrNull { it.key.equals("Set-Cookie", true) }?.value?.firstOrNull()?.substringBefore(";")
    }.getOrNull()

    /** Ключ устройства для «Рук» этого же телефона (видеть экран и нажимать), как у Светланы на Windows. */
    fun ensureDevice(ctx: Context, prefs: Prefs): Boolean = runCatching {
        val known = JSONArray(call(ctx, "GET", "/api/devices").body)
        val ids = (0 until known.length()).map { known.getJSONObject(it).optString("id") }
        if (prefs.token.isNotBlank() && prefs.deviceId in ids && prefs.url == "ws://127.0.0.1:${CoreConfig.port(ctx)}/ws/device") return@runCatching true
        val r = JSONObject(call(ctx, "POST", "/api/devices/pair", JSONObject().put("name", "Этот телефон (${android.os.Build.MODEL})".take(60)).put("platform", "android")).body)
        val tok = r.optString("token"); if (!tok.startsWith("dev_")) return@runCatching false
        prefs.url = "ws://127.0.0.1:${CoreConfig.port(ctx)}/ws/device"; prefs.token = tok; prefs.deviceId = r.optString("deviceId")
        true
    }.getOrDefault(false)

    fun upsertProvider(ctx: Context, p: JSONObject): Boolean = runCatching { call(ctx, "POST", "/api/providers", p).code == 200 }.getOrDefault(false)
    fun removeProvider(ctx: Context, id: String) { runCatching { call(ctx, "DELETE", "/api/providers?id=$id") } }
}
