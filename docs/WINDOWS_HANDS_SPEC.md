# Windows MCP Server for Svetlana Hands

Этот документ задаёт архитектуру локального сервера Windows Hands, реализующего контракт `PlatformHands` через UI Automation и Win32.

## Архитектура

```
Svetlana-2.0 Web / Desktop Shell
        │
        ▼ WebSocket/HTTP JSON-RPC 2.0 (localhost:8766, auth token)
┌────────────────────────────────────────────────────────┐
│  Windows MCP Host (.NET 8 C# / System.Windows.Automation)│
├────────────────────────────────────────────────────────┤
│ - ui.getAutomationTree: UI Automation AutomationElement│
│ - ui.findElement: NameProperty / AutomationIdProperty │
│ - input.click / input.type: Win32 SendInput           │
│ - screen.capture: Desktop Duplication API / Graphics   │
│ - app.launch: Process.Start / Appx shell launch       │
└────────────────────────────────────────────────────────┘
```

## Методы протокола

| JSON-RPC метод | Назначение |
|---|---|
| `app.launch` | Запуск по пути, exe или app-URI |
| `app.getActiveWindow` | Имя процесса и заголовок активного окна |
| `input.click` | Клик по экранным координатам `{ x, y }` |
| `input.type` | Ввод текста через Win32 SendInput |
| `input.clearText` | Ctrl+A, Backspace |
| `input.scroll` | Колесо мыши / скролл-события |
| `input.key` / `input.keyCombo` | Симуляция нажатия горячих клавиш |
| `ui.getAutomationTree` | Дерево элементов активного окна |
| `ui.findElement` | Поиск по имени или AutomationId |
| `screen.capture` | Base64 PNG снимок экрана |
