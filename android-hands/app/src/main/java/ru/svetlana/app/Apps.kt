package ru.svetlana.app

import android.content.Context
import android.content.Intent

/** Поиск и запуск установленных приложений по названию (по-русски и по-английски). */
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

    private data class App(val label: String, val pkg: String)

    private fun all(ctx: Context): List<App> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val found = pm.queryIntentActivities(intent, 0)
        return found.map { App(it.loadLabel(pm).toString(), it.activityInfo.packageName) }
            .filter { it.pkg != ctx.packageName }
            .distinctBy { it.pkg }
    }

    fun labels(ctx: Context, max: Int = 80): List<String> = all(ctx).map { it.label }.sorted().take(max)

    /** Запускает приложение и возвращает его название, или null, если такого нет. */
    fun launch(ctx: Context, name: String): String? {
        val q = norm(name)
        if (q.isEmpty()) return null
        val alias = ALIASES[q]
        fun score(a: App): Int {
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
        val best = all(ctx).minByOrNull { score(it) }?.takeIf { score(it) < 99 } ?: return null
        val launch = ctx.packageManager.getLaunchIntentForPackage(best.pkg) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(launch)
        return best.label
    }
}
