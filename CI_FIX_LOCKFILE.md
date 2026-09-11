# CI Fix - package-lock.json Resync

## Проблема
CI падал на `npm ci` с ошибкой ERESOLVE из-за рассинхронизации package-lock.json с package.json.

## Причина
- package.json был обновлён (@types/node: ^22.0.0)
- package-lock.json остался от старой версии (@types/node: ^20.11.0)
- vitest@5.0.0 требует @types/node ^22.0.0 || >=24.0.0
- npm ci строго проверяет соответствие lockfile и package.json

## Решение
1. Удалён старый package-lock.json
2. Переустановлены все зависимости
3. Создан новый package-lock.json с правильными версиями

## Проверка локально
✅ Build проходит успешно
✅ package-lock.json синхронизирован с package.json
✅ Все зависимости установлены корректно

## Изменения
- package-lock.json: пересоздан (2341 строка)

## Следующие шаги
```bash
git add package-lock.json
git commit -m "fix: resync package-lock.json with package.json

- Remove outdated package-lock.json
- Reinstall all dependencies
- Create new lockfile matching package.json
- Fix npm ci ERESOLVE error

This fixes CI failure on 'Install dependencies' step."
git push
```

## Ожидаемый результат CI
После push CI должен пройти все шаги:
1. ✅ Install dependencies (npm ci)
2. ✅ Typecheck
3. ✅ Build
4. ✅ Tests
5. ✅ Lint
6. ✅ Security

## Важно
НЕ присылать отчёт "исправлено" пока CI реально не подтвердит исправление.
Дождаться нового CI run и проверить все шаги.
