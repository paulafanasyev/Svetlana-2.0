# Svetlana 2.0 — Current Real Transport Contract

## Architecture

`Svetlana → Orchestrator → Planner → Policy → Tool Registry → Hands → Android → Verification → Svetlana`

The control plane contains the `PlatformHands` contract, `HandsManager`, real tools, and transport clients.

## Current Android HTTP transport

`src/services/HTTPHands.ts` uses the Android loopback endpoint:

`http://127.0.0.1:8765`

Connection: `GET /health`.

Tool requests: `POST /api/<method>` with `params` and `timestamp`.

Current method mapping is documented in `docs/ANDROID_HANDS.md`.

## Evidence discipline

**VERIFIED:** real HTTP request code, Hands/tool integration, verification code, and static CI gates.

**NOT PROVEN:** real Android endpoint availability, AccessibilityService binding, real device action, real screen capture, and end-to-end device verification.

A transport client is not evidence that an Android action occurred.

## Plan 0 runtime gate

Closure requires:

`code → CI/build → APK → real Android emulator/device → real HTTP tool call → real Android action → independent observation → verification`

Until that chain is captured, Plan 0 remains **NOT CLOSED**.

## Training

Target environment: **Google Colab / Google GPU**.

Kaggle is not the training target.
