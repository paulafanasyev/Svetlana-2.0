package ru.svetlana.app

import android.content.Context
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Связь с устройствами домашней сети, как в версии для Windows: локальная модель на компьютере (Ollama, LM Studio)
 * и мост Svetlana-home. Страница открыта по https и сама не может ходить по http, поэтому запрос делает нативная часть.
 *
 * - только IP домашней сети (10.x, 172.16–31.x, 192.168.x) или этот телефон (127.x, localhost), без DNS: адрес не подменить;
 * - только GET и POST с JSON, без перенаправлений и куки, размер (до 8 МБ, как у облака) и частота ограничены;
 * - любой запрос (и GET, и POST) на новый адрес только после нативного подтверждения: иначе чужой скрипт мог бы
 *   читать страницы роутера и других устройств сети. Разрешение действует 30 дней (адрес в сети может
 *   достаться другому устройству) и стирается вместе с ключами (secret_wipe_all).
 */
object LanHttp {
    private const val PREFS = "svetlana_lan_v1"
    private const val KEY = "allowed"
    const val MAX_BODY = 2 * 1024 * 1024
    const val MAX_RESPONSE = 8 * 1024 * 1024
    private const val MAX_LINE = 16 * 1024
    private const val MAX_HEADERS = 100
    private const val CONNECT_MS = 5_000
    private const val READ_MS = 180_000
    private const val PER_MINUTE = 120
    /** Сколько дней действует разрешение на адрес. */
    private const val ALLOW_DAYS = 30L
    private const val DAY_MS = 24L * 60 * 60 * 1000
    const val BAD = "Адрес должен быть в домашней сети или на этом телефоне, например http://192.168.1.10:11434"
    private const val BAD_REPLY = "Устройство ответило непонятно"
    private const val TOO_BIG = "Слишком большой ответ устройства"
    private val URL_RE = Regex("^http://((?:\\d{1,3}\\.){3}\\d{1,3}|localhost)(?::(\\d{1,5}))?(/[A-Za-z0-9._~%/:@=+,-]*)?(\\?[A-Za-z0-9._~%/:@=&+,-]*)?$")
    private val STATUS_RE = Regex("^HTTP/1\\.[01] (\\d{3})")
    private val calls = ArrayDeque<Long>()

    class Target(val host: String, val port: Int, val path: String) {
        val key: String get() = "$host:$port"
    }

    /** Разобрать и проверить адрес: только http и только домашняя сеть или этот телефон. */
    fun parse(url: String): Target {
        val m = URL_RE.matchEntire(url.trim()) ?: throw SecureAi.Fail(BAD)
        val raw = m.groupValues[1]
        val host = if (raw == "localhost") "127.0.0.1" else raw
        val o = host.split('.').map { it.toIntOrNull() ?: 999 }
        if (o.size != 4 || o.any { it > 255 }) throw SecureAi.Fail(BAD)
        val a = o[0]
        val b = o[1]
        val home = a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || a == 127
        if (!home) throw SecureAi.Fail(BAD)
        val port = m.groupValues[2].ifEmpty { "80" }.toInt()
        if (port !in 1..65535) throw SecureAi.Fail(BAD)
        return Target(host, port, m.groupValues[3].ifEmpty { "/" } + m.groupValues[4])
    }

    /** День, когда выдано разрешение на адрес, или null. Записи старого вида (без дня) считаются истёкшими. */
    private fun grantedDay(entry: String, key: String): Long? =
        if (entry.startsWith("$key@")) entry.substringAfter('@').toLongOrNull() else null

