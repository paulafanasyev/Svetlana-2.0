# Contributing to Svetlana 2.0

Спасибо за интерес к проекту Svetlana 2.0! Мы приветствуем вклад от сообщества.

## 🎯 Как внести вклад

### Сообщить о баге

1. Проверьте [существующие issues](https://github.com/paulafanasyev/Svetlana-2.0/issues), чтобы избежать дубликатов
2. Создайте новый issue с описанием проблемы
3. Укажите:
   - Версию Node.js
   - Версию браузера
   - Шаги для воспроизведения
   - Ожидаемое поведение
   - Фактическое поведение
   - Логи (если есть)

### Предложить улучшение

1. Создайте issue с меткой `enhancement`
2. Опишите предлагаемое улучшение
3. Объясните, почему это улучшение полезно

### Внести код

1. Fork репозиторий
2. Создайте feature branch: `git checkout -b feature/amazing-feature`
3. Внесите изменения
4. Добавьте тесты
5. Убедитесь, что все тесты проходят: `npm test`
6. Убедитесь, что код проходит typecheck: `npm run typecheck`
7. Commit изменения: `git commit -m 'Add amazing feature'`
8. Push в branch: `git push origin feature/amazing-feature`
9. Создайте Pull Request

## 🛠️ Разработка

### Установка

```bash
# Клонировать репозиторий
git clone https://github.com/paulafanasyev/Svetlana-2.0.git
cd Svetlana-2.0

# Установить зависимости
npm install

# Запустить dev сервер
npm run dev
```

### Структура проекта

- `src/services/` — Core сервисы (AI Gateway, Transport, Tools)
- `src/pages/` — UI страницы
- `src/__tests__/` — Тесты
- `docs/` — Документация

### Стиль кода

- TypeScript strict mode
- Функциональный стиль где возможно
- Комментарии на русском или английском
- Именование: camelCase для переменных, PascalCase для компонентов

### Тестирование

```bash
# Запустить все тесты
npm test

# Запустить тесты в watch режиме
npm run test:watch

# Проверить покрытие
npm run test -- --coverage
```

### Добавление нового инструмента

1. Создайте инструмент в `src/services/RealTools.ts`
2. Следуйте паттерну BEFORE → ACTION → AFTER → COMPARE
3. Добавьте тесты в `src/__tests__/verification.test.ts`
4. Обновите документацию в `docs/ANDROID_HANDS.md`

### Добавление нового теста

1. Создайте тест в `src/__tests__/`
2. Используйте описательные имена тестов
3. Покрывайте как успешные, так и неудачные сценарии
4. Используйте моки для внешних зависимостей

## 📋 Требования к Pull Request

- [ ] Код проходит `npm run typecheck`
- [ ] Код проходит `npm run build`
- [ ] Все тесты проходят `npm test`
- [ ] Добавлены тесты для нового функционала
- [ ] Обновлена документация (если необходимо)
- [ ] Commit messages описательные
- [ ] Нет console.log в production коде
- [ ] Нет hardcoded secrets

## 🚫 Что не принимать

- Fake реализации (success: true без реальной логики)
- Hardcoded API keys
- Console.log в production коде
- Непокрытые тестами критические функции
- Breaking changes без миграции

## 💬 Общение

- Вопросы: создайте issue с меткой `question`
- Обсуждения: GitHub Discussions
- Баги: GitHub Issues

## 📄 Лицензия

Внося вклад, вы соглашаетесь, что ваш код будет лицензирован под MIT License.

---

Спасибо за ваш вклад! 🙏
