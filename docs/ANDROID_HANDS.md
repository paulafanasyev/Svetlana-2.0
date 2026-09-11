# Android Hands — Architecture & Integration Guide

## Overview

Svetlana 2.0 implements a **brain/control plane** architecture where:
- **Svetlana-2.0** (this repo) = AI brain, planning, policy, verification
- **Svetlana-App** (separate Android repo) = execution plane, AccessibilityService, device control

Communication happens via **MCP (Model Context Protocol)** over WebSocket or HTTP.

```
┌─────────────────────────────────────────────────────────────┐
│                    SVETLANA-2.0 (Web)                        │
│                                                              │
│  UI → AI Gateway → Planner → Policy → ToolRegistry          │
│                                    ↓                         │
│                          HandsManager                       │
│                                    ↓                         │
│                    ┌───────────────┴───────────────┐        │
│                    │                               │        │
│              WebSocketHands                  HTTPHands       │
│                    │                               │        │
└────────────────────┼───────────────────────────────┼────────┘
                     │                               │
                     └───────────┬───────────────────┘
                                 │ MCP (JSON-RPC 2.0)
                                 │
┌────────────────────────────────┼────────────────────────────┐
│                    SVETLANA-APP (Android)                     │
│                                 │                             │
│                          MCP Server                          │
│                                 │                             │
│                    AccessibilityService                       │
│                                 │                             │
│                          Android APIs                         │
│                                 │                             │
│                    ┌────────────┴────────────┐               │
│                    │                         │               │
│              Screen Capture           UI Automation          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

### Control Plane (Svetlana-2.0)

**Components:**
- `AIGateway.ts` — LLM provider abstraction (OpenAI, Anthropic, etc.)
- `Planner.ts` — Task decomposition
- `PolicyEngine.ts` — Risk assessment, confirmation requirements
- `ToolRegistry.ts` — Tool contract and execution
- `RealTools.ts` — Real tool implementations using PlatformHands
- `HandsManager.ts` — Connection management
- `WebSocketHands.ts` — WebSocket transport (JSON-RPC)
- `HTTPHands.ts` — HTTP transport (REST)
- `PlatformHands.ts` — Interface contract
- `MCPProtocol.ts` — Protocol definition
- `Verification.ts` — Post-action verification
- `ObservationLayer.ts` — Screen state observation

### Execution Plane (Svetlana-App)

**Components:**
- MCP Server (WebSocket/HTTP endpoint)
- AccessibilityService (UI tree, actions)
- Screen capture (MediaProjection API)
- Input injection (AccessibilityNodeInfo actions)
- App lifecycle management

## Transport Protocol

### MCP (Model Context Protocol)

**Protocol:** JSON-RPC 2.0  
**Transport:** WebSocket (recommended) or HTTP  
**Authentication:** None (local network only)

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": "mcp_1234567890_abc123",
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
  "id": "mcp_1234567890_abc123",
  "result": {
    "success": true,
    "data": {
      "app": "org.telegram.messenger"
    },
    "observation": {
      "currentApp": "org.telegram.messenger",
      "timestamp": 1234567891
    },
    "verification": {
      "status": "PASS",
      "confidence": 1.0
    }
  },
  "timestamp": 1234567891
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "id": "mcp_1234567890_abc123",
  "error": {
    "code": -32000,
    "message": "Device not connected",
    "data": {}
  },
  "timestamp": 1234567891
}
```

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | PARSE_ERROR | Invalid JSON |
| -32600 | INVALID_REQUEST | Invalid request format |
| -32601 | METHOD_NOT_FOUND | Unknown method |
| -32602 | INVALID_PARAMS | Invalid parameters |
| -32603 | INTERNAL_ERROR | Internal error |
| -32000 | DEVICE_NOT_CONNECTED | Android device not connected |
| -32001 | ELEMENT_NOT_FOUND | UI element not found |
| -32002 | ACTION_FAILED | Action execution failed |
| -32003 | TIMEOUT | Request timeout |
| -32004 | PERMISSION_DENIED | Permission denied |
| -32005 | VERIFICATION_FAILED | Verification failed |

## Supported Methods

### Device

#### `device.getInfo`
Get device information.

**Params:** `{}`  
**Result:**
```json
{
  "platform": "android",
  "model": "Pixel 6",
  "osVersion": "13",
  "screenWidth": 1080,
  "screenHeight": 2400,
  "density": 2.625
}
```

### App Control

#### `app.launch`
Launch an Android application.

**Params:**
```json
{
  "packageName": "org.telegram.messenger"
}
```

**Result:**
```json
{
  "success": true,
  "data": {
    "app": "org.telegram.messenger"
  },
  "observation": {
    "currentApp": "org.telegram.messenger"
  }
}
```

#### `app.close`
Close an application.

**Params:**
```json
{
  "packageName": "org.telegram.messenger"
}
```

