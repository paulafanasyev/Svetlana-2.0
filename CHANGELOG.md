# Changelog

## [2.1.4] - 2026-10-23

### Added
- Native Android in-app browser sessions using Android System WebView, controlled by browser tools from the personal-agent chat without a separate worker.
- Windows installer runtime packaging for Node.js, Playwright, and headless Chromium, with automatic local worker startup/shutdown and a per-launch bearer token.
- Browser runtime and Android emulator smoke checks are part of the release validation path.

### Security
- Keep browsed pages isolated from Svetlana's privileged application bridge; disable browser cookies and downloads in the Android agent browser.
- Require explicit confirmation for consequential web actions and block password/payment credential entry.

### Verification
- CI builds, browser runtime smoke tests, and Android emulator smoke are required before publication.
- Physical-device testing remains a separate acceptance check; CI does not claim it.

## [2.1.3] - 2026-10-23

### Added
- Isolated local Browser Worker tools for personal agents: navigation, page snapshots, semantic click/fill, bounded waits and session cleanup.
- Explicit durable memory in the main «Чат со Светланой»: save with «Запомни: …», review saved entries and delete them; selected memories are injected into later chat context.
- Browser Worker runtime smoke verification in CI, including real Chromium startup, page navigation and rejection of loopback targets.

### Fixed
- Align npm, lockfile, Tauri, Cargo, Android and frontend release versions.

### Deployment notes
- Browser automation remains an opt-in local service. The Windows installer and Android APK do not bundle the Node.js/Playwright Chromium runtime; a compatible local worker must be installed and started separately. Browser automation is not available as an embedded Android-native browser in this release.
- CI smoke tests verify the local worker runtime, but do not claim end-to-end verification on a physical user device.

## [2.1.2] - 2026-10-23

### Added
- Guided first-run setup: Svetlana recommends an AI connection method, navigates to that step, and explains how to test the connection.
- Personal agents, per-agent conversation history and explicit long-term memory notes.
- Local reviewable memory suggestions; nothing is saved until the user approves it.
- Opt-in account-based workspace synchronization through Supabase, with owner-scoped RLS and deletion tombstones.

### Fixed
- Align application, Tauri, Cargo, npm lockfile and Android versions for the release.
- Keep first-run setup from automatically opening the mobile keyboard before the user chooses a setup path.

### Deployment notes
- Cloud sync remains disabled until a Supabase project is configured, the migration is applied, and the public Supabase URL and anon key are set in the build environment.
- This release does not claim physical-device E2E verification from CI builds alone.

## [2.1.1] - 2026-10-22

### Added
- Chat attachments for text/code, ZIP archives, supported Office documents, images, video frames and audio input on compatible AI providers.

### Fixed
- Align the application version across package.json, Tauri, Cargo and the frontend release constant.


Все значимые изменения в проекте будут документироваться в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
и этот проект придерживается [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-10-15

Приложение для Windows (Tauri), подробности в docs/WINDOWS.md.

### Added
- Главное окно «Чат со Светланой» (DesktopShell); схемы и демо разработки — во вкладке «Для разработчика» с предупреждением
- Мастер первого запуска: ★ Светлана Сервер по ключу или Ollama с уже скачанной моделью, пробный запрос
- Русский установщик NSIS, автоустановка WebView2, единая версия (src/version.ts)

### Fixed
- В сборку для Windows больше не попадает веб-CSP, блокирующая вызовы нативной части (ipc:)
- Ключ ИИ сохраняется до проверки соединения; отмена в окне Windows не оставляет ложное «Ключ есть»
- Понятные ошибки Ollama (не запущена / нет модели) и сервера Светланы (ключ, связь)

### Security
- Нативная часть: размер запроса проверяется до разбора схемы, ответ читается по частям с обрывом на 8 МБ

## [Unreleased]

### Added
- Полная документация по архитектуре Android Hands
- ExecutionLogger для диагностики выполнения
- Интеграционные тесты для полной цепочки выполнения
- README.md с полным описанием проекта
- CONTRIBUTING.md с руководством для контрибьюторов
- CODE_OF_CONDUCT.md на основе Contributor Covenant
- LICENSE (MIT)
- CHANGELOG.md

### Changed
- Усилены verification для всех инструментов
- Улучшена документация в ANDROID_HANDS.md
- Обновлён .gitignore

### Fixed
- Удалён 'mock' из transport types
- Исправлен CI workflow
- Добавлены недостающие scripts в package.json

## [2.0.0] - 2026-03-10

### Added
- **Transport Layer**
  - PlatformHands контракт управления устройством
  - WebSocketHands клиент (JSON-RPC 2.0)
  - HTTPHands клиент (REST API)
  - HandsManager менеджер подключений

- **Real Tools**
  - open_app — запуск приложения с verification
  - tap_element — тап по элементу с BEFORE/AFTER сравнением
  - type_text — ввод текста с проверкой содержимого
  - capture_screen — скриншот с verification
  - send_message — отправка сообщения с поиском в чате

- **MCP Protocol**
  - JSON-RPC 2.0 based protocol
  - Request/Response с ID
  - Error codes
  - Observation/Verification structures

- **Policy Engine**
  - Risk levels (LOW, MEDIUM, HIGH, CRITICAL)
  - Confirmation для HIGH/CRITICAL
  - Audit log
  - Daily limits

- **Verification Engine**
  - BEFORE → ACTION → AFTER → COMPARE pattern
  - Confidence scoring
  - Retry logic с exponential backoff

- **AI Gateway**
  - 9 AI провайдеров (OpenAI, Anthropic, Google, Groq, и др.)
  - Structured tool calling
  - Provider fallback

- **Testing**
  - transport.test.ts — тесты transport layer
  - verification.test.ts — тесты verification logic
  - integration.test.ts — интеграционные тесты

- **CI/CD**
  - GitHub Actions workflow
  - Typecheck, build, tests
  - Stub detection
  - Security check

- **UI**
  - AndroidConnectionPage — подключение к Android
  - E2ETestPage — тестирование
  - Навигация и интеграция

- **Documentation**
  - ANDROID_HANDS.md — полная документация
  - VERIFIED / NOT PROVEN sections

### Changed
- Удалены все заглушки из ToolRegistry
- Усилена verification для type_text
- Усилена verification для tap_element
- Усилена verification для send_message
- Исправлен CI workflow

### Fixed
- Убран 'mock' из PlatformHands transport types
- Добавлены scripts в package.json
- Создан vitest.config.ts

### Security
- Добавлена проверка на hardcoded secrets в CI
- Добавлен npm audit в CI
- Удалены заглушки, которые могли маскировать проблемы

## [1.0.0] - 2026-03-01

### Added
- Initial release
- Basic AI Gateway
- Simple tool registry
- Demo implementations

---

## Типы изменений

- **Added** — новые функции
- **Changed** — изменения в существующем функционале
- **Deprecated** — функции, которые будут удалены
- **Removed** — удалённые функции
- **Fixed** — исправления багов
- **Security** — исправления уязвимостей

## Версионирование

- **Major** (X.0.0) — breaking changes
- **Minor** (0.X.0) — новый функционал без breaking changes
- **Patch** (0.0.X) — исправления багов

---

[2.1.0]: https://github.com/paulafanasyev/Svetlana-2.0/pull/39
[Unreleased]: https://github.com/paulafanasyev/Svetlana-2.0/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/paulafanasyev/Svetlana-2.0/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/paulafanasyev/Svetlana-2.0/releases/tag/v1.0.0
