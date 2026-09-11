# Changelog

Все значимые изменения в проекте будут документироваться в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
и этот проект придерживается [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/paulafanasyev/Svetlana-2.0/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/paulafanasyev/Svetlana-2.0/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/paulafanasyev/Svetlana-2.0/releases/tag/v1.0.0
