package ru.svetlana.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Build
import org.json.JSONObject

fun norm(s: String): String = s.lowercase()
    .replace('ё', 'е')
    .replace(Regex("[\"'«»“”„.,!?:;]"), " ")
    .replace(Regex("\\s+"), " ")
    .trim()

/**
 * Один шаг «рук». Их предлагает Светлана (JSON в ответе) или быстрая команда («открой Telegram»).
 * В подписях для окна подтверждения нет переводов строки, управляющих и bidi-символов (Steps.safe):
 * ИИ или название приложения не могут дорисовать в окне лишние строки.
 * Шаги те же, что у рук телефона в Windows-версии (Svetlana-home): открыть, нажать, долго нажать, смахнуть,
 * напечатать, очистить поле, «Ввод», прокрутка, «Назад»/«Домой»/«Недавние», чтение экрана.
 */
sealed class Step(val title: String) {
    /** target — уже найденное приложение: его название и пакет видны в окне подтверждения. */
    class OpenApp(val name: String, val target: Apps.Target? = null) :
        Step(if (target != null) "Открыть «${Steps.safe(target.label, 60)}» (${target.pkg})" else "Открыть «${Steps.safe(name, 60)}»")
    class Tap(val target: String) : Step("Нажать «${Steps.safe(target, 80)}»")
    class LongPress(val target: String) : Step("Долго нажать «${Steps.safe(target, 80)}»")
    class Type(val text: String, val field: String?) :
        Step("Напечатать «${Steps.safe(text, 60)}${if (text.length > 60) "…" else ""}»${if (field != null) " в поле «${Steps.safe(field, 40)}»" else ""}")
    class Clear(val field: String?) : Step(if (field != null) "Очистить поле «${Steps.safe(field, 40)}»" else "Очистить поле ввода")
    object Enter : Step("Нажать «Ввод» на клавиатуре")
    class Scroll(val down: Boolean) : Step(if (down) "Пролистать вниз" else "Пролистать вверх")
    class Swipe(val dir: String) : Step(
        when (dir) { "left" -> "Смахнуть влево"; "right" -> "Смахнуть вправо"; "up" -> "Смахнуть вверх"; else -> "Смахнуть вниз" }
    )
    class Global(val action: Int, name: String) : Step(name)
    object ReadScreen : Step("Прочитать экран")
    class Wait(val ms: Long) : Step("Подождать")
}

object Steps {
    private val JSON_BLOCK = Regex("```(?:json)?\\s*(\\{[\\s\\S]*?\\})\\s*```")
    private val RISKY = listOf("отправ", "оплат", "заплат", "купить", "купи", "удал", "позвон", "вызов", "перевест", "перевод", "подтверд", "опублик", "send", "pay", "buy", "delete", "call")
    private val BIDI = Regex("[\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]")
    private val SWIPE_DIRS = setOf("left", "right", "up", "down")
    const val NEED_OPEN_APP = "после «Назад», «Домой» или уведомлений сначала нужно открыть приложение («открой …»), чтобы не нажать в случайном"
    const val TYPE_WARNING = "⚠ Светлана напечатает текст в другом приложении или очистит поле. Не разрешайте, если это пароль, код из СМС или номер карты."

    /** Текст для окна подтверждения: без управляющих и bidi-символов, в одну строку, ограниченной длины. */
    fun safe(s: String, max: Int = 200): String =
        s.replace(BIDI, "").map { if (it.isISOControl() || it.isWhitespace()) ' ' else it }.joinToString("")
            .replace(Regex(" +"), " ").trim().take(max)

    fun back() = Step.Global(AccessibilityService.GLOBAL_ACTION_BACK, "Назад")
    fun home() = Step.Global(AccessibilityService.GLOBAL_ACTION_HOME, "На главный экран")

