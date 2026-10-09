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

import models

DEFAULT_PORT = 8787
DEFAULT_MODEL = "qwen3-vl:8b"  # Ollama: видит картинки и умеет вызывать инструменты; можно сменить в окне
OLLAMA = models.OLLAMA


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


def default_workspace():
    """Папка проектов, которые Светлана пишет и запускает: Документы\\Svetlana Projects (видна в Проводнике)."""
    return os.path.join(os.path.expanduser("~"), "Documents", "Svetlana Projects")


def _kill_with_parent(proc):
    """Windows: ядро (node.exe) в Job Object «убить при закрытии» — если Светлану закроют, обновят или она упадёт,
    ядро уйдёт вместе с ней и не займёт порт со старым паролем. Возвращает дескриптор (держать открытым!) или None."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
        k32.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
        k32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
        k32.CloseHandle.argtypes = (wintypes.HANDLE,)

        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                        ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

        class EXT(ctypes.Structure):
            _fields_ = [("Basic", BASIC), ("Io", IO), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        job = k32.CreateJobObjectW(None, None)
        if not job:
            return None
        info = EXT()
        info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) or \
                not k32.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle))):  # 9 = JobObjectExtendedLimitInformation
            k32.CloseHandle(job)  # не вышло — дескриптор не теряем
            return None
        return job
    except Exception:
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


def ollama_status(model=None, base=None, timeout=2):
    """(запущена ли Ollama, скачана ли нужная модель, список моделей)."""
    names = models.installed(timeout=timeout)
    if names is None:
        return False, False, []
    return True, models.has_model(model, names), names


def provider(model, caps=None):
    return {"id": "local", "name": "Светлана локально (Ollama)", "preset": "ollama", "model": model,
            "capabilities": caps or models.capabilities(model), "timeoutMs": 300000}


class LocalCore:
    def __init__(self, data_dir=None, port=None, model=None, log=print):
        self.dir = data_dir or _user_dir()
        self.cfg_path = os.path.join(self.dir, "local-core.json")
        self.data = os.path.join(self.dir, "core-data")
        self.log = log
        self.proc = None
        self._job = None
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
    def workspace(self):
        w = self.st.get("workspace") or default_workspace()
        os.makedirs(w, exist_ok=True)
        return w

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
        prov = [provider(self.st["model"])]
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(prov, fh, ensure_ascii=False, indent=1)
        return True

    # ---------- запуск ----------
    def env(self):
        e = dict(os.environ)
        e.update({"HOST": "127.0.0.1", "PORT": str(self.port), "SVETLANA_DATA_DIR": self.data,
                  "SVETLANA_WORKSPACE": self.workspace, "SVETLANA_ADMIN_TOKEN": self.admin_token,
                  "SVETLANA_SECRET": self.st["secret"], "SVETLANA_MAX_STEPS": str(self.st.get("maxSteps", 40)),
                  # свой компьютер: Светлана-разработчица запускает npm/python/git в папке проектов, каждую команду — после подтверждения
                  "SVETLANA_ALLOW_HOST_EXEC": "1", "SVETLANA_MAX_TOKENS": "8000"})
        e.pop("SVETLANA_RUNNER_SOCKET", None)
        node = find_node()
        if node:  # встроенный node + npm/npx из установщика доступны командам Светланы без отдельной установки Node.js
            e["PATH"] = os.path.dirname(node) + os.pathsep + e.get("PATH", "")
        return e

    def start(self, wait=25):
        if self.healthy() and self.ours():
            self.log(f"[ядро] уже работает на {self.base}")
            return True
        if not _port_free(self.port):
            self.st["port"] = _free_port()
            self._save()
            self.log(f"[ядро] порт занят другой программой, беру {self.port}")
        if self._job or self.proc:  # прошлое ядро упало: добиваем его осиротевших потомков, прежде чем запускать новое
            self._kill_tree(self.proc)
            self.proc = None
        node, core = find_node(), find_core()
        if not node:
            raise RuntimeError("не найден node.exe (переустановите Светлану)")
        if not core:
            raise RuntimeError("не найдена папка ядра (переустановите Светлану)")
        self.seed_providers()
        logf = open(os.path.join(self.dir, "core.log"), "a", encoding="utf-8")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        if os.path.isfile(os.path.join(core, "scripts", "restore-assets.mjs")):
            r = subprocess.run([node, os.path.join("scripts", "restore-assets.mjs")], cwd=core, env=self.env(), stdout=logf, stderr=logf, creationflags=flags, timeout=60)
            if r.returncode != 0:
                raise RuntimeError("не удалось подготовить картинки веб-приложения, подробности в core.log")
        self.proc = subprocess.Popen([node, "server.mjs"], cwd=core, env=self.env(), stdout=logf, stderr=logf, creationflags=flags)
        self._job = _kill_with_parent(self.proc)
        if sys.platform == "win32" and not self._job:
            self.log("[ядро] ⚠ не удалось привязать ядро к Светлане: если ядро упадёт, запущенные проекты придётся закрыть вручную")
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

    def _kill_tree(self, p):
        """Ядро вместе со всеми его потомками (dev-серверы проектов): Job Object, иначе taskkill /T."""
        job, self._job = self._job, None
        if sys.platform != "win32":
            return
        if job:
            try:
                import ctypes
                k32 = ctypes.WinDLL("kernel32")
                k32.TerminateJobObject.argtypes = (ctypes.c_void_p, ctypes.c_uint)
                k32.CloseHandle.argtypes = (ctypes.c_void_p,)
                k32.TerminateJobObject(job, 1)
                k32.CloseHandle(job)
                return
            except Exception:
                pass
        if p and p.poll() is None:  # без Job Object дерево можно погасить, только пока жив сам родитель
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def stop(self):
        p, self.proc = self.proc, None
        self._kill_tree(p)
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(5)
            except Exception:
                p.kill()


def sync_model(core, model, refresh=False):
    """При каждом старте: провайдер «local» в ядре должен смотреть на модель из окна (даже если её сменили, пока ядро не работало).
    refresh=True (Ollama отвечает) — заодно пересчитать, видит ли модель экран."""
    cur = next((p for p in (core._req("GET", "/api/providers") or []) if p.get("id") == "local"), None)
    if cur is None or cur.get("model") != model or (refresh and sorted(cur.get("capabilities") or []) != sorted(models.capabilities(model))):
        return set_local_model(core, model)
    return cur.get("capabilities") or []


def set_local_model(core, model, caps=None):
    """Сменить локальную модель (провайдер «local») в уже запущенном ядре. Возвращает возможности модели."""
    p = provider(model, caps)
    core.st["model"] = model
    core._save()
    core._req("POST", "/api/providers", p)
    return p["capabilities"]
