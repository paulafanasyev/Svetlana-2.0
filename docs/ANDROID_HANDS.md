# Android Hands — Local-only runtime contract

Canonical execution chain:

`Verified User → Svetlana → Orchestrator → Planner → Policy → Tool Registry → Hands → Android AccessibilityService → action → independent Verification → Svetlana`

## Security boundary

Svetlana-2.0 is a **phone-local system**. Device-control commands are accepted only from the verified/authorized user.

The Android execution plane must not expose a remote-control channel. The following are explicitly prohibited as device-control mechanisms:

- HTTP control servers/endpoints;
- WebSocket control channels;
- remote IP/port endpoints;
- MCP network servers for phone control;
- TermuxMCP;
- browser/network clients controlling the phone.

`Hands` is an execution abstraction. The privileged Android backend is the local `AccessibilityService`, with native Android IPC between components where needed.

## Allowed local administration

Within Android's real permissions and APIs, Svetlana may locally inspect system/network state and administer the phone, including open-port visibility, monitoring, firewall and VPN operations. Policy and authorization still apply to sensitive operations.

## Evidence gate

**VERIFIED:** remote HTTP/WebSocket transport code has been removed from the active Hands contract and Android connection UI; the Hands manager refuses network-style connection attempts.

**NOT PROVEN:** native AccessibilityService execution on a real APK/device. Static code is not runtime proof.

Runtime closure requires:

`code → CI/build → APK → real Android device/emulator → AccessibilityService bound → local Hands call → real Android action → independent observation → VERIFIED/FAIL`

No network response, browser state, or local web status may be used as proof of a device action.

## Training

Training remains downstream of Plan 0 runtime closure.

Target: **Google Colab / Google GPU**. Kaggle is not the training target.
