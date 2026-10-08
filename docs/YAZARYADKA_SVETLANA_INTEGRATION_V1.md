# Svetlana 2.0 × Я-Зарядка AI integration v1

Архитектура: Camera/CV → structured metrics → Svetlana domain skill → verified text → Supertonic 3 TTS.

CV выдаёт counts, quality, confidence и detection state. Svetlana интерпретирует только эти структурированные данные, сохраняет uncertainty и формирует короткий ответ. Android command layer исполняет start/stop/repeat и возвращает фактический результат. Supertonic 3 озвучивает только подтверждённый текст. LiteRT-LM Qwen3-0.6B остаётся локальным Piko runtime в Android и не считается обученной Svetlana-моделью без отдельной проверки model/runtime artifact.

Evidence: Code → CI → model artifact → Android runtime/device → CV input → Svetlana result → TTS audio → observed result.

Current status:
- VERIFIED: PR #12 содержит Supertonic 3 F1-F5 и LiteRT-LM Qwen3-0.6B runtime code.
- VERIFIED: training branch now contains a Ya-Zaryadka dataset and held-out evaluation, and manifest_v2 includes both.
- PENDING: real GPU SFT and fixed held-out evaluation.
- PENDING: verified model/runtime artifact, передающий поведение Svetlana в Ya-Zaryadka.
