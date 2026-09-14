# Android Hands — Plan 0 Runtime Contract

Canonical chain:

`Svetlana → Orchestrator → Planner → Policy → Tool Registry → Hands → Android → Verification → Svetlana`

Current HTTP client: `src/services/HTTPHands.ts`.

Android loopback endpoint: `http://127.0.0.1:8765`.

HTTP contract:
- `GET /health`
- `POST /api/<method>` with `{ "params": {}, "timestamp": <number> }`

Current method paths:
- `device/info`
- `app/launch`
- `app/close`
- `app/current`
- `ui/tap`
- `ui/longPress`
- `ui/swipe`
- `input/type`
- `input/clear`
- `input/key`
- `screen/capture`
- `accessibility/tree`
- `accessibility/findByText`
- `accessibility/findById`
- `system/home`
- `system/back`
- `system/recents`

## Evidence

**VERIFIED:** PlatformHands contract, real HTTP client, HandsManager/real tools, verification code, and Plan 0 static CI gates.

**NOT PROVEN:** real Android reachability, AccessibilityService binding, real action execution, real screen capture, independent device-state verification, and complete end-to-end execution.

**PENDING:**

`code → CI/build → APK → real Android emulator/device → real HTTP tool call → real Android action → independent observation → verification`

An HTTP 200 or `success: true` response is not sufficient proof of a real device action.

For every critical action, retain health evidence, service-binding evidence, exact method/parameters, Android execution result, BEFORE state, AFTER state, comparison result, and final VERIFIED/FAIL classification.

## Training gate

Training is downstream of Plan 0 runtime closure.

Target: **Google Colab / Google GPU**.

Kaggle is not the training target.

## Status

- Plan 0 static layer: **VERIFIED**
- Plan 0 real Android execution: **NOT PROVEN**
- Plan 0 overall: **NOT CLOSED**
