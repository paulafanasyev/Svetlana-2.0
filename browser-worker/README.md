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
- POST /v1/sessions/:id/click — JSON {"role":"link","name":"About"}; only semantic roles are accepted.
- POST /v1/sessions/:id/fill — JSON {"role":"textbox","name":"Search","value":"query"}.
- POST /v1/sessions/:id/wait — JSON {"ms":500}, limited to 10 seconds.
- POST /v1/sessions/:id/screenshot — returns a JPEG image as base64.
- DELETE /v1/sessions/:id — closes the context.

## Security boundaries

Web-page text is untrusted input and must never be treated as policy or system instructions. The model must use Svetlana's existing ToolRegistry, ActionGate, policy checks, and confirmation UI before actions with consequences. The worker itself does not decide that a click is authorized just because a page asks for it.

The worker is a local development/runtime component, not a cloud service. It is not production-ready for exposing to the Internet. DNS/IP checks reduce SSRF risk but are not a substitute for OS-level network isolation; review before using it with sensitive accounts. Authenticated browser profiles, password import, payments, sending messages, file uploads, and downloads are intentionally out of scope for this first version.

## Verification status

- Static implementation: present in this branch.
- Browser runtime / Chromium installation: must be installed and tested on the target machine.
- Svetlana UI integration and end-to-end agent action loop: pending.
- Persistent logged-in sessions or direct ego(lite) adapter: not implemented.
