# Svetlana Browser Worker

This is a local, isolated browser runtime for Svetlana and personal agents. It is inspired by the agent-workspace pattern used by ego(lite), but does not copy ego(lite)'s proprietary browser engine or depend on its macOS-only application. It uses Playwright + Chromium as an independent adapter.

## Current scope

- A separate non-persistent browser context per agent session.
- Navigation, semantic page snapshot, role/name-based click and fill, bounded wait, screenshot, and close.
- Every successful navigation/action returns a fresh observation, so the caller can verify the resulting state.
- Loopback-only HTTP listener, bearer-token authentication, exact optional CORS origin, body-size limits, session TTL, session count limit, and blocking of private/reserved destinations.
- Downloads and service workers are disabled. Browser contexts are not persisted, and cookies are not imported from the user's everyday browser.

## Start locally

Requirements: Node.js 22.12+ and a Playwright-supported Chromium installation.

~~~sh
cd browser-worker
npm install
npx playwright install chromium
~~~

Generate a token with a password manager or a cryptographically secure generator (at least 32 characters). Set it in the environment; never commit it.

Linux/macOS shell example:

~~~sh
export SVETLANA_BROWSER_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
export SVETLANA_BROWSER_ALLOWED_ORIGIN="https://YOUR-SVETLANA-APP-ORIGIN"
npm start
~~~

The worker binds to loopback only (127.0.0.1:4178). It intentionally refuses to bind to a LAN/public interface. If the app runs at another origin, set SVETLANA_BROWSER_ALLOWED_ORIGIN to that exact origin. Do not use *. The token must be stored only in the local browser/app configuration and must never be embedded into a public Vite build or checked into Git.

## API

Every endpoint except GET /health requires Authorization: Bearer <token>.

- POST /v1/sessions — JSON {"agentId":"research-agent"}; returns an isolated sessionId.
- POST /v1/sessions/:id/navigate — JSON {"url":"https://example.com"}; returns the new observation.
- POST /v1/sessions/:id/snapshot — returns URL, title, ARIA snapshot and bounded visible text.
- POST /v1/sessions/:id/follow-link — JSON {"name":"About"}; follows a public HTTP(S) link only when its label/URL does not resemble a consequential action. It navigates to the destination instead of invoking the page's click handler.
- POST /v1/sessions/:id/click — JSON {"role":"link","name":"About"}; only semantic roles are accepted; LLM requests pass through ActionGate confirmation.
- POST /v1/sessions/:id/fill — JSON {"role":"textbox","name":"Search","value":"query"}.
- POST /v1/sessions/:id/wait — JSON {"ms":500}, limited to 10 seconds.
- POST /v1/sessions/:id/screenshot — returns a JPEG image as base64.
- DELETE /v1/sessions/:id — closes the context.

## Security boundaries

Web-page text is untrusted input and must never be treated as policy or system instructions. The model must use Svetlana's existing ToolRegistry, ActionGate, policy checks, and confirmation UI before actions with consequences. The worker itself does not decide that a click is authorized just because a page asks for it.

The worker is a local runtime component, not a cloud service, and must never be exposed to the Internet. The installed Windows build bundles its own Node executable, Playwright package, and Chromium headless shell in the Tauri resources, generates a fresh bearer token per process launch, and starts/stops the worker with Svetlana. The Android APK does not include Node/Playwright: it uses a native Android System WebView controlled through the trusted app bridge; the web page being browsed never receives that bridge. Browser cookies are disabled for the Android WebView runtime, and the browser does not import the user's everyday-browser profile. Web/PWA development builds still require a compatible Node.js + Playwright/Chromium runtime and manual Worker configuration as described above.

The private text-file workspace in Svetlana is separate: it uses app-origin local storage and does not grant access to the shared Android filesystem. DNS/IP checks reduce SSRF risk but are not a substitute for OS-level network isolation; review before using it with sensitive accounts. Password fields and payment credentials are blocked; actions that can submit, send, delete, pay, or otherwise have consequences require explicit confirmation. File upload, downloads, and persistent logged-in browser profiles remain out of scope.

## Verification status

- Static implementation and TypeScript integration tests: covered by the repository CI.
- Browser Worker runtime smoke test: CI installs Chromium, authenticates, creates an isolated session, navigates to `https://example.com`, follows its safe IANA link through the navigation-only endpoint, verifies that loopback navigation is rejected, and closes the session. Unit tests cover the dangerous-link policy.
- Windows installer packaging is configured to include Node.js, Playwright and the Chromium headless shell; app startup generates a per-launch token and launches the worker automatically.
- Android automation uses a separate in-app WebView, with no page access to the trusted Svetlana bridge; commands and risk checks live in the native app process.
- Installed-app runtime verification is performed by the Windows packaging smoke test and Android emulator smoke test; a physical-device test is still required before claiming device-specific validation.
- Persistent logged-in sessions or direct ego(lite) adapter: not implemented.
