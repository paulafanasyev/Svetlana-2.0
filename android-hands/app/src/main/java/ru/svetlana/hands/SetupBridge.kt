package ru.svetlana.hands

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface

/**
 * Мост мастера первого запуска (window.SvetlanaSetup): веб-чат сам оценивает телефон, качает совместимую модель,
 * включает её — или ведёт в облако, если телефон слабый. Методы зовутся из потока WebView (не UI) и возвращают строки/JSON.
 */
class SetupBridge(private val a: Activity) {
    private val ctx get() = a.applicationContext

    /** Телефон, проверки, итог (local / weak / cloud), модели со статусом загрузки и состояние модели на телефоне. */
    @JavascriptInterface fun report(): String = runCatching { ModelStore.report(ctx).toString() }.getOrElse { """{"error":${org.json.JSONObject.quote(it.message ?: "ошибка")}}""" }

    private fun safe(f: () -> String): String = runCatching(f).getOrElse { "Ошибка телефона: ${it.message ?: it.javaClass.simpleName}" }
    private fun model(id: String, f: (Model) -> String): String = safe { Models.byId(id)?.let(f) ?: "Нет такой модели" }

    /** "" — загрузка пошла; иначе текст ошибки для пользователя. */
    @JavascriptInterface fun download(id: String): String = model(id) { ModelStore.start(ctx, it) }
    @JavascriptInterface fun cancel(id: String): String = model(id) { ModelStore.cancel(ctx, it); "" }
    /** "" — включаю; "warn:…" — мало свободной памяти, спросить и повторить с force=true; иначе ошибка. */
    @JavascriptInterface fun enable(id: String, force: Boolean): String = model(id) { ModelStore.enable(ctx, it, force) }
    @JavascriptInterface fun disable(): String = safe { ModelStore.disable(ctx); "" }
    @JavascriptInterface fun remove(id: String): String = model(id) { ModelStore.remove(ctx, it); "" }
    /** «Позже» / «Готово»: само больше не открываться (true) или снова предлагать (false). */
    @JavascriptInterface fun skip(v: Boolean): String = safe { ModelStore.setSkipped(ctx, v); "" }
    @JavascriptInterface fun skipped(): Boolean = runCatching { ModelStore.skipped(ctx) }.getOrDefault(false)
    /** Подробный нативный экран моделей (для тех, кому нужно больше). */
    @JavascriptInterface fun openModels() = a.runOnUiThread { a.startActivity(Intent(a, ModelsActivity::class.java)) }
}
