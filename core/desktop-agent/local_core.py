"""Ядро Светланы прямо на этом компьютере: без VPS, без Docker, без облака.

Что делает LocalCore:
  1) находит node.exe (рядом с программой в установщике или в системе) и папку ядра;
  2) один раз генерирует пароль владельца и ключ подписи подтверждений, хранит их в %APPDATA%\\Svetlana\\local-core.json;
  3) при первом запуске прописывает локального провайдера ИИ (Ollama на 127.0.0.1:11434), облачные можно добавить потом;
  4) запускает ядро на 127.0.0.1 (наружу не слушает), ждёт /healthz;
  5) сам выдаёт этому компьютеру ключ устройства, чтобы руки и глаза подключились без копирования адреса и ключа.
"""
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

DEFAULT_PORT = 8787
DEFAULT_MODEL = "qwen3-vl:8b"  # Ollama: видит картинки и умеет вызывать инструменты; можно сменить в окне
OLLAMA = "http://127.0.0.1:11434"


def _app_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _user_dir():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    d = os.path.join(base, "Svetlana")
    os.makedirs(d, exist_ok=True)
    return d


def find_node():
    for p in (os.environ.get("SVETLANA_NODE"), os.path.join(_app_dir(), "node", "node.exe"), os.path.join(_app_dir(), "node", "node")):
        if p and os.path.isfile(p):
            return p
    return shutil.which("node")


def find_core():
    for d in (os.environ.get("SVETLANA_CORE_DIR"), os.path.join(_app_dir(), "core"), os.path.join(_app_dir(), "..")):
        if d and os.path.isfile(os.path.join(d, "server.mjs")):
            return os.path.abspath(d)
    return None


def _port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def ollama_status(model=None, base=OLLAMA, timeout=2):
    """(запущена ли Ollama, скачана ли нужная модель, список моделей)."""
    try:
        with urllib.request.urlopen(base + "/api/tags", timeout=timeout) as r:
            names = [m.get("name", "") for m in json.loads(r.read().decode("utf-8")).get("models", [])]
    except Exception:
        return False, False, []
    has = bool(model) and any(n == model or n == model + ":latest" or (":" not in model and n.split(":")[0] == model) for n in names)
    return True, has, names


