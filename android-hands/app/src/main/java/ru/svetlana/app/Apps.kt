package ru.svetlana.app

import android.content.Context
import android.content.Intent

/**
 * Поиск и запуск установленных приложений по названию (по-русски и по-английски).
 * Для популярных приложений сначала ищем официальный пакет: подделка с тем же названием не выиграет.
 * В окне подтверждения показывается и название, и пакет найденного приложения.
 */
object Apps {
    private val ALIASES = mapOf(
        "телеграм" to "telegram", "телеграмм" to "telegram", "телега" to "telegram", "телегу" to "telegram",
        "ватсап" to "whatsapp", "вотсап" to "whatsapp", "вацап" to "whatsapp",
        "ютуб" to "youtube", "ютьюб" to "youtube", "вконтакте" to "vk", "вк" to "vk",
        "хром" to "chrome", "браузер" to "chrome", "гугл" to "google", "карты" to "maps",
        "камера" to "camera", "камеру" to "camera", "настройки" to "settings", "калькулятор" to "calculator",
        "галерея" to "gallery", "галерею" to "gallery", "фото" to "photos", "почта" to "gmail", "почту" to "gmail",
        "календарь" to "calendar", "часы" to "clock", "будильник" to "clock", "телефон" to "dialer",
        "сообщения" to "messaging", "музыку" to "music", "музыка" to "music", "контакты" to "contacts"
    )

    /** Официальные пакеты популярных приложений. */
    private val KNOWN = mapOf(
        "telegram" to listOf("org.telegram.messenger", "org.telegram.messenger.web"),
        "whatsapp" to listOf("com.whatsapp", "com.whatsapp.w4b"),
        "youtube" to listOf("com.google.android.youtube"),
        "vk" to listOf("com.vkontakte.android"),
        "chrome" to listOf("com.android.chrome"),
        "gmail" to listOf("com.google.android.gm"),
        "maps" to listOf("com.google.android.apps.maps", "ru.yandex.yandexmaps"),
        "google" to listOf("com.google.android.googlequicksearchbox"),
        "photos" to listOf("com.google.android.apps.photos"),
        "settings" to listOf("com.android.settings"),
    )

    /** Найденное приложение: название и пакет (пакет показываем в окне подтверждения). */
    data class Target(val label: String, val pkg: String)

    private fun all(ctx: Context): List<Target> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val found = pm.queryIntentActivities(intent, 0)
        return found.map { Target(it.loadLabel(pm).toString(), it.activityInfo.packageName) }
            .filter { it.pkg != ctx.packageName }
            .distinctBy { it.pkg }
    }

    fun labels(ctx: Context, max: Int = 80): List<String> = all(ctx).map { it.label }.sorted().take(max)

    /** Какое приложение откроется по этому названию (или null). */
    fun resolve(ctx: Context, name: String): Target? {
        val q = norm(name)
        if (q.isEmpty()) return null
        val alias = ALIASES[q]
        val apps = all(ctx)
        KNOWN[alias ?: q]?.forEach { pkg -> apps.firstOrNull { it.pkg == pkg }?.let { return it } }
        fun score(a: Target): Int {
            val l = norm(a.label)
            val p = a.pkg.lowercase()
            return when {
                l == q -> 0
                alias != null && l == alias -> 1
                alias != null && p.contains(alias) -> 2
                l.startsWith(q) -> 3
                l.contains(q) -> 4
                alias != null && l.contains(alias) -> 5
                q.length >= 4 && p.contains(q) -> 6
                else -> 99
            }
        }
        return apps.minByOrNull { score(it) }?.takeIf { score(it) < 99 }
    }

    fun start(ctx: Context, t: Target): Boolean {
        val launch = ctx.packageManager.getLaunchIntentForPackage(t.pkg) ?: return false
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(launch)
        return true
    }

    /** Запускает приложение и возвращает его название, или null, если такого нет. */
    fun launch(ctx: Context, name: String): String? {
        val t = resolve(ctx, name) ?: return null
        return if (start(ctx, t)) t.label else null
    }
}