    /** Отделяет текст ответа от блока ```json {"actions": [...]}```. */
    fun split(reply: String): Pair<String, List<Step>> {
        val m = JSON_BLOCK.find(reply) ?: return reply.trim() to emptyList()
        val steps = try { parse(JSONObject(m.groupValues[1])) } catch (e: Exception) { emptyList() }
        if (steps.isEmpty()) return reply.trim() to emptyList()
        return reply.removeRange(m.range).trim() to steps
    }

    fun parse(o: JSONObject): List<Step> {
        val arr = o.optJSONArray("actions") ?: return emptyList()
        val out = ArrayList<Step>()
        for (i in 0 until minOf(arr.length(), 12)) {
            val a = arr.optJSONObject(i) ?: continue
            val s: Step? = when (a.optString("type")) {
                "open_app" -> a.optString("name").takeIf { it.isNotBlank() }?.let { Step.OpenApp(it.take(60)) }
                "tap" -> a.optString("target").takeIf { it.isNotBlank() }?.let { Step.Tap(it.take(80)) }
                "long_press" -> a.optString("target").takeIf { it.isNotBlank() }?.let { Step.LongPress(it.take(80)) }
                "type" -> a.optString("text").takeIf { it.isNotEmpty() }?.let { t ->
                    Step.Type(t.take(2000), a.optString("field").takeIf { f -> f.isNotBlank() })
                }
                "clear" -> Step.Clear(a.optString("field").takeIf { it.isNotBlank() }?.take(80))
                "enter" -> Step.Enter
                "scroll" -> Step.Scroll(a.optString("direction") != "up")
                "swipe" -> Step.Swipe(a.optString("direction").takeIf { it in SWIPE_DIRS } ?: "left")
                "back" -> back()
                "home" -> home()
                "recents" -> Step.Global(AccessibilityService.GLOBAL_ACTION_RECENTS, "Недавние приложения")
                "notifications" -> Step.Global(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS, "Открыть уведомления")
                "read_screen" -> Step.ReadScreen
                "wait" -> Step.Wait(a.optLong("ms", 1000L).coerceIn(200L, 5000L))
                else -> null
            }
            if (s != null) out.add(s)
        }
        return out
    }

    /** Найти приложения заранее, чтобы показать в окне подтверждения, ЧТО именно откроется. */
    fun resolveApps(ctx: Context, steps: List<Step>): List<Step> = steps.map { s ->
        if (s is Step.OpenApp && s.target == null) {
            val t = Apps.resolve(ctx, s.name)
                ?: throw SecureAi.Fail("Не нашла приложение «${safe(s.name, 60)}» на телефоне (для известных приложений — только официальное)")
            Step.OpenApp(s.name, t)
        } else {
            s
        }
    }

    /** Быстрые команды без сервера: работают сразу и даже без ключа. */
    fun quick(input: String): List<Step>? {
        var t = norm(input)
        for (p in listOf("света ", "светлана ", "светочка ", "пожалуйста ")) t = t.removePrefix(p)
        t = t.removeSuffix(" пожалуйста").trim()
        when (t) {
            "назад" -> return listOf(back())
            "домой", "на главный экран", "главный экран" -> return listOf(home())
            "что на экране", "прочитай экран" -> return listOf(Step.ReadScreen)
            "уведомления", "открой уведомления", "покажи уведомления" ->
                return listOf(Step.Global(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS, "Открыть уведомления"))
            "недавние", "недавние приложения", "покажи недавние" ->
                return listOf(Step.Global(AccessibilityService.GLOBAL_ACTION_RECENTS, "Недавние приложения"))
            "очисти поле", "сотри текст", "очисти текст" -> return listOf(Step.Clear(null))
            "нажми ввод", "нажми enter", "ввод" -> return listOf(Step.Enter)
        }
        Regex("^(?:пролистай|прокрути|листай)(?:\\s+(вниз|вверх))?$").find(t)?.let {
            return listOf(Step.Scroll(it.groupValues[1] != "вверх"))
        }
        Regex("^(?:смахни|свайпни|свайп)\\s+(влево|вправо|вверх|вниз)$").find(t)?.let {
            val d = when (it.groupValues[1]) { "влево" -> "left"; "вправо" -> "right"; "вверх" -> "up"; else -> "down" }
            return listOf(Step.Swipe(d))
        }
        Regex("^(?:открой|запусти)\\s+(?:приложение\\s+)?(.{2,40})$").find(t)?.let {
            return listOf(Step.OpenApp(it.groupValues[1]))
        }
        Regex("^(?:зажми|удержи|долго нажми)(?:\\s+на)?\\s+(.{1,60})$").find(t)?.let {
            return listOf(Step.LongPress(it.groupValues[1]))
        }
        Regex("^(?:нажми|тапни|кликни)(?:\\s+на)?\\s+(.{1,60})$").find(t)?.let {
            return listOf(Step.Tap(it.groupValues[1]))
        }
        Regex("^\\s*(?:света,?\\s+)?(?:напечатай|введи)\\s+(.+)$", RegexOption.IGNORE_CASE).find(input.trim())?.let {
            return listOf(Step.Type(it.groupValues[1].trim(), null))
        }
        return null
    }

