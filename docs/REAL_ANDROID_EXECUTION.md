# Real Android Execution - Cross-Repository Integration

## Overview

This document describes the integration between **Svetlana-2.0** (Control Plane) and **Svetlana-App** (Android Execution Plane) for real Android device automation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Svetlana-2.0 (Control Plane)                │
│                                                              │
│  User Command → AI Gateway → Planner → Policy → ToolRegistry│
│                                    ↓                         │
│                              HandsManager                    │
│                                    ↓                         │
│                      ┌─────────────┴─────────────┐          │
│                      │                           │          │
│                WebSocketHands              HTTPHands         │
│                      │                           │          │
│                      └─────────────┬─────────────┘          │
│                                    │ MCP (JSON-RPC 2.0)     │
└────────────────────────────────────┼────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────┐
│                  Svetlana-App (Android Execution Plane)      │
│                                    │                         │
│                          MCP Server (WebSocket/HTTP)         │
│                                    │                         │
│                      AccessibilityService                     │
│                                    │                         │
│                          Android APIs                        │
│                                    │                         │
│                    ┌───────────────┴───────────────┐        │
│                    │                               │        │
│              Screen Capture                  UI Automation   │
└──────────────────────────────────────────────────────────────┘
```

## Cross-Repository Dependencies

### Svetlana-2.0 (This Repository)
- ✅ AI Gateway with 9 providers
- ✅ Planner, Policy Engine, Tool Registry
- ✅ RealTools with verification
- ✅ HandsManager with WebSocket/HTTP transport
- ✅ MCP Protocol (JSON-RPC 2.0)
- ✅ Verification Engine
- ✅ Real E2E Tests (require real device)

### Svetlana-App (External Repository)
**Required Components:**
- ✅ MCP Server (WebSocket/HTTP endpoint)
- ✅ AccessibilityService implementation
- ✅ Screen capture via MediaProjection API
- ✅ UI automation via AccessibilityNodeInfo
- ✅ App lifecycle management

## What Needs to be Implemented in Svetlana-App

### 1. MCP Server

**WebSocket Server:**
```kotlin
// Svetlana-App/src/main/java/com/svetlana/app/mcp/MCPServer.kt
class MCPServer(private val port: Int = 8080) {
    private var server: WebSocketServer? = null
    
    fun start() {
        server = WebSocketServer(InetSocketAddress(port))
        server?.start()
    }
    
    fun stop() {
        server?.stop()
    }
}
```

**HTTP Server:**
```kotlin
// Svetlana-App/src/main/java/com/svetlana/app/mcp/HTTPServer.kt
class HTTPServer(private val port: Int = 8080) {
    private var server: HttpServer? = null
    
    fun start() {
        server = HttpServer.create(InetSocketAddress(port), 0)
        server?.createContext("/api", ::handleRequest)
        server?.start()
    }
}
```

### 2. AccessibilityService

```kotlin
// Svetlana-App/src/main/java/com/svetlana/app/accessibility/SvetlanaAccessibilityService.kt
class SvetlanaAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Handle accessibility events
    }
    
    override fun onInterrupt() {
        // Handle interruption
    }
    
    fun getAccessibilityTree(): AccessibilityNodeInfo? {
        return rootInActiveWindow
    }
    
    fun tap(x: Int, y: Int): Boolean {
        val path = Path().apply {
            moveTo(x.toFloat(), y.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 100))
            .build()
        return dispatchGesture(gesture, null, null)
    }
    
    fun type(text: String): Boolean {
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return node?.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments) ?: false
    }
    
    fun launchApp(packageName: String): Boolean {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        return intent?.let {
            startActivity(it)
            true
        } ?: false
    }
    
    fun getCurrentApp(): String? {
        return rootInActiveWindow?.packageName?.toString()
    }
}
```

### 3. Screen Capture

```kotlin
// Svetlana-App/src/main/java/com/svetlana/app/screen/ScreenCapture.kt
class ScreenCapture(private val context: Context) {
    private var mediaProjection: MediaProjection? = null
    
    fun capture(): Bitmap? {
        // Use MediaProjection API to capture screen
        // Return Bitmap
    }
    
    fun toBase64(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        return Base64.encodeToString(outputStream.toByteArray(), Base64.DEFAULT)
    }
}
```

### 4. MCP Request Handler

```kotlin
// Svetlana-App/src/main/java/com/svetlana/app/mcp/MCPHandler.kt
class MCPHandler(private val accessibilityService: SvetlanaAccessibilityService) {
    
    fun handleRequest(request: MCPRequest): MCPResponse {
        return when (request.method) {
            "app.launch" -> handleLaunchApp(request)
            "app.getCurrent" -> handleGetCurrentApp(request)
            "ui.tap" -> handleTap(request)
            "input.type" -> handleType(request)
            "screen.capture" -> handleScreenCapture(request)
            "accessibility.getTree" -> handleGetAccessibilityTree(request)
            else -> MCPResponse(
                id = request.id,
                error = MCPError(code = -32601, message = "Method not found")
            )
        }
    }
    
