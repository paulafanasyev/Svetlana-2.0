package ru.svetlana.hands

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Мелочи интерфейса без библиотек: отступы под системные панели и клавиатуру, кнопки в цветах Светланы. */
object Ui {
    const val BLUE = 0xFF5A5BE8.toInt()
    const val INK = 0xFF1D1B3A.toInt()
    const val SOFT = 0xFF6B6A8A.toInt()
    const val BG = 0xFFF3F3FE.toInt()
    fun dp(a: Activity, v: Int) = (v * a.resources.displayMetrics.density).toInt()

    /** Android 15 рисует под статус-баром: отодвигаем содержимое от панелей и клавиатуры. */
    fun insets(root: View) {
        root.setOnApplyWindowInsetsListener { v, ins ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = ins.getInsets(WindowInsets.Type.systemBars()); val ime = ins.getInsets(WindowInsets.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            } else {
                @Suppress("DEPRECATION") v.setPadding(ins.systemWindowInsetLeft, ins.systemWindowInsetTop, ins.systemWindowInsetRight, ins.systemWindowInsetBottom)
            }
            ins
        }
        root.requestApplyInsets()
    }

    fun button(a: Activity, text: String, primary: Boolean = false, onClick: () -> Unit) = Button(a).apply {
        this.text = text; isAllCaps = false; textSize = 14f; setTextColor(if (primary) Color.WHITE else INK)
        background = GradientDrawable().apply { cornerRadius = dp(a, 12).toFloat(); if (primary) setColor(BLUE) else { setColor(Color.WHITE); setStroke(dp(a, 1), 0xFFE4E1F4.toInt()) } }
        setPadding(dp(a, 14), dp(a, 6), dp(a, 14), dp(a, 6)); minHeight = dp(a, 40); minimumHeight = dp(a, 40)
        setOnClickListener { onClick() }
    }
    fun chip(a: Activity, text: String, onClick: () -> Unit) = TextView(a).apply {
        this.text = text; textSize = 13f; setTextColor(BLUE); gravity = Gravity.CENTER
        setPadding(dp(a, 10), dp(a, 4), dp(a, 10), dp(a, 4)); setOnClickListener { onClick() }
        background = GradientDrawable().apply { cornerRadius = dp(a, 14).toFloat(); setColor(BG) }
    }
    fun title(a: Activity, text: String) = TextView(a).apply { this.text = text; textSize = 22f; setTextColor(INK); setPadding(0, dp(a, 8), 0, dp(a, 6)) }
    fun text(a: Activity, text: String, size: Float = 14f, color: Int = INK) = TextView(a).apply { this.text = text; textSize = size; setTextColor(color); setPadding(0, dp(a, 4), 0, dp(a, 4)) }
    fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT) = LinearLayout.LayoutParams(w, h)
}
