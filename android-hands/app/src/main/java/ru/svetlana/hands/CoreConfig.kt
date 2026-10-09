package ru.svetlana.hands

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.ServerSocket
import java.security.SecureRandom

/** Общие настройки ядра для обоих процессов приложения (окно и фоновая служба): файл в личной папке приложения. */
object CoreConfig {
    private fun file(ctx: Context) = File(ctx.filesDir, "core.json")
    private fun rnd(n: Int): String { val b = ByteArray(n); SecureRandom().nextBytes(b); return b.joinToString("") { "%02x".format(it) } }
    fun freePort(): Int = ServerSocket(0).use { it.localPort }

    @Synchronized fun load(ctx: Context): JSONObject {
        val f = file(ctx)
        val j = runCatching { JSONObject(f.readText()) }.getOrElse { JSONObject() }
        var changed = false
        fun def(k: String, v: () -> Any) { if (!j.has(k)) { j.put(k, v()); changed = true } }
        def("port") { 8787 }
        def("adminToken") { rnd(24) }
        def("secret") { rnd(32) }
        def("pdfToken") { rnd(16) }
        if (changed) save(ctx, j)
        return j
    }
    @Synchronized fun save(ctx: Context, j: JSONObject) { val f = file(ctx); val t = File(f.path + ".tmp"); t.writeText(j.toString()); t.renameTo(f) }
    @Synchronized fun update(ctx: Context, block: (JSONObject) -> Unit): JSONObject { val j = load(ctx); block(j); save(ctx, j); return j }

    fun port(ctx: Context) = load(ctx).getInt("port")
    fun base(ctx: Context) = "http://127.0.0.1:${port(ctx)}"
    fun admin(ctx: Context): String = load(ctx).getString("adminToken")

    /** Состояние модели на телефоне — пишет служба, читает окно «Модель ИИ». */
    fun llmStatus(ctx: Context): JSONObject = runCatching { JSONObject(File(ctx.filesDir, "llm-status.json").readText()) }.getOrElse { JSONObject().put("state", "off") }
    fun setLlmStatus(ctx: Context, state: String, text: String, model: String? = null) {
        val f = File(ctx.filesDir, "llm-status.json"); val t = File(f.path + ".tmp")
        t.writeText(JSONObject().put("state", state).put("text", text).put("model", model ?: JSONObject.NULL).put("at", System.currentTimeMillis()).toString()); t.renameTo(f)
    }
}
