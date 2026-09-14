package com.svetlana.android.hands

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val status = TextView(this).apply {
            text = "PLAN0_STATUS=WAITING"
            textSize = 20f
            gravity = Gravity.CENTER
            contentDescription = "PLAN0_STATUS"
        }

        val target = Button(this).apply {
            text = "PLAN0_TARGET"
            contentDescription = "PLAN0_TARGET"
            setOnClickListener {
                status.text = "PLAN0_STATUS=ACTION_PERFORMED"
                android.util.Log.i("SvetlanaPlan0", "PLAN0_UI_STATE_CHANGED=PASS")
            }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 32, 32, 32)
        }
        layout.addView(status, LinearLayout.LayoutParams(-1, 0, 1f))
        layout.addView(target, LinearLayout.LayoutParams(-1, -2))
        setContentView(layout)
    }
}
