"""Офлайн-модели для Светланы: каталог проверенных моделей, скачивание прямо из приложения, проверка «видит ли экран».

Всё идёт через Ollama на этом компьютере (http://127.0.0.1:11434). Если Ollama нет — её установщик тоже качается отсюда.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

OLLAMA = os.environ.get("SVETLANA_OLLAMA", "http://127.0.0.1:11434")
OLLAMA_SETUP_URL = "https://ollama.com/download/OllamaSetup.exe"

# Порядок = порядок в списке. screen=True: видит картинки и вызывает инструменты, значит может управлять компьютером.
CATALOG = [
    {"tag": "qwen3-vl:8b", "title": "Qwen3-VL 8B — рекомендую", "size": "≈6 ГБ", "ram": "8 ГБ видео или 16 ГБ ОЗУ", "screen": True},
    {"tag": "qwen3-vl:4b", "title": "Qwen3-VL 4B — для слабых ПК", "size": "≈3,3 ГБ", "ram": "8 ГБ ОЗУ", "screen": True},
    {"tag": "qwen3-vl:2b", "title": "Qwen3-VL 2B — самая лёгкая", "size": "≈2 ГБ", "ram": "6 ГБ ОЗУ", "screen": True},
    {"tag": "qwen3-vl:30b", "title": "Qwen3-VL 30B — самая умная", "size": "≈19 ГБ", "ram": "24 ГБ видео или 32 ГБ ОЗУ", "screen": True},
    {"tag": "mistral-small3.1:24b", "title": "Mistral Small 3.1 24B", "size": "≈15 ГБ", "ram": "16 ГБ видео или 32 ГБ ОЗУ", "screen": True},
    {"tag": "qwen3:8b", "title": "Qwen3 8B — без зрения", "size": "≈5,2 ГБ", "ram": "16 ГБ ОЗУ", "screen": False},
    {"tag": "qwen3:14b", "title": "Qwen3 14B — без зрения", "size": "≈9,3 ГБ", "ram": "16 ГБ видео или 32 ГБ ОЗУ", "screen": False},
]
BY_TAG = {m["tag"]: m for m in CATALOG}


def label(m):
    return f"{m['title']} · {m['size']}" + ("" if m["screen"] else " · только разговор")


def tag_from_label(text):
    """Строка из списка → тег Ollama. Свой тег (например llama3.2-vision:11b) можно вписать руками."""
    t = (text or "").strip()
    for m in CATALOG:
        if t == label(m) or t == m["tag"]:
            return m["tag"]
    return t


def _req(path, body=None, timeout=5):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(OLLAMA + path, data=data, method="POST" if data else "GET", headers={"Content-Type": "application/json"} if data else {})
    return urllib.request.urlopen(r, timeout=timeout)


def installed(timeout=2):
    """Список скачанных моделей или None, если Ollama не запущена."""
    try:
        with _req("/api/tags", timeout=timeout) as r:
            return [m.get("name", "") for m in json.loads(r.read().decode("utf-8")).get("models", [])]
    except Exception:
        return None


def has_model(tag, names):
    return bool(tag) and any(n == tag or n == tag + ":latest" or (":" not in tag and n.split(":")[0] == tag) for n in (names or []))


def capabilities(tag):
    """Что умеет модель → возможности провайдера в ядре. Сначала спрашиваем Ollama, иначе берём из каталога."""
    caps = None
    try:
        with _req("/api/show", {"model": tag}, timeout=5) as r:
            got = json.loads(r.read().decode("utf-8")).get("capabilities")
            if isinstance(got, list) and got:
                caps = ["chat"] + [c for c in ("tools", "vision") if c in got]
    except Exception:
        pass
    if caps is None:
        m = BY_TAG.get(tag)
        caps = ["chat", "tools", "vision"] if (m and m["screen"]) else ["chat", "tools"]
    return caps


def pull(tag, progress=lambda pct, status: None, cancel=None):
    """Скачать модель через Ollama, показывая проценты. cancel — threading.Event для остановки."""
    with _req("/api/pull", {"model": tag, "stream": True}, timeout=60) as r:
        last = -1
        for raw in r:
            if cancel is not None and cancel.is_set():
                raise RuntimeError("скачивание отменено")
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("error"):
                raise RuntimeError(str(m["error"])[:300])
            total, done = m.get("total") or 0, m.get("completed") or 0
            pct = int(done * 100 / total) if total else last
            if pct != last or not total:
                progress(max(pct, 0), str(m.get("status", "")))
                last = pct
            if m.get("status") == "success":
                progress(100, "success")
                return True
    raise RuntimeError("Ollama оборвала скачивание, попробуйте ещё раз")


def ollama_exe():
    for p in (os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama", "ollama.exe"), shutil.which("ollama")):
        if p and os.path.isfile(p):
            return p
    return None


def start_ollama():
    """Ollama установлена, но не запущена: запускаем сервер в фоне."""
    exe = ollama_exe()
    if not exe:
        return False
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    try:
        subprocess.Popen([exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
    except OSError:
        return False
    return True


def download_ollama(progress=lambda pct: None, cancel=None, url=OLLAMA_SETUP_URL):
    """Скачать официальный установщик Ollama во временную папку и вернуть путь к нему."""
    dest = os.path.join(tempfile.gettempdir(), "OllamaSetup.exe")
    with urllib.request.urlopen(url, timeout=60) as r, open(dest + ".part", "wb") as f:
        total, got, last = int(r.headers.get("Content-Length") or 0), 0, -1
        while True:
            if cancel is not None and cancel.is_set():
                raise RuntimeError("скачивание отменено")
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            pct = int(got * 100 / total) if total else 0
            if pct != last:
                progress(pct)
                last = pct
    os.replace(dest + ".part", dest)
    return dest
