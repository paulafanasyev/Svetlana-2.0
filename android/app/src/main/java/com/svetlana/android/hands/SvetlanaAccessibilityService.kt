package com.svetlana.android.hands

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class SvetlanaAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "PLAN0_SERVICE_CONNECTED=PASS")
        attemptTargetAction()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName == packageName) {
            attemptTargetAction()
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "PLAN0_SERVICE_INTERRUPTED=1")
    }

    private fun attemptTargetAction() {
        val root = rootInActiveWindow ?: return
        val nodes = root.findAccessibilityNodeInfosByText("PLAN0_TARGET")
        val target = nodes.firstOrNull { it.isVisibleToUser && it.isEnabled }
        if (target == null) return

        Log.i(TAG, "PLAN0_NODE_FOUND=PASS")
        val clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        Log.i(TAG, "PLAN0_ACTION_CLICK=${if (clicked) "PASS" else "FAIL"}")
        if (clicked) {
            Log.i(TAG, "PLAN0_REAL_ANDROID_ACTION=PASS")
        }
    }

    companion object {
        private const val TAG = "SvetlanaPlan0"
    }
}
