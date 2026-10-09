package ru.svetlana.hands

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** llama-server (llama.cpp) на телефоне: OpenAI-совместимый адрес на 127.0.0.1, вызов инструментов через шаблон модели (--jinja). */
class Llama(private val ctx: Context, private val log: (String) -> Unit) {
    @Volatile private var proc: Process? = null
    @Volatile var port = 0; private set
    @Volatile var model: Model? = null; private set
    /** Ключ сервера модели: другие приложения телефона не смогут ею пользоваться. */
    private val apiKey = java.util.UUID.randomUUID().toString().replace("-", "") + java.util.UUID.randomUUID().toString().replace("-", "")

    private val pidFile get() = File(ctx.filesDir, "llama.pid")

    /** Сирота от прошлого запуска (служба упала, а сервер остался) — гасим, чтобы не держал память. */
    fun killStale() {
        val pid = runCatching { pidFile.readText().trim().toInt() }.getOrNull() ?: return
        val cmd = runCatching { File("/proc/$pid/cmdline").readText() }.getOrDefault("")
        if (cmd.contains("libllama_server.so")) runCatching { android.os.Process.killProcess(pid) }
        pidFile.delete()
    }

    @Synchronized fun start(m: Model): Boolean {
        stop()
        val d = Device.detect(ctx)
        if (!d.offline) { CoreConfig.setLlmStatus(ctx, "error", "На этом телефоне офлайн-модель недоступна (нужен 64-битный Android 9+)"); return false }
        if (!Models.ready(ctx, m)) { CoreConfig.setLlmStatus(ctx, "error", "Модель ещё не скачана"); return false }
        val bin = File(ctx.applicationInfo.nativeLibraryDir, "libllama_server.so")
        port = CoreConfig.freePort()
        val args = mutableListOf(bin.path, "-m", Models.path(ctx, m).path, "--host", "127.0.0.1", "--port", "$port", "-a", "local",
            "-c", "${Models.context(d, m)}", "-t", "${Models.threads(d)}", "-ngl", "0", "--jinja", "--no-webui", "-np", "1", "--api-key", apiKey)
        if (m.id.startsWith("qwen3")) args += listOf("--reasoning-budget", "0") // без «размышлений»: быстрее и короче на телефоне
        Models.mmprojPath(ctx, m)?.let { args += listOf("--mmproj", it.path) }
        val logFile = File(ctx.filesDir, "llama.log")
        CoreConfig.setLlmStatus(ctx, "starting", "Загружаю модель в память…", m.id)
        log("llama: " + args.joinToString(" ") { if (it == apiKey) "***" else it }) // ключ в журнал не пишем
        val pb = ProcessBuilder(args).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(logFile))
        pb.environment()["LD_LIBRARY_PATH"] = ctx.applicationInfo.nativeLibraryDir
        pb.environment()["HOME"] = ctx.filesDir.path; pb.environment()["TMPDIR"] = ctx.cacheDir.path
        val p = try { pb.start() } catch (e: Exception) { CoreConfig.setLlmStatus(ctx, "error", "Модель не запустилась: ${e.message}", m.id); return false }
        proc = p; model = m
        runCatching { val f = p.javaClass.getDeclaredField("pid"); f.isAccessible = true; pidFile.writeText(f.getInt(p).toString()) }
        val t0 = System.currentTimeMillis()
        while (System.currentTimeMillis() - t0 < 180_000) { // большая модель на телефоне грузится до пары минут
            if (!p.isAlive) { CoreConfig.setLlmStatus(ctx, "error", "Модель остановилась при запуске: " + tail(logFile), m.id); proc = null; return false }
            if (healthy() && authorized()) { CoreConfig.setLlmStatus(ctx, "ready", "Работает на телефоне: ${m.title}", m.id); return true }
            Thread.sleep(700)
        }
        stop(); CoreConfig.setLlmStatus(ctx, "error", "Модель не ответила за 3 минуты: " + tail(logFile), m.id); return false
    }

    fun healthy(): Boolean = port > 0 && runCatching {
        val c = URL("http://127.0.0.1:$port/health").openConnection() as HttpURLConnection
        c.connectTimeout = 1000; c.readTimeout = 2000; try { c.responseCode == 200 } finally { c.disconnect() }
    }.getOrDefault(false)

    /** На порту именно наш сервер: защищённый адрес (/tokenize) отвечает с нашим ключом и отказывает без него. */
    private fun authorized(): Boolean {
        fun code(key: String?) = runCatching {
            val c = URL("http://127.0.0.1:$port/tokenize").openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 1000; c.readTimeout = 5000; c.setRequestProperty("Content-Type", "application/json")
            if (key != null) c.setRequestProperty("Authorization", "Bearer $key")
            try { c.outputStream.use { it.write("{\"content\":\"привет\"}".toByteArray()) }; c.responseCode } finally { c.disconnect() }
        }.getOrDefault(-1)
        return code(apiKey) == 200 && code(null) != 200 // без ключа — отказ (401), значит ключ проверяется
    }

    fun alive() = proc?.isAlive == true

    @Synchronized fun stop() {
        proc?.let { p -> p.destroy(); runCatching { if (!p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) p.destroyForcibly() } }
        proc = null; model = null; port = 0; pidFile.delete()
    }

    /** Провайдер «local» в ядре: маленькая модель → компактный режим (нужные инструменты, короткая история). */
    fun provider(m: Model): JSONObject = JSONObject().put("id", "local").put("name", "Светлана на телефоне").put("preset", "openai")
        .put("baseUrl", "http://127.0.0.1:$port/v1").put("apiKey", apiKey).put("model", "local").put("compact", true).put("maxTokens", m.maxTokens).put("timeoutMs", 900_000)
        .put("capabilities", JSONArray(if (m.vision) listOf("chat", "tools", "vision") else listOf("chat", "tools")))

    private fun tail(f: File) = runCatching { f.readLines().takeLast(3).joinToString(" | ").take(300) }.getOrDefault("")
}