#### `app.getCurrent`
Get currently active app.

**Params:** `{}`  
**Result:**
```json
{
  "packageName": "org.telegram.messenger"
}
```

### UI Interaction

#### `ui.tap`
Tap at coordinates.

**Params:**
```json
{
  "x": 540,
  "y": 1200
}
```

#### `ui.longPress`
Long press at coordinates.

**Params:**
```json
{
  "x": 540,
  "y": 1200,
  "duration": 1000
}
```

#### `ui.swipe`
Swipe gesture.

**Params:**
```json
{
  "startX": 540,
  "startY": 1800,
  "endX": 540,
  "endY": 600,
  "duration": 300
}
```

### Input

#### `input.type`
Type text into focused input.

**Params:**
```json
{
  "text": "Hello, world!"
}
```

#### `input.clear`
Clear focused input.

**Params:** `{}`

#### `input.key`
Press a key.

**Params:**
```json
{
  "key": "KEYCODE_ENTER"
}
```

### Screen

#### `screen.capture`
Capture screen screenshot.

**Params:** `{}`  
**Result:**
```json
{
  "image": "iVBORw0KGgoAAAANSUhEUgAA...",
  "width": 1080,
  "height": 2400,
  "timestamp": 1234567890
}
```

### Accessibility

#### `accessibility.getTree`
Get accessibility tree.

**Params:** `{}`  
**Result:**
```json
{
  "root": {
    "id": "root",
    "type": "FrameLayout",
    "bounds": { "x": 0, "y": 0, "width": 1080, "height": 2400 },
    "children": [...]
  },
  "timestamp": 1234567890
}
```

#### `accessibility.findElementByText`
Find element by text.

**Params:**
```json
{
  "text": "Settings"
}
```

**Result:**
```json
{
  "id": "element_123",
  "type": "TextView",
  "text": "Settings",
  "bounds": { "x": 100, "y": 200, "width": 880, "height": 150 },
  "clickable": true
}
```

#### `accessibility.findElementById`
Find element by resource ID.

**Params:**
```json
{
  "id": "com.android.settings:id/title"
}
```

### System

#### `system.home`
Press home button.

**Params:** `{}`

#### `system.back`
Press back button.

**Params:** `{}`

#### `system.recents`
Open recents.

**Params:** `{}`

## Tool Registry

### Available Tools

| Tool | Risk | Description |
|------|------|-------------|
| `open_app` | Low | Launch application |
| `tap_element` | Low | Tap UI element |
| `type_text` | Medium | Type text |
| `capture_screen` | Medium | Take screenshot |
| `send_message` | High | Send message (requires confirmation) |

### Tool Execution Flow

```
1. User command
   ↓
2. AI Gateway → LLM
   ↓
3. Planner → structured tool call
   ↓
4. Policy Engine → risk check
   ↓
5. Tool Registry → execute tool
   ↓
6. HandsManager → transport
   ↓
7. MCP → Svetlana-App
   ↓
8. AccessibilityService → Android
   ↓
9. Observation → new state
   ↓
10. Verification → PASS/FAIL
   ↓
11. Response to user
```

### Verification Model

Every action follows the strict BEFORE → ACTION → AFTER → COMPARE pattern:

```
BEFORE
  ↓
ACTION
  ↓
AFTER
  ↓
COMPARE
  ↓
EXPECTED STATE?
  ├─ YES → PASS
  └─ NO  → RETRY (max 3) → FAIL
```

#### Tool-Specific Verification

**type_text:**
```
BEFORE: Capture accessibility tree
ACTION: Type text into focused input
AFTER: Wait 500ms, capture accessibility tree
COMPARE:
  - Find focused input field (EditText/TextField)
  - Check if actual text contains expected text
PASS: Text found in focused field
FAIL: Text not found or no focused input
```

**tap_element:**
```
BEFORE: Capture beforeTree and beforeApp
ACTION: Find element, tap on it
AFTER: Wait 500ms, capture currentTree and currentApp
COMPARE:
  - Check if element count changed (beforeTree vs currentTree)
  - OR check if app changed (beforeApp vs currentApp)
PASS: UI changed or navigation occurred
FAIL: No change detected
```

**send_message:**
```
BEFORE: Launch app, find contact, type message, tap send
ACTION: Complete message sending flow
AFTER: Wait 1000ms, capture accessibility tree
COMPARE:
  - Search for message text in accessibility tree
  - Verify message actually appeared in chat
PASS: Message text found in chat
FAIL: Message not found
```

**open_app:**
```
BEFORE: (none needed)
ACTION: Launch app via package name
AFTER: Wait 1000ms, get current app
COMPARE:
  - Check if current app matches expected package
PASS: Correct app is active
FAIL: Wrong app or app not launched
```

#### Verification Principles

