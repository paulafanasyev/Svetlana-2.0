# Svetlana 2.0

AI-агент для управления Android устройствами через MCP (Model Context Protocol).

## 🎯 Возможности

- **Управление приложениями**: запуск, закрытие, переключение
- **UI автоматизация**: тапы, ввод текста, свайпы, нажатия клавиш
- **Наблюдение**: скриншоты, accessibility tree, OCR
- **Верификация**: автоматическая проверка результатов действий
- **Безопасность**: политика рисков, подтверждение опасных действий
- **AI интеграция**: поддержка 9+ AI провайдеров (OpenAI, Anthropic, Google, Groq, и др.)

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    Svetlana 2.0 (Web)                        │
│                                                              │
│  UI → AI Gateway → Planner → Policy → ToolRegistry          │
│                                    ↓                         │
│                              HandsManager                    │
│                                    ↓                         │
│                      ┌─────────────┴─────────────┐          │
│                      │                           │          │
│                WebSocketHands              HTTPHands         │
│                      │                           │          │
│                      └─────────────┬─────────────┘          │
│                                    │ MCP (JSON-RPC 2.0)     │
└────────────────────────────────────┼────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────┐
│                    Svetlana-App (Android)                     │
│                                    │                         │
│                          MCP Server                          │
│                                    │                         │
│                      AccessibilityService                     │
│                                    │                         │
│                          Android APIs                        │
└──────────────────────────────────────────────────────────────┘
```

## 📦 Установка

### Требования

- Node.js 18+ или 20+
- npm или yarn
- Android устройство с установленным Svetlana-App

### Svetlana 2.0 (Web)

```bash
# Клонировать репозиторий
git clone https://github.com/paulafanasyev/Svetlana-2.0.git
cd Svetlana-2.0

# Установить зависимости
npm install

# Запустить dev сервер
npm run dev

# Собрать production версию
npm run build
```

### Svetlana-App (Android)

См. репозиторий [Svetlana-App](https://github.com/paulafanasyev/Svetlana-App)

## 🔌 Подключение к Android

1. **Установите Svetlana-App** на Android устройство
2. **Запустите MCP Server** в Svetlana-App
3. **Откройте Svetlana 2.0** в браузере
4. **Перейдите в "Android Connection"**
5. **Выберите транспорт**: WebSocket или HTTP
6. **Введите endpoint**: `ws://YOUR_ANDROID_IP:8080` или `http://YOUR_ANDROID_IP:8080`
7. **Нажмите "Connect"**

## 🛠️ Доступные инструменты

### Навигация
- **open_app** — запуск приложения по package name
  - Risk: LOW
  - Verification: проверка текущего приложения

### Взаимодействие
- **tap_element** — тап по элементу UI
  - Risk: MEDIUM
  - Verification: сравнение before/after состояния
  
- **type_text** — ввод текста в поле
  - Risk: MEDIUM
  - Verification: проверка содержимого поля
  
- **swipe** — свайп жест
  - Risk: MEDIUM
  
- **press_key** — нажатие клавиши
  - Risk: MEDIUM

### Система
- **capture_screen** — скриншот экрана
  - Risk: LOW
  - Verification: проверка наличия изображения

### Коммуникация
- **send_message** — отправка сообщения
  - Risk: HIGH (требует подтверждения)
  - Verification: поиск сообщения в чате

## 🔒 Безопасность

### Уровни риска

| Уровень | Действия | Подтверждение |
|---------|----------|---------------|
| LOW | screenshot, observe | Автоматически |
| MEDIUM | launch app, tap, type | Автоматически |
| HIGH | send message | Требуется |
| CRITICAL | payment, delete | Требуется |

### Verification Pattern

Все действия следуют паттерну:
```
BEFORE → ACTION → AFTER → COMPARE → PASS/FAIL
```