    private fun allowed(ctx: Context, key: String): Boolean {
        val today = System.currentTimeMillis() / DAY_MS
        val set = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY, emptySet()) ?: emptySet()
        return set.any { e -> grantedDay(e, key)?.let { today - it in 0..ALLOW_DAYS } == true }
    }

    private fun allow(ctx: Context, key: String) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val today = System.currentTimeMillis() / DAY_MS
        val set = HashSet(p.getStringSet(KEY, emptySet()) ?: emptySet())
        // Убираем старое разрешение этого адреса, записи старого вида и истёкшие.
        set.removeAll { e -> e == key || !e.contains('@') || e.startsWith("$key@") || (e.substringAfter('@').toLongOrNull()?.let { today - it !in 0..ALLOW_DAYS } ?: true) }
        if (set.size >= 50) set.clear()
        set.add("$key@$today")
        p.edit().putStringSet(KEY, set).apply()
    }

    /** Забыть все разрешённые адреса («Удалить всё»). */
    fun forgetAll(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
    }

    private fun rateOk(): Boolean = synchronized(calls) {
        val now = System.currentTimeMillis()
        while (calls.isNotEmpty() && now - calls.first() > 60_000) calls.removeFirst()
        if (calls.size >= PER_MINUTE) return false
        calls.addLast(now)
        true
    }

    /** Выполнить запрос. Вызывать не из главного потока. Ответ: {status, body}. */
    fun request(ctx: Context, url: String, method: String, body: String, confirm: (String) -> Boolean): JSONObject {
        val t = parse(url)
        val m = method.uppercase()
        if (m != "GET" && m != "POST") throw SecureAi.Fail("Разрешены только запросы GET и POST")
        val bytes = if (m == "POST") body.toByteArray(Charsets.UTF_8) else ByteArray(0)
        if (bytes.size > MAX_BODY) throw SecureAi.Fail("Запрос слишком большой")
        if (!rateOk()) throw SecureAi.Fail("Слишком много запросов в домашнюю сеть, подождите минуту")
        if (!allowed(ctx, t.key)) {
            val where = if (t.host.startsWith("127.")) "на этом телефоне (${t.key})" else "в домашней сети (${t.key})"
            val ok = confirm(
                "Разрешить Светлане связываться с устройством $where: читать с него ответы и отправлять ему данные?\n\n" +
                    "Так работают локальная модель на вашем компьютере (Ollama, LM Studio) и Svetlana-home. " +
                    "Разрешайте только своё устройство. Разрешение действует 30 дней."
            )
            if (!ok) throw SecureAi.Fail(SecureAi.CANCELLED)
            allow(ctx, t.key)
        }
        return try {
            exchange(t, m, bytes)
        } catch (e: SecureAi.Fail) {
            throw e
        } catch (e: java.net.SocketTimeoutException) {
            throw SecureAi.Fail("Устройство ${t.key} не ответило вовремя")
        } catch (e: java.io.IOException) {
            throw SecureAi.Fail("Нет связи с ${t.key}: проверьте, что устройство включено и в той же Wi‑Fi сети")
        }
    }

    private fun exchange(t: Target, method: String, body: ByteArray): JSONObject {
        val s = Socket()
        try {
            s.connect(InetSocketAddress(t.host, t.port), CONNECT_MS)
            s.soTimeout = READ_MS
            val head = StringBuilder()
                .append(method).append(' ').append(t.path).append(" HTTP/1.1\r\n")
                .append("Host: ").append(t.key).append("\r\n")
                .append("User-Agent: Svetlana-Android\r\n")
                .append("Accept: application/json\r\n")
                .append("Connection: close\r\n")
            if (method == "POST") {
                head.append("Content-Type: application/json\r\n").append("Content-Length: ").append(body.size).append("\r\n")
            }
            head.append("\r\n")
            val out = s.getOutputStream()
            out.write(head.toString().toByteArray(Charsets.US_ASCII))
            if (body.isNotEmpty()) out.write(body)
            out.flush()
            val inp = BufferedInputStream(s.getInputStream())
            val status = STATUS_RE.find(line(inp))?.groupValues?.get(1)?.toInt() ?: throw SecureAi.Fail(BAD_REPLY)
            var length = -1L
            var chunked = false
            var n = 0
            while (true) {
                val h = line(inp)
                if (h.isEmpty()) break
                if (++n > MAX_HEADERS) throw SecureAi.Fail(BAD_REPLY)
                val k = h.substringBefore(':').trim().lowercase()
                val v = h.substringAfter(':', "").trim()
                if (k == "content-length") length = v.toLongOrNull() ?: throw SecureAi.Fail(BAD_REPLY)
                if (k == "transfer-encoding" && v.lowercase().contains("chunked")) chunked = true
            }
            val data = when {
                chunked -> readChunked(inp)
                length >= 0 -> {
                    if (length > MAX_RESPONSE) throw SecureAi.Fail(TOO_BIG)
                    readExact(inp, length.toInt())
                }
                else -> readAll(inp)
            }
            return JSONObject().put("status", status).put("body", String(data, Charsets.UTF_8))
        } finally {
            runCatching { s.close() }
        }
    }

    /** Строка до \n (без \r), не длиннее MAX_LINE. */
    private fun line(inp: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = inp.read()
            if (c < 0) {
                if (b.size() == 0) throw SecureAi.Fail(BAD_REPLY)
                break
            }
            if (c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
            if (b.size() > MAX_LINE) throw SecureAi.Fail(BAD_REPLY)
        }
        return String(b.toByteArray(), Charsets.ISO_8859_1)
    }

    private fun readExact(inp: InputStream, n: Int): ByteArray {
        val buf = ByteArray(n)
        var off = 0
        while (off < n) {
            val r = inp.read(buf, off, n - off)
            if (r < 0) throw SecureAi.Fail(BAD_REPLY)
            off += r
        }
        return buf
    }

    private fun readAll(inp: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val r = inp.read(buf)
            if (r < 0) break
            out.write(buf, 0, r)
            if (out.size() > MAX_RESPONSE) throw SecureAi.Fail(TOO_BIG)
        }
        return out.toByteArray()
    }

    private fun readChunked(inp: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        while (true) {
            // Размер чанка — Long и не больше лимита: без переполнения и огромных буферов.
            val size = line(inp).substringBefore(';').trim().toLongOrNull(16) ?: throw SecureAi.Fail(BAD_REPLY)
            if (size < 0) throw SecureAi.Fail(BAD_REPLY)
            if (size == 0L) {
                // хвостовые заголовки до пустой строки
                var n = 0
                while (runCatching { line(inp) }.getOrDefault("").isNotEmpty() && ++n < MAX_HEADERS) { /* пропускаем */ }
                break
            }
            if (size > MAX_RESPONSE || out.size().toLong() + size > MAX_RESPONSE) throw SecureAi.Fail(TOO_BIG)
            out.write(readExact(inp, size.toInt()))
            line(inp)
        }
        return out.toByteArray()
    }
}