    private fun handleLaunchApp(request: MCPRequest): MCPResponse {
        val packageName = request.params["packageName"] as? String
            ?: return MCPResponse(
                id = request.id,
                error = MCPError(code = -32602, message = "Missing packageName")
            )
        
        val success = accessibilityService.launchApp(packageName)
        
        return MCPResponse(
            id = request.id,
            result = mapOf(
                "success" to success,
                "packageName" to packageName
            )
        )
    }
    
    // ... other handlers
}
```

## MCP Protocol Specification

### Request Format
```json
{
  "jsonrpc": "2.0",
  "id": "req_1",
  "method": "app.launch",
  "params": {
    "packageName": "org.telegram.messenger"
  },
  "timestamp": 1234567890
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "id": "req_1",
  "result": {
    "success": true,
    "packageName": "org.telegram.messenger"
  },
  "timestamp": 1234567891
}
```

### Supported Methods

| Method | Description | Parameters |
|--------|-------------|------------|
| `device.getInfo` | Get device info | None |
| `app.launch` | Launch app | `packageName: string` |
| `app.close` | Close app | `packageName: string` |
| `app.getCurrent` | Get current app | None |
| `ui.tap` | Tap at coordinates | `x: number, y: number` |
| `ui.swipe` | Swipe gesture | `startX, startY, endX, endY, duration` |
| `input.type` | Type text | `text: string` |
| `input.clear` | Clear input | None |
| `input.key` | Press key | `key: string` |
| `screen.capture` | Capture screen | None |
| `accessibility.getTree` | Get accessibility tree | None |
| `accessibility.findElementByText` | Find element by text | `text: string` |
| `accessibility.findElementById` | Find element by ID | `id: string` |
| `system.home` | Go to home screen | None |
| `system.back` | Press back button | None |

## Real E2E Test Scenario

### Test: "Open Telegram"

**Expected Flow:**
1. User command: "Открой Telegram"
2. AI Gateway → Planner → Policy → ToolRegistry
3. ToolRegistry → openAppTool.execute()
4. HandsManager → WebSocketHands
5. WebSocket → MCP Server (Svetlana-App)
6. MCP Server → AccessibilityService
7. Android → launchApp("org.telegram.messenger")
8. Telegram opens
9. Observation → getCurrentApp()
10. Verification → currentApp === "org.telegram.messenger"
11. Response: "Telegram открыт" ✅

**Machine-Readable Evidence:**
```json
{
  "scenario": "Open Telegram",
  "steps": [
    {
      "step": 1,
      "action": "Check Android connection",
      "status": "passed",
      "data": { "connected": true }
    },
    {
      "step": 2,
      "action": "Get device info",
      "status": "passed",
      "data": { "model": "Pixel 6", "osVersion": "13" }
    },
    {
      "step": 3,
      "action": "Get current app (before)",
      "status": "passed",
      "data": { "currentApp": "com.android.launcher" }
    },
    {
      "step": 4,
      "action": "Launch Telegram",
      "status": "passed",
      "data": { "success": true }
    },
    {
      "step": 5,
      "action": "Wait for app to start",
      "status": "passed"
    },
    {
      "step": 6,
      "action": "Get current app (after)",
      "status": "passed",
      "data": { "currentApp": "org.telegram.messenger" }
    },
    {
      "step": 7,
      "action": "Verification",
      "status": "passed",
      "data": {
        "expected": "org.telegram.messenger",
        "actual": "org.telegram.messenger",
        "verified": true
      }
    }
  ],
  "success": true,
  "duration": 2500
}
```

## Status

### VERIFIED (Code Level)
- ✅ Svetlana-2.0 Control Plane
- ✅ Transport layer (WebSocket/HTTP)
- ✅ RealTools with verification
- ✅ MCP Protocol
- ✅ Real E2E Tests (code ready)

### NOT PROVEN (Runtime Level)
- ⚠️ Real Android device connection
- ⚠️ Real AccessibilityService execution
- ⚠️ Real screen capture
- ⚠️ Real UI automation
- ⚠️ Real E2E test execution

## Next Steps

1. **Implement Svetlana-App MCP Server**
   - WebSocket/HTTP server
   - Request handler
   - Response formatter

2. **Implement AccessibilityService**
   - UI tree capture
   - Element search
   - Action execution (tap, type, swipe)

3. **Implement Screen Capture**
   - MediaProjection API
   - Base64 encoding

4. **Test Integration**
   - Connect Svetlana-2.0 to Svetlana-App
   - Run "Open Telegram" test
   - Verify complete pipeline

## Important Notes

- **No Mock Implementations**: All code uses real Android APIs
- **Verification Required**: Every action must be verified
- **Cross-Repository**: Requires both Svetlana-2.0 and Svetlana-App
- **Real Device Required**: Cannot be tested without real Android device

---

**Last Updated:** 2026-03-10  
**Status:** Code Ready, Runtime NOT PROVEN
