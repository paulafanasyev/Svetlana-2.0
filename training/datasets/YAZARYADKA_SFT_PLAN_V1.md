# Я-Зарядка SFT v1

Добавляем доменный skill Я-Зарядка в существующий Svetlana 2.0 training pipeline. Отдельная модель не создаётся.

Train: training/datasets/yazaryadka_fitness_sft_v1.jsonl
Eval: training/evaluation/yazaryadka_fitness_eval_v1.jsonl

Gate: новый held-out eval должен проходить вместе с существующими acceptance/evidence gates. Статические тесты сами по себе PASS не дают.
