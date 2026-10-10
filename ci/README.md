# CI для Светланы

Активные GitHub Actions workflow-файлы находятся в `.github/workflows/` и запускаются GitHub Actions автоматически.

- `.github/workflows/svetlana-core.yml` — тесты ядра (включая PDF через Chrome) и проверка desktop-agent.
- `.github/workflows/svetlana-android.yml` — сборка APK «Светлана Руки»; готовый файл публикуется как артефакт `svetlana-hands-debug`.

Для ручного запуска `svetlana-core` или `svetlana-android` откройте GitHub → Actions → выберите workflow → Run workflow.
