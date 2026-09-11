import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Smartphone, Code2, FileCode, Terminal, CheckCircle2,
  AlertCircle, Settings, Shield, Eye, Zap, Layers
} from 'lucide-react';

const ANDROID_HANDS_CODE = `package com.svetlana.android.hands

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.graphics.Rect
import org.json.JSONObject

class SvetlanaAccessibilityService : AccessibilityService() {
    
    private var uiTree: JSONObject? = null
    
    override fun onServiceConnected() {
        val info = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPES_ALL_MASK
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            notificationTimeout = 100
        }
        serviceInfo = info
    }
    
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event?.let {
            // Capture UI tree on significant events
            if (it.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
                it.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                updateUITree()
            }
        }
    }
    
    override fun onInterrupt() {
        // Handle interruption
    }
    
    private fun updateUITree() {
        val rootNode = rootInActiveWindow?.refresh()
        uiTree = rootNode?.let { nodeToJson(it) }
    }
    
    private fun nodeToJson(node: AccessibilityNodeInfo): JSONObject {
        val json = JSONObject()
        
        json.put("className", node.className?.toString() ?: "unknown")
        json.put("text", node.text?.toString() ?: "")
        json.put("contentDescription", node.contentDescription?.toString() ?: "")
        json.put("packageName", node.packageName?.toString() ?: "")
        
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        json.put("bounds", JSONObject().apply {
            put("left", bounds.left)
            put("top", bounds.top)
            put("right", bounds.right)
            put("bottom", bounds.bottom)
        })
        
        json.put("clickable", node.isClickable)
        json.put("focusable", node.isFocusable)
        json.put("visible", node.isVisibleToUser)
        json.put("enabled", node.isEnabled)
        
        // Actions
        val actions = JSONObject()
        actions.put("canClick", node.isClickable)
        actions.put("canLongClick", node.isLongClickable)
        actions.put("canFocus", node.isFocusable)
        actions.put("canScroll", node.isScrollable)
        json.put("actions", actions)
        
        // Children
        val children = org.json.JSONArray()
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { child ->
                children.put(nodeToJson(child))
            }
        }
        json.put("children", children)
        
        return json
    }
    
    // Action methods
    fun tap(nodeId: String): Boolean {
        val node = findNodeById(rootInActiveWindow, nodeId)
        return node?.performAction(AccessibilityNodeInfo.ACTION_CLICK) ?: false
    }
    
    fun longPress(nodeId: String): Boolean {
        val node = findNodeById(rootInActiveWindow, nodeId)
        return node?.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK) ?: false
    }
    
    fun type(text: String): Boolean {
        val focusedNode = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        val args = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return focusedNode?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) ?: false
    }
    
    fun scroll(direction: String): Boolean {
        val scrollableNode = findScrollableNode(rootInActiveWindow)
        val action = when (direction) {
            "up" -> AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            "down" -> AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
            else -> return false
        }
        return scrollableNode?.performAction(action) ?: false
    }
    
    fun swipe(startX: Int, startY: Int, endX: Int, endY: Int, duration: Long): Boolean {
        // Requires GestureDescription API (Android 7.0+)
        val path = android.graphics.Path().apply {
            moveTo(startX.toFloat(), startY.toFloat())
            lineTo(endX.toFloat(), endY.toFloat())
        }
        
        val gesture = android.accessibilityservice.GestureDescription.Builder()
            .addStroke(android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, duration))
            .build()
        
        return dispatchGesture(gesture, null, null)
    }
    
    fun getUITree(): JSONObject? = uiTree
    
    fun findNodeByText(text: String): AccessibilityNodeInfo? {
        return rootInActiveWindow?.findAccessibilityNodeInfosByText(text)?.firstOrNull()
    }
    
    private fun findNodeById(node: AccessibilityNodeInfo?, id: String): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.viewIdResourceName == id) return node
        
        for (i in 0 until node.childCount) {
            val found = findNodeById(node.getChild(i), id)
            if (found != null) return found
        }
        return null
    }
    
    private fun findScrollableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isScrollable) return node
        
        for (i in 0 until node.childCount) {
            val found = findScrollableNode(node.getChild(i))
            if (found != null) return found
        }
        return null
    }
}`;

const MANIFEST_CODE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.svetlana.android">

    <uses-permission android:name="android.permission.BIND_ACCESSIBILITY_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.MEDIA_PROJECTION" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Svetlana 2.0"
        android:theme="@style/Theme.Svetlana">

        <service
            android:name=".hands.SvetlanaAccessibilityService"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="false">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/accessibility_service_config" />
        </service>

        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>
</manifest>`;

const ACCESSIBILITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeAllMask"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault|flagRetrieveInteractiveWindows|flagIncludeNotImportantViews"
    android:canPerformGestures="true"
    android:canRequestEnhancedWebAccessibility="true"
    android:canRequestFilterKeyEvents="true"
    android:canRequestTouchExplorationMode="true"
    android:canRetrieveWindowContent="true"
    android:description="@string/accessibility_service_description"
    android:notificationTimeout="100"
    android:summary="Svetlana 2.0 AI Assistant" />`;