    /** «Ввод» часто отправляет сообщение или форму: всегда предупреждаем. */
    fun risky(steps: List<Step>): Boolean = steps.any { s ->
        if (s is Step.Enter) return@any true
        val text = when (s) {
            is Step.Tap -> s.target
            is Step.LongPress -> s.target
            else -> ""
        }
        val n = norm(text)
        n.isNotEmpty() && RISKY.any { n.contains(it) }
    }

    /** Ввод или очистка текста в чужом приложении: отдельное предупреждение (пароль, код из СМС, карта). */
    fun typesText(steps: List<Step>): Boolean = steps.any { it is Step.Type || it is Step.Clear }

    fun needsHands(steps: List<Step>): Boolean = steps.any { it !is Step.OpenApp && it !is Step.Wait }

    private fun touchesScreen(s: Step) = s is Step.Tap || s is Step.LongPress || s is Step.Type || s is Step.Clear ||
        s is Step.Enter || s is Step.Scroll || s is Step.Swipe || s is Step.ReadScreen

    /** Шаги, которые что-то нажимают или меняют на экране (не только читают). */
    private fun acts(s: Step) = touchesScreen(s) && s !is Step.ReadScreen

    /**
     * Выполняет шаги по порядку и останавливается на первой неудаче. Вызывать не из главного потока.
     * Действия на экране привязаны к приложению: после «Открыть X» — к пакету X, иначе к pinned — приложению,
     * которое было на экране ДО окна подтверждения (если после подтверждения сверху выскочило другое
     * приложение, первое же нажатие останавливается). Без pinned — к тому, что было на экране при первом
     * действии. «Назад», «Домой» и т.п. привязку НЕ сбрасывают: если после них сверху другое приложение —
     * остановка; а если привязки ещё не было, дальше нужен «Открыть …».
     * Пакет проверяется и здесь, и в HandsService прямо перед каждым нажатием.
     */
    fun run(ctx: Context, steps: List<Step>, pinned: String? = null): String {
        val log = StringBuilder()
        var expected: String? = pinned
        var unbound = false
        for ((i, s) in steps.withIndex()) {
            val (ok, text) = try {
                if (touchesScreen(s)) {
                    if (expected == null && unbound) throw IllegalStateException(NEED_OPEN_APP)
                    val cur = HandsService.instance?.currentApp()
                    if (expected == null) expected = cur
                    if (cur == null || cur != expected) {
                        throw IllegalStateException("на экране другое приложение (${cur ?: "неизвестно"}), а не ${expected ?: "нужное"}")
                    }
                }
                runOne(ctx, s, if (touchesScreen(s)) expected else null)
            } catch (e: Exception) {
                false to (e.message ?: "ошибка: ${e.javaClass.simpleName}")
            }
            log.append(i + 1).append(". ").append(if (ok) "✅ " else "❌ ").append(text).append('\n')
            if (!ok) {
                log.append("Остановилась, чтобы не нажать лишнего.")
                break
            }
            when (s) {
                is Step.OpenApp -> { expected = s.target?.pkg; unbound = expected == null }
                is Step.Global -> if (expected == null) unbound = true
                else -> {}
            }
            Thread.sleep(if (s is Step.OpenApp) 1800L else 700L)
        }
        return log.toString().trim()
    }

