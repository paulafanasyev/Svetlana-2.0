package ru.svetlana.app

/**
 * Текст для страницы и нативных окон (как scrub_error/clean_text в secure_ai.rs):
 * - из ответа сервиса с ошибкой вырезается ключ (некоторые сервисы повторяют его в тексте ошибки) и всё, что похоже на ключ;
 * - убираются управляющие, невидимые и bidi-символы: иначе в окне подтверждения часть текста можно
 *   спрятать или перевернуть, и человек увидит не то, что уйдёт на самом деле.
 */
object ErrorText {
    const val HIDDEN = "[ключ скрыт]"
    const val MAX_ERROR = 300

    /** Похожее на ключ: sk-…, gsk_…, AIza… и любые длинные строки без пробелов из символов ключей. */
    private val KEY_LIKE = Regex("\\b(?:sk|gsk|pk|rk|AIza)[-_A-Za-z0-9]{12,}|[A-Za-z0-9+/_=-]{40,}")

    /** Управляющие, невидимые и меняющие направление текста символы. */
    fun isHidden(c: Char): Boolean =
        c.isISOControl() ||
            c in '\u200B'..'\u200F' ||
            c in '\u202A'..'\u202E' ||
            c in '\u2060'..'\u2069' ||
            c == '\u061C' ||
            c == '\uFEFF'

    fun clean(s: String): String = s.filter { !isHidden(it) }

    /** Текст ошибки сервиса для страницы: без наших секретов и похожего на ключи, без скрытых символов, коротко. */
    fun scrub(text: String, secrets: Collection<String>, max: Int = MAX_ERROR): String {
        var t = text
        for (s in secrets) if (s.length >= 8) t = t.replace(s, HIDDEN)
        t = KEY_LIKE.replace(t, HIDDEN)
        return clean(t).take(max)
    }
}
