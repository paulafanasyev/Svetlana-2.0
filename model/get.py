#!/usr/bin/env python3
"""Скачать обученную Светлану из Releases этого репозитория.

    python model/get.py pc       # компьютер: 7B, затем  ollama create svetlana -f model/Modelfile
    python model/get.py phone    # телефон: 3B (файл .gguf скопировать в приложение)
Приватный репозиторий: задайте GH_TOKEN. Только стандартная библиотека Python.
"""
import hashlib, json, os, sys, urllib.request

REPO = os.environ.get("SV_REPO", "paulafanasyev/Svetlana-2.0")
HERE = os.path.dirname(os.path.abspath(__file__))
H = {"Accept": "application/vnd.github+json", "User-Agent": "svetlana-get"}
if os.environ.get("GH_TOKEN"):
    H["Authorization"] = f"Bearer {os.environ['GH_TOKEN']}"


def get(url, accept=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers={**H, **({"Accept": accept} if accept else {})}))


def main():
    size = (sys.argv[1:] or ["pc"])[0]
    if size not in ("pc", "phone"):
        sys.exit("укажите pc или phone")
    rels = [r for r in json.load(get(f"https://api.github.com/repos/{REPO}/releases?per_page=30")) if r["tag_name"].startswith("model-")]
    if not rels:
        sys.exit("релизов модели пока нет — запустите обучение в Colab (core/training/colab_train.py) с GH_TOKEN")
    rel = rels[0]
    assets = {a["name"]: a for a in rel["assets"]}
    manifest = json.load(get(assets["manifest.json"]["url"], "application/octet-stream"))
    for r in manifest["results"]:
        print(f"  {r['size']}: экзамен {100 * r['score']:.0f}%{'' if r['passed'] else ' (НЕ ПРОЙДЕН)'}")
    name = f"svetlana-{size}-q4_k_m.gguf"
    parts = sorted((a for a in manifest["assets"] if a["name"] == name or a["name"].startswith(name + ".part")), key=lambda a: a["name"])
    if not parts:
        sys.exit(f"в релизе {rel['tag_name']} нет версии {size}")
    out = os.path.join(HERE, name)
    with open(out, "wb") as dst:
        for a in parts:
            print(f"скачиваю {a['name']} ({a['size'] / 2**30:.1f} ГБ)…", flush=True)
            h = hashlib.sha256()
            with get(assets[a["name"]]["url"], "application/octet-stream") as src:
                for chunk in iter(lambda: src.read(1 << 20), b""):
                    h.update(chunk); dst.write(chunk)
            if h.hexdigest() != a["sha256"]:
                sys.exit(f"контрольная сумма {a['name']} не совпала — скачайте заново")
    print(f"готово: {out}")
    if size == "pc":
        open(os.path.join(HERE, "Modelfile"), "w", encoding="utf-8").write(f"FROM ./{name}\nPARAMETER temperature 0.3\nPARAMETER num_ctx 16384\n")
        print("дальше:  cd model && ollama create svetlana -f Modelfile\n"
              "в Светлане → «ИИ-провайдеры»: адрес http://127.0.0.1:11434/v1, модель svetlana")
    else:
        print("скопируйте файл на телефон и откройте в приложении для локальных моделей на llama.cpp (например, PocketPal AI);\n"
              "встроенный запуск прямо в приложении «Светлана» — следующий этап")


if __name__ == "__main__":
    main()
