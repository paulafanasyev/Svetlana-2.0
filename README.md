# Svetlana 2.0

Svetlana-2.0 is a phone-local AI agent. It executes device commands only for a verified/authorized user.

## Security boundary

- **Phone only:** device execution happens locally on the Android phone.
- **Verified user only:** commands must originate from the authorized user.
- **No remote control:** no remote phone/Svetlana control channel is allowed.
- **No network device-control transport:** no HTTP server, WebSocket control channel, remote endpoint, MCP network server, or TermuxMCP for phone control.
- **Local Android execution:** Hands uses the native Android AccessibilityService execution backend and native IPC where needed.
- **Independent verification:** a requested action is not considered successful until the resulting Android state is independently observed.

## Local system administration

Within Android's actual permissions and APIs, Svetlana may inspect local system/network state and administer the phone, including open-port visibility, monitoring, firewall and VPN operations. Sensitive operations are governed by Policy and verified-user authorization.

## Architecture

```text
Verified User
     ↓
  Svetlana
     ↓
 Orchestrator
     ↓
   Planner
     ↓
    Policy ──→ user confirmation when required
     ↓
 Tool Registry
     ↓
    Hands
     ↓
Android AccessibilityService / native Android APIs
     ↓
 real device action
     ↓
independent Verification
     ↓
  Svetlana
```

## Runtime evidence rule

Static TypeScript code is not runtime proof. Plan 0 closes only after:

`code → CI/build → APK → real Android device/emulator → AccessibilityService registered → onServiceConnected → local Hands call → real action → independent verification`

Until that chain is demonstrated, runtime status is **NOT PROVEN**.

## Development

The repository contains the AI/orchestration, policy, tools, verification and training foundations. The native Android execution bridge is a separate runtime layer and must remain local-only.

Training is downstream of the runtime gate. The training target is **Google Colab / Google GPU**, not Kaggle.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

## License

MIT
