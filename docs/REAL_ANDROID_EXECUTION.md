# Real Android Execution — Plan 0

Svetlana-2.0 is local-only: the phone is controlled only by the verified/authorized user through the local Svetlana runtime.

Canonical chain:

`Verified User → Svetlana → Orchestrator → Planner → Policy → Tool Registry → Hands → Android AccessibilityService → Verification`

Remote HTTP/WebSocket/MCP control is not part of the architecture and must not be reintroduced.

## Runtime proof

**VERIFIED:** active Android connection UI no longer exposes an endpoint or network transport; Hands refuses remote-style connection attempts.

**NOT PROVEN:** the native AccessibilityService bridge and real APK/device action chain.

Required evidence:

`CI/build → APK → real device/emulator → service registered → onServiceConnected → local Hands invocation → real UI/system change → independent verification`

A web page, HTTP response, localhost endpoint, or `success:true` value is never sufficient evidence of a real device action.

## Local administration

Svetlana may inspect and administer the local phone within actual Android permissions, including system/network observation, open-port visibility, firewall and VPN operations. Sensitive operations remain under Policy and verified-user authorization.

Training starts only after the runtime gate closes. Target: Google Colab / Google GPU.