class LocalCore:
    def __init__(self, data_dir=None, port=None, model=None, log=print):
        self.dir = data_dir or _user_dir()
        self.cfg_path = os.path.join(self.dir, "local-core.json")
        self.data = os.path.join(self.dir, "core-data")
        self.log = log
        self.proc = None
        self.st = self._load()
        if port:
            self.st["port"] = port
        if model:
            self.st["model"] = model
        self.st.setdefault("port", DEFAULT_PORT)
        self.st.setdefault("model", DEFAULT_MODEL)
        self.st.setdefault("adminToken", secrets.token_urlsafe(24))
        self.st.setdefault("secret", secrets.token_hex(32))
        self._save()

    # ---------- состояние ----------
    def _load(self):
        try:
            with open(self.cfg_path, encoding="utf-8") as f:
                v = json.load(f)
                return v if isinstance(v, dict) else {}
        except Exception:
            return {}

    def _save(self):
        tmp = self.cfg_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.st, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.cfg_path)

    @property
    def port(self):
        return int(self.st["port"])

    @property
    def base(self):
        return f"http://127.0.0.1:{self.port}"

    @property
    def ws_url(self):
        return f"ws://127.0.0.1:{self.port}/ws/device"

    @property
    def admin_token(self):
        return self.st["adminToken"]

    # ---------- HTTP к своему ядру ----------
    def _req(self, method, path, body=None, auth=True, timeout=5):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        h = {"Content-Type": "application/json"} if data else {}
        if auth:
            h["Authorization"] = "Bearer " + self.admin_token
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else None

    def healthy(self):
        try:
            return bool(self._req("GET", "/healthz", auth=False, timeout=1).get("ok"))
        except Exception:
            return False

    def ours(self):
        """На порту наше ядро (принимает наш пароль)?"""
        try:
            self._req("GET", "/api/devices", timeout=2)
            return True
        except Exception:
            return False

    # ---------- провайдер по умолчанию ----------
    def seed_providers(self):
        """Только при первом запуске: локальная модель через Ollama. Дальше пользователь меняет в «ИИ-провайдерах»."""
        os.makedirs(self.data, exist_ok=True)
        f = os.path.join(self.data, "providers.json")
        if os.path.exists(f):
            return False
        prov = [{"id": "local", "name": "Светлана локально (Ollama)", "preset": "ollama", "model": self.st["model"],
                 "capabilities": ["chat", "tools", "vision"], "timeoutMs": 300000}]
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(prov, fh, ensure_ascii=False, indent=1)
        return True

    # ---------- запуск ----------
    def env(self):
        e = dict(os.environ)
        e.update({"HOST": "127.0.0.1", "PORT": str(self.port), "SVETLANA_DATA_DIR": self.data,
                  "SVETLANA_WORKSPACE": os.path.join(self.data, "workspace"), "SVETLANA_ADMIN_TOKEN": self.admin_token,
                  "SVETLANA_SECRET": self.st["secret"], "SVETLANA_MAX_STEPS": str(self.st.get("maxSteps", 40))})
        return e

    def start(self, wait=25):
        if self.healthy() and self.ours():
            self.log(f"[ядро] уже работает на {self.base}")
            return True
        if not _port_free(self.port):
            self.st["port"] = _free_port()
            self._save()
            self.log(f"[ядро] порт занят другой программой, беру {self.port}")
        node, core = find_node(), find_core()
        if not node:
            raise RuntimeError("не найден node.exe (переустановите Светлану)")
        if not core:
            raise RuntimeError("не найдена папка ядра (переустановите Светлану)")
        self.seed_providers()
        logf = open(os.path.join(self.dir, "core.log"), "a", encoding="utf-8")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        if os.path.isfile(os.path.join(core, "scripts", "restore-assets.mjs")):
            subprocess.run([node, os.path.join("scripts", "restore-assets.mjs")], cwd=core, env=self.env(), stdout=logf, stderr=logf, creationflags=flags, timeout=60)
        self.proc = subprocess.Popen([node, "server.mjs"], cwd=core, env=self.env(), stdout=logf, stderr=logf, creationflags=flags)
        t0 = time.time()
        while time.time() - t0 < wait:
            if self.proc.poll() is not None:
                raise RuntimeError(f"ядро остановилось при запуске (код {self.proc.returncode}), подробности в core.log")
            if self.healthy():
                self.log(f"[ядро] запущено на {self.base}")
                return True
            time.sleep(0.3)
        self.stop()
        raise RuntimeError("ядро не ответило за отведённое время, подробности в core.log")

    def ensure_device(self, name=None):
        """Ключ устройства для этого компьютера: берём сохранённый, если ядро его ещё знает, иначе выдаём новый."""
        known = {d.get("id") for d in (self._req("GET", "/api/devices") or [])}
        if self.st.get("deviceToken") and self.st.get("deviceId") in known:
            return self.st["deviceToken"]
        r = self._req("POST", "/api/devices/pair", {"name": (name or socket.gethostname() or "Этот компьютер")[:60], "platform": "windows" if sys.platform == "win32" else "linux"})
        tok = r.get("token", "")
        if not tok.startswith("dev_"):
            raise RuntimeError("ядро не выдало ключ устройства")
        self.st.update(deviceToken=tok, deviceId=r.get("deviceId"))
        self._save()
        return tok

    def stop(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(5)
            except Exception:
                p.kill()


def set_local_model(core, model):
    """Сменить локальную модель (провайдер «local») в уже запущенном ядре."""
    core.st["model"] = model
    core._save()
    core._req("POST", "/api/providers", {"id": "local", "name": "Светлана локально (Ollama)", "preset": "ollama", "model": model,
                                         "capabilities": ["chat", "tools", "vision"], "timeoutMs": 300000})