    private fun runOne(ctx: Context, s: Step, pkg: String?): Pair<Boolean, String> {
        if (s is Step.OpenApp) {
            val t = s.target ?: Apps.resolve(ctx, s.name) ?: return false to "не нашла приложение «${safe(s.name, 60)}»"
            return if (Apps.start(ctx, t)) true to "открыла «${safe(t.label, 60)}»" else false to "не получилось открыть «${safe(t.label, 60)}»"
        }
        if (s is Step.Wait) {
            Thread.sleep(s.ms)
            return true to "подождала"
        }
        val hands = HandsService.instance ?: return false to "руки выключены: включите «Светлана: руки» в настройках → Специальные возможности"
        // В окне самой Светланы руки не нажимают и не печатают: иначе ИИ мог бы сам нажать «ОК»
        // в окне подтверждения (ключ, отправка в облако, новые шаги).
        if (acts(s) && (hands.currentApp() == ctx.packageName || pkg == ctx.packageName)) {
            return false to "на экране сама Светлана: здесь руки ничего не нажимают, чтобы никто не подтвердил окна за вас"
        }
        val moved = "экран сменился на другое приложение"
        if (!hands.inApp(pkg)) return false to moved
        return when (s) {
            is Step.Tap -> if (hands.tap(s.target, pkg)) true to "нажала «${safe(s.target, 80)}»" else false to (if (hands.inApp(pkg)) "не нашла кнопку «${safe(s.target, 80)}» (или она внутри другой кнопки)" else moved)
            is Step.LongPress -> if (hands.longPress(s.target, pkg)) true to "долго нажала «${safe(s.target, 80)}»" else false to (if (hands.inApp(pkg)) "не нашла «${safe(s.target, 80)}» (или оно внутри другой кнопки)" else moved)
            is Step.Type -> if (hands.type(s.text, s.field, pkg)) true to "напечатала текст" else false to (if (hands.inApp(pkg)) "не нашла поле для текста" else moved)
            is Step.Clear -> if (hands.clear(s.field, pkg)) true to "очистила поле" else false to (if (hands.inApp(pkg)) "не нашла поле для текста" else moved)
            is Step.Enter -> when {
                Build.VERSION.SDK_INT < 30 -> false to "«Ввод» руками работает на Android 11 и новее: нажмите кнопку отправки сами («нажми …»)"
                hands.enter(pkg) -> true to "нажала «Ввод»"
                else -> false to (if (hands.inApp(pkg)) "нет поля в фокусе для «Ввод»" else moved)
            }
            is Step.Scroll -> if (hands.scroll(s.down, pkg)) true to s.title.lowercase() else false to (if (hands.inApp(pkg)) "не получилось пролистать" else moved)
            is Step.Swipe -> if (hands.swipe(s.dir, pkg)) true to s.title.lowercase() else false to (if (hands.inApp(pkg)) "не получилось смахнуть" else moved)
            is Step.Global -> if (hands.global(s.action)) true to s.title.lowercase() else false to "не получилось: ${s.title.lowercase()}"
            is Step.ReadScreen -> true to ("на экране:\n" + hands.screenText(1500, pkg).ifBlank { "(ничего не видно)" })
            else -> false to "неизвестный шаг"
        }
    }
}
