# Модель Светланы

Одна Светлана, обученная всему: помощница Павла и Пико для детей, маркетплейс АИКО, «Мир самозанятых», законы о самозанятых, работа с любыми программами на ПК, программирование. Две версии из одного обучения:

| Версия | Основа | Где работает | Файл |
|---|---|---|---|
| `pc` | Gemma 4 E4B + LoRA Светланы | компьютер, локально (Ollama, llama.cpp, LM Studio) | `svetlana-pc-q4_k_m.gguf` |
| `phone` | Gemma 4 E2B + LoRA Светланы | телефон, на устройстве | `svetlana-phone-q4_k_m.gguf` |

Gemma 4 понимает картинки и звук. Если при сборке получился файл зрения `svetlana-…-mmproj.gguf`, он лежит в том же релизе. Прежняя основа Qwen2.5 (7B/3B, только текст): обучение с `SV_FAMILY=qwen`.

Веса не хранятся в git: GitHub не принимает файлы больше 100 МБ. Обучение в Colab само выкладывает их в **Releases этого репозитория** (большие файлы частями по 1,9 ГБ с контрольными суммами) и, если нужно, на Hugging Face.

## Получить
```bash
python model/get.py pc          # или phone
cd model && ollama create svetlana -f Modelfile
```
В Светлане: «ИИ-провайдеры» → адрес `http://127.0.0.1:11434/v1`, модель `svetlana`.

## Обучить заново
Colab, среда с GPU:
```
!git clone -b svetlana-core-v2 https://github.com/paulafanasyev/Svetlana-2.0 && cd Svetlana-2.0/core && GH_TOKEN=ваш_токен python training/colab_train.py
```
A100 обучает обе версии, L4 только `pc`, бесплатный T4 только `phone`. Выбрать вручную: `SV_SIZES=pc,phone`.
