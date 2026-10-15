package ru.svetlana.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Руки Светланы: чтение экрана и действия в других приложениях через спец. возможности Android.
 * Сервис ничего не делает сам: только выполняет шаги, которые подтвердил человек (Steps.run).
 * pkg — приложение, в котором разрешено действовать: проверяется и у элемента, и у активного окна
 * непосредственно перед нажатием, вводом текста и внутри самого жеста (прямо перед dispatchGesture).
 * Открытого «жеста без привязки» нет: все жесты через gestureIn(pkg, ...).
 * Нажимается только то, что подписано как в подтверждении: родительский элемент нажимается, только если его
 * подпись ТОЧНО совпадает с запрошенной (или у него нет своей подписи). Текст печатается и стирается
 * только в поле из подтверждения: если поле названо, а его нет, ничего не делаем.
 */
class HandsService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: HandsService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    private fun nodes(limit: Int = 2500): List<AccessibilityNodeInfo> {
        val root = rootInActiveWindow ?: return emptyList()
        val out = ArrayList<AccessibilityNodeInfo>()
        val queue = java.util.ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty() && out.size < limit) {
            val n = queue.poll() ?: break
            out.add(n)
            for (i in 0 until n.childCount) {
                n.getChild(i)?.let { queue.add(it) }
            }
        }
        return out
    }

    private fun label(n: AccessibilityNodeInfo): String {
        val parts = listOfNotNull(n.text?.toString(), n.contentDescription?.toString(), n.hintText?.toString())
        return parts.filter { it.isNotBlank() }.distinct().joinToString(" ").trim()
    }

    fun currentApp(): String? = rootInActiveWindow?.packageName?.toString()

    /** Активное окно принадлежит нужному приложению (null — привязки нет). */
    fun inApp(pkg: String?): Boolean = pkg == null || currentApp() == pkg

    private fun nodeIn(n: AccessibilityNodeInfo, pkg: String?): Boolean = pkg == null || n.packageName?.toString() == pkg

    fun screenText(limit: Int = 3000, pkg: String? = null): String {
        if (!inApp(pkg)) return ""
        val sb = StringBuilder()
        val seen = HashSet<String>()
        for (n in nodes()) {
            if (!n.isVisibleToUser || !nodeIn(n, pkg)) continue
            val t = label(n)
            if (t.isNotEmpty() && seen.add(t)) {
                sb.append(t).append('\n')
                if (sb.length > limit) break
            }
        }
        return sb.toString().take(limit).trim()
    }

    /** Элемент по тексту, описанию, подсказке или id. Точное совпадение важнее частичного. */
    fun find(query: String, pkg: String? = null): AccessibilityNodeInfo? {
        val q = norm(query)
        if (q.isEmpty()) return null
        var best: AccessibilityNodeInfo? = null
        var bestScore = Int.MAX_VALUE
        for (n in nodes()) {
            if (!n.isVisibleToUser || !nodeIn(n, pkg)) continue
            val l = norm(label(n))
            val id = n.viewIdResourceName?.substringAfterLast('/')?.lowercase() ?: ""
            val score = when {
                l.isNotEmpty() && l == q -> 0
                l.startsWith(q) -> 10 + (l.length - q.length).coerceAtMost(80)
                l.contains(q) -> 100 + l.length.coerceAtMost(200)
                id.isNotEmpty() && id.contains(q.replace(' ', '_')) -> 400
                else -> continue
            }
            if (score < bestScore) {
                bestScore = score
                best = n
            }
        }
        return best
    }

    fun tap(query: String, pkg: String? = null): Boolean {
        if (!inApp(pkg)) return false
        val q = norm(query)
        val node = find(query, pkg) ?: return false
        var n: AccessibilityNodeInfo? = node
        var depth = 0
        while (n != null && depth < 8) {
            if (n.isClickable && n.isEnabled && nodeIn(n, pkg)) {
                // Родитель с собственной подписью нажимаем, только если она ТОЧНО как в подтверждении:
                // «Подробнее — Оплатить» вокруг текста «Подробнее» — это другая кнопка.
                if (depth > 0) {
                    val own = norm(label(n))
                    if (own.isNotEmpty() && own != q) return false
                }
                if (!n.refresh() || !n.isVisibleToUser || !inApp(pkg)) return false
                if (n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
                break
            }
            n = n.parent
            depth++
        }
        return tapNode(node, pkg, 60)
    }

    /** Долгое нажатие: те же правила точной подписи, что и у обычного. */
    fun longPress(query: String, pkg: String? = null): Boolean {
        if (!inApp(pkg)) return false
        val q = norm(query)
        val node = find(query, pkg) ?: return false
        var n: AccessibilityNodeInfo? = node
        var depth = 0
        while (n != null && depth < 8) {
            if (n.isLongClickable && n.isEnabled && nodeIn(n, pkg)) {
                if (depth > 0) {
                    val own = norm(label(n))
                    if (own.isNotEmpty() && own != q) return false
                }
                if (!n.refresh() || !n.isVisibleToUser || !inApp(pkg)) return false
                if (n.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) return true
                break
            }
            n = n.parent
            depth++
        }
        return tapNode(node, pkg, 900)
    }

    /** Нажатие по координатам элемента: элемент должен ещё существовать, быть виден и принадлежать pkg. */
    private fun tapNode(n: AccessibilityNodeInfo, pkg: String?, durationMs: Long): Boolean {
        if (!n.refresh() || !n.isVisibleToUser || !nodeIn(n, pkg)) return false
        val r = Rect()
        n.getBoundsInScreen(r)
        if (r.isEmpty) return false
        return gestureIn(pkg, r.exactCenterX(), r.exactCenterY(), r.exactCenterX(), r.exactCenterY(), durationMs)
    }

    /** Жест только в нужном приложении: проверка активного окна — последнее перед dispatchGesture. */
    private fun gestureIn(pkg: String?, x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): Boolean {
        val path = Path()
        path.moveTo(x1, y1)
        if (x1 != x2 || y1 != y2) path.lineTo(x2, y2)
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, durationMs)).build()
        if (pkg == null || !inApp(pkg)) return false
        return dispatchGesture(g, null, null)
    }

    fun scroll(down: Boolean, pkg: String? = null): Boolean {
        if (!inApp(pkg)) return false
        val action = if (down) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        val target = nodes().firstOrNull { it.isScrollable && it.isVisibleToUser && nodeIn(it, pkg) }
        if (target != null && inApp(pkg) && target.performAction(action)) return true
        val m = resources.displayMetrics
        val x = m.widthPixels / 2f
        val top = m.heightPixels * 0.3f
        val bottom = m.heightPixels * 0.75f
        return if (down) gestureIn(pkg, x, bottom, x, top, 350) else gestureIn(pkg, x, top, x, bottom, 350)
    }

    /** Смахнуть пальцем в сторону dir (left, right, up, down) по середине экрана. */
    fun swipe(dir: String, pkg: String? = null): Boolean {
        if (!inApp(pkg)) return false
        val m = resources.displayMetrics
        val w = m.widthPixels.toFloat()
        val h = m.heightPixels.toFloat()
        val cx = w * 0.5f
        val cy = h * 0.5f
        return when (dir) {
            "left" -> gestureIn(pkg, w * 0.85f, cy, w * 0.15f, cy, 300)
            "right" -> gestureIn(pkg, w * 0.15f, cy, w * 0.85f, cy, 300)
            "up" -> gestureIn(pkg, cx, h * 0.75f, cx, h * 0.3f, 300)
            else -> gestureIn(pkg, cx, h * 0.3f, cx, h * 0.75f, 300)
        }
    }

    /** Поле ввода по подписи: подсказка, описание, связанная подпись (labeledBy) или текст. Точное совпадение важнее. */
    private fun findEditable(field: String, pkg: String?): AccessibilityNodeInfo? {
        val q = norm(field)
        if (q.isEmpty()) return null
        val labelled = nodes()
            .filter { it.isEditable && it.isVisibleToUser && nodeIn(it, pkg) }
            .map { n ->
                val names = listOfNotNull(
                    n.hintText?.toString(),
                    n.contentDescription?.toString(),
                    n.labeledBy?.let { label(it) },
                    n.text?.toString(),
                ).map { norm(it) }.filter { it.isNotEmpty() }
                n to names
            }
        return labelled.firstOrNull { (_, names) -> names.any { it == q } }?.first
            ?: labelled.firstOrNull { (_, names) -> names.any { it.contains(q) } }?.first
    }

    /** Поле в фокусе или первое видимое поле ввода в pkg. */
    private fun focusedEditable(pkg: String?): AccessibilityNodeInfo? =
        rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable && nodeIn(it, pkg) }
            ?: nodes().firstOrNull { it.isEditable && it.isVisibleToUser && nodeIn(it, pkg) }

    private fun setText(target: AccessibilityNodeInfo, text: String, pkg: String?): Boolean {
        target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        if (!inApp(pkg) || !nodeIn(target, pkg)) return false
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun type(text: String, field: String?, pkg: String? = null): Boolean {
        if (!inApp(pkg)) return false
        val f = field?.takeIf { it.isNotBlank() }
        val target = if (f != null) {
            // Поле названо в подтверждении: печатаем только в него, никакого «первого попавшегося».
            findEditable(f, pkg) ?: return false
        } else {
            focusedEditable(pkg) ?: return false
        }
        return setText(target, text, pkg)
    }

    /** Стереть текст в поле (те же правила выбора поля, что у type). */
    fun clear(field: String?, pkg: String? = null): Boolean {
        if (!inApp(pkg)) return false
        val f = field?.takeIf { it.isNotBlank() }
        val target = if (f != null) {
            findEditable(f, pkg) ?: return false
        } else {
            focusedEditable(pkg) ?: return false
        }
        return setText(target, "", pkg)
    }

    /** «Ввод» в поле в фокусе (Android 11+). Без поля в фокусе ничего не делаем. */
    fun enter(pkg: String? = null): Boolean {
        if (Build.VERSION.SDK_INT < 30 || !inApp(pkg)) return false
        val f = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable && nodeIn(it, pkg) } ?: return false
        if (!f.refresh() || !inApp(pkg)) return false
        return f.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    fun global(action: Int): Boolean = performGlobalAction(action)
}