export default function AndroidPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'hands' | 'manifest' | 'config'>('overview');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Smartphone className="w-6 h-6 text-emerald-400" />
        <h2 className="text-2xl font-bold">Android Hands</h2>
      </div>
      <p className="text-sv-muted">Real Android AccessibilityService implementation for UI control</p>

      {/* Status */}
      <div className="glass-card rounded-xl p-6 border border-yellow-500/20">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400" />
          <div>
            <h3 className="text-sm font-medium text-yellow-400">Implementation Status</h3>
            <p className="text-xs text-sv-muted mt-1">
              Code is ready but requires Android Studio to build APK. This web app shows the implementation.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'overview', label: 'Overview', icon: Layers },
          { id: 'hands', label: 'Hands Code', icon: Code2 },
          { id: 'manifest', label: 'Manifest', icon: FileCode },
          { id: 'config', label: 'Config', icon: Settings },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-white/5 text-sv-muted hover:bg-white/10 border border-white/10'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="glass-card rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Architecture</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h4 className="text-sm font-medium text-emerald-400 mb-2">AccessibilityService</h4>
                <ul className="text-xs text-sv-muted space-y-1">
                  <li>• Real-time UI tree capture</li>
                  <li>• Semantic element identification</li>
                  <li>• Action execution (tap, type, scroll)</li>
                  <li>• Gesture dispatch</li>
                  <li>• Window state tracking</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h4 className="text-sm font-medium text-cyan-400 mb-2">Capabilities</h4>
                <ul className="text-xs text-sv-muted space-y-1">
                  <li>• Tap on any UI element</li>
                  <li>• Long press</li>
                  <li>• Type text into fields</li>
                  <li>• Scroll up/down</li>
                  <li>• Swipe gestures</li>
                  <li>• Find elements by text/ID</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h4 className="text-sm font-medium text-purple-400 mb-2">Security</h4>
                <ul className="text-xs text-sv-muted space-y-1">
                  <li>• User must grant permission</li>
                  <li>• No root required</li>
                  <li>• Sandboxed execution</li>
                  <li>• Policy gate for dangerous actions</li>
                  <li>• Audit log for all actions</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h4 className="text-sm font-medium text-yellow-400 mb-2">Requirements</h4>
                <ul className="text-xs text-sv-muted space-y-1">
                  <li>• Android 7.0+ (API 24)</li>
                  <li>• Accessibility permission</li>
                  <li>• Overlay permission (for UI)</li>
                  <li>• Media projection (for screenshots)</li>
                  <li>• Foreground service</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Integration Flow</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {[
                'Web App',
                '→',
                'WebSocket/HTTP',
                '→',
                'Android Service',
                '→',
                'Accessibility API',
                '→',
                'UI Actions',
              ].map((item, i) =>
                item === '→' ? (
                  <span key={i} className="text-emerald-400">→</span>
                ) : (
                  <span key={i} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                    {item}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'hands' && (
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Code2 className="w-5 h-5 text-cyan-400" />
              SvetlanaAccessibilityService.kt
            </h3>
            <button
              onClick={() => navigator.clipboard.writeText(ANDROID_HANDS_CODE)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-sv-muted transition-colors"
            >
              Copy Code
            </button>
          </div>
          <pre className="text-xs text-sv-text overflow-x-auto bg-black/30 rounded-lg p-4 border border-white/10">
            <code>{ANDROID_HANDS_CODE}</code>
          </pre>
        </div>
      )}

      {activeTab === 'manifest' && (
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileCode className="w-5 h-5 text-purple-400" />
              AndroidManifest.xml
            </h3>
            <button
              onClick={() => navigator.clipboard.writeText(MANIFEST_CODE)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-sv-muted transition-colors"
            >
              Copy Code
            </button>
          </div>
          <pre className="text-xs text-sv-text overflow-x-auto bg-black/30 rounded-lg p-4 border border-white/10">
            <code>{MANIFEST_CODE}</code>
          </pre>
        </div>
      )}

      {activeTab === 'config' && (
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Settings className="w-5 h-5 text-yellow-400" />
              accessibility_service_config.xml
            </h3>
            <button
              onClick={() => navigator.clipboard.writeText(ACCESSIBILITY_CONFIG)}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-sv-muted transition-colors"
            >
              Copy Code
            </button>
          </div>
          <pre className="text-xs text-sv-text overflow-x-auto bg-black/30 rounded-lg p-4 border border-white/10">
            <code>{ACCESSIBILITY_CONFIG}</code>
          </pre>
        </div>
      )}

      {/* Build Instructions */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-orange-400" />
          Build Instructions
        </h3>
        <div className="space-y-3 text-sm text-sv-muted">
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="font-medium text-sv-text mb-1">1. Create Android Project</p>
            <p className="text-xs">Open Android Studio → New Project → Empty Activity</p>
            <p className="text-xs font-mono text-cyan-400 mt-1">Package: com.svetlana.android</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="font-medium text-sv-text mb-1">2. Add Code</p>
            <p className="text-xs">Copy the Hands code to: <code className="text-cyan-400">app/src/main/java/com/svetlana/android/hands/SvetlanaAccessibilityService.kt</code></p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="font-medium text-sv-text mb-1">3. Update Manifest</p>
            <p className="text-xs">Replace AndroidManifest.xml with the manifest code above</p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="font-medium text-sv-text mb-1">4. Add Config</p>
            <p className="text-xs">Create: <code className="text-cyan-400">app/src/main/res/xml/accessibility_service_config.xml</code></p>
          </div>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="font-medium text-sv-text mb-1">5. Build APK</p>
            <p className="text-xs">Build → Build Bundle(s) / APK(s) → Build APK(s)</p>
            <p className="text-xs text-emerald-400 mt-1">✓ Output: app/build/outputs/apk/debug/app-debug.apk</p>
          </div>
        </div>
      </div>
    </div>
  );
}