Пример:
```
BEFORE: currentApp = "com.android.launcher"
ACTION: launchApp("org.telegram.messenger")
AFTER: currentApp = "org.telegram.messenger"
VERIFY: currentApp === "org.telegram.messenger" → PASS
```

## 🧪 Тестирование

```bash
# Запустить все тесты
npm test

# Запустить тесты в watch режиме
npm run test:watch

# Проверить типы
npm run typecheck

# Собрать проект
npm run build
```

## 📚 Документация

- [Android Hands Architecture](docs/ANDROID_HANDS.md) — полная документация по архитектуре
- [MCP Protocol](docs/ANDROID_HANDS.md#mcp-model-context-protocol) — спецификация протокола
- [Security Model](docs/ANDROID_HANDS.md#security) — модель безопасности

## 🏗️ Разработка

### Структура проекта

```
Svetlana-2.0/
├── src/
│   ├── services/           # Core сервисы
│   │   ├── AIGateway.ts    # AI провайдеры
│   │   ├── PlatformHands.ts # Контракт управления
│   │   ├── WebSocketHands.ts # WebSocket транспорт
│   │   ├── HTTPHands.ts    # HTTP транспорт
│   │   ├── HandsManager.ts # Менеджер подключений
│   │   ├── ToolRegistry.ts # Реестр инструментов
│   │   ├── RealTools.ts    # Реальные инструменты
│   │   ├── PolicyEngine.ts # Политика безопасности
│   │   ├── Verification.ts # Верификация действий
│   │   ├── MCPProtocol.ts  # MCP протокол
│   │   └── ...
│   ├── pages/              # UI страницы
│   │   ├── AndroidConnectionPage.tsx
│   │   ├── AvatarPage.tsx
│   │   └── ...
│   ├── __tests__/          # Тесты
│   │   ├── transport.test.ts
│   │   ├── verification.test.ts
│   │   └── integration.test.ts
│   └── App.tsx             # Главный компонент
├── docs/                   # Документация
│   └── ANDROID_HANDS.md
├── .github/workflows/      # CI/CD
│   └── ci.yml
└── package.json
```

### Добавление нового инструмента

1. Создайте инструмент в `src/services/RealTools.ts`:

```typescript
export const myNewTool: Tool = {
  id: 'my_new_tool',
  name: 'My New Tool',
  description: 'Description',
  category: 'interaction',
  riskLevel: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter 1' }
    },
    required: ['param1']
  },
  async execute(params) {
    await requireHands();
    const hands = handsManager.getHands();
    // Реальная логика
    return { success: true, data: { ... } };
  },
  async verify(params, result) {
    // Verification logic
    return true;
  },
  async isAvailable() {
    return await handsManager.isConnected();
  }
};
```

2. Зарегистрируйте инструмент:

```typescript
toolRegistry.registerTool(myNewTool);
```

## 🚀 CI/CD

GitHub Actions автоматически запускает:
- Type checking
- Build
- Tests
- Security audit
- Проверку на stub реализации

## 📊 Статус проекта

### VERIFIED ✅
- Transport layer (WebSocket, HTTP)
- Real tools с verification
- MCP protocol
- Policy engine
- Test suite
- CI/CD

### NOT PROVEN ⚠️
- Real device connection (требует Svetlana-App)
- Real AccessibilityService integration
- Real screen capture
- End-to-end testing on device

## 🤝 Вклад

Contributions welcome! Пожалуйста:
1. Fork репозиторий
2. Создайте feature branch
3. Добавьте тесты
4. Убедитесь, что все тесты проходят
5. Создайте Pull Request

## 📄 Лицензия

MIT

## 🔗 Ссылки

- [Svetlana-App](https://github.com/paulafanasyev/Svetlana-App) — Android execution layer
- [MCP Protocol](https://modelcontextprotocol.io/) — Model Context Protocol
- [Documentation](docs/ANDROID_HANDS.md) — Полная документация

---

**Статус**: 🟢 Active Development  
**Версия**: 2.0.0  
**Последнее обновление**: 2026-03-10
