# CI для Светланы

GitHub не даёт добавлять воркфлоу без права `workflow`, поэтому файлы лежат здесь. Один раз перенесите их:

```bash
mkdir -p .github/workflows && git mv ci/svetlana-core.yml ci/svetlana-android.yml .github/workflows/ && git commit -m "ci: включить" && git push
```

Или в вебе GitHub: Add file → Create new file → `.github/workflows/svetlana-android.yml` → вставить содержимое.

- `svetlana-core.yml` — 26 тестов ядра (включая настоящие PDF через Chrome).
- `svetlana-android.yml` — сборка APK «Светлана Руки»; готовый файл: Actions → запуск → Artifacts → `svetlana-hands-debug`.