1. **No Blind Trust**: Never trust `success: true` without evidence
2. **Real Observation**: Always check actual device state
3. **State Comparison**: Compare before/after states
4. **Timeout Handling**: Wait appropriate time for UI updates
5. **Evidence-Based**: Require proof of success

Example:
```
Command: "Open Telegram"

BEFORE:
  currentApp = "com.android.launcher"

ACTION:
  launchApp("org.telegram.messenger")

AFTER:
  currentApp = "org.telegram.messenger"

VERIFY:
  currentApp === "org.telegram.messenger" → PASS
```

## Security

### Risk Levels

| Level | Actions | Confirmation |
|-------|---------|--------------|
| Low | screenshot, observe | Auto |
| Medium | launch app, tap, type | Auto |
| High | send message | Required |
| Critical | payment, delete | Required |

### API Keys

**Current:** Stored in localStorage (dev only)  
**Production:** Must use backend proxy

```
Browser → Backend Proxy → AI Provider
              ↓
         Secure Storage
```

### MCP Security

**Current:** No authentication (local network)  
**Production:** Add:
- TLS encryption
- Token authentication
- IP whitelisting
- Rate limiting

## Installation

### Svetlana-2.0 (Web)

```bash
git clone https://github.com/paulafanasyev/Svetlana-2.0
cd Svetlana-2.0
npm install
npm run dev
```

### Svetlana-App (Android)

```bash
git clone https://github.com/paulafanasyev/Svetlana-App
# Open in Android Studio
# Build and install on device
```

## Connection Setup

### 1. Start Svetlana-App on Android
- Open app
- Grant Accessibility permission
- Grant Overlay permission
- Start MCP Server (default: ws://0.0.0.0:8080)

### 2. Connect from Svetlana-2.0
- Open "Android Connection" page
- Select transport: WebSocket
- Enter endpoint: `ws://YOUR_ANDROID_IP:8080`
- Click "Connect"

### 3. Verify Connection
- Status should show "Connected"
- Device info should appear
- Tools should become available

## Troubleshooting

### Connection Failed

**Problem:** Cannot connect to Android  
**Solutions:**
- Check both devices on same network
- Verify Android IP address
- Check firewall settings
- Ensure MCP server is running

### Tools Unavailable

**Problem:** Tools show as unavailable  
**Solutions:**
- Verify connection status
- Check Android permissions
- Restart MCP server
- Reconnect from web

### Verification Failed

**Problem:** Action executed but verification failed  
**Solutions:**
- Check if app actually launched
- Verify UI element exists
- Increase timeout
- Check accessibility tree

### Timeout

**Problem:** Request timeout  
**Solutions:**
- Increase timeout in config
- Check network latency
- Verify Android not busy
- Restart connection

## VERIFIED

✅ Code implemented:
- PlatformHands contract
- WebSocketHands transport
- HTTPHands transport
- HandsManager
- RealTools (open_app, tap_element, type_text, capture_screen, send_message)
- MCPProtocol
- ToolRegistry (no stubs)
- AI Gateway (9 providers)
- Policy Engine
- Verification Engine
- CI configuration
- Unit tests

✅ Build: PASS  
✅ Typecheck: PASS  
✅ Tests: PASS

## NOT PROVEN

⚠️ Not tested on real Android:
- Actual device connection
- Real AccessibilityService integration
- Real screen capture
- Real UI automation
- End-to-end flow on device

⚠️ Not implemented:
- Android MCP Server (in Svetlana-App)
- Native Android voice
- Production security (backend proxy)
- Streaming AI responses

## Next Steps

1. **Implement Svetlana-App MCP Server**
   - WebSocket endpoint
   - AccessibilityService integration
   - Screen capture
   - UI automation

2. **Test on Real Device**
   - Connect Svetlana-2.0 to Android
   - Execute: "Open Telegram"
   - Verify complete flow

3. **Add More Tools**
   - swipe
   - pressKey
   - findContact
   - scrollTo

4. **Production Security**
   - Backend proxy for API keys
   - MCP authentication
   - TLS encryption

## First Real Device Test

**Command:** "Светлана, открой Telegram"

**Expected Flow:**
```
1. User: "Открой Telegram"
   ↓
2. AI Gateway → LLM
   ↓
3. Planner → { tool: "open_app", arguments: { packageName: "org.telegram.messenger" } }
   ↓
4. Policy → risk: low → auto-approve
   ↓
5. ToolRegistry → openAppTool.execute()
   ↓
6. HandsManager → WebSocketHands
   ↓
7. MCP → { method: "app.launch", params: { packageName: "org.telegram.messenger" } }
   ↓
8. Svetlana-App → AccessibilityService → launchApp()
   ↓
9. Android → Telegram opens
   ↓
10. Observation → currentApp = "org.telegram.messenger"
   ↓
11. Verification → PASS
   ↓
12. Светлана: "Telegram открыт" ✅
```

**Status:** NOT PROVEN (requires real Android device)
