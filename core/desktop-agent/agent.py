#!/usr/bin/env python3
"""Светлана — «руки, глаза и уши» на компьютере (Windows / macOS / Linux).

  pip install -r requirements.txt                 # руки и глаза
  pip install -r requirements-desktop.txt         # + голос и окно (для Windows есть готовый установщик)
  python agent.py --url wss://ваш-домен/ws/device --token dev_...   [--view-only] [--voice] [--no-wake]

Видит любую программу (1С, браузер, Render, Excel…): скриншот + список элементов с текстом и рамками (ui_tree.py).
Подключается К ядру Светланы (исходящее соединение, роутер настраивать не нужно), по запросу присылает скриншот
и выполняет команды мыши/клавиатуры. Безопасность: каждое действие подтверждает владелец в приложении Светланы;
--view-only — только просмотр; увести мышь в левый верхний угол экрана = аварийная остановка (pyautogui FAILSAFE).
--voice — голосовое управление: «Светлана, …» (распознавание офлайн, быстрые команды без интернета, остальное — мозгу).
"""
import argparse, base64, hashlib, io, json, os, platform, subprocess, sys, threading, time, uuid

import mss
import pyautogui
import websocket
from PIL import Image

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05


class Eyes:
    """Основной монитор. Координаты скриншота → логические координаты pyautogui (HiDPI/Retina и смещение монитора учтены)."""
    def __init__(self):
        self.geom = None  # (left, top, logical_w, logical_h, img_w, img_h)
        self.last_hash = None
        self.last_image = None  # последний кадр (для распознавания текста)

    def capture(self, max_side=1280, fmt="jpeg"):
        max_side = max(64, min(4096, int(max_side)))
        with mss.mss() as s:
            mon = s.monitors[1]
            raw = s.grab(mon)
            img = Image.frombytes("RGB", raw.size, raw.rgb)
        k = min(1.0, max_side / max(img.size))
        if k < 1:
            img = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))))
        lw, lh = pyautogui.size()  # логический размер основного экрана
        # (смещение монитора в физ. пикселях, физ. размер, логический размер, размер скриншота)
        self.geom = (mon["left"], mon["top"], raw.size[0], raw.size[1], lw, lh, img.width, img.height)
        buf = io.BytesIO()
        img.save(buf, "JPEG" if fmt == "jpeg" else "PNG", quality=80)
        data = buf.getvalue()
        self.last_hash = hashlib.sha1(img.tobytes()).hexdigest()  # по пикселям, не по кодировке
        self.last_image = img
        return {"image": base64.b64encode(data).decode(), "mime": "image/jpeg" if fmt == "jpeg" else "image/png", "width": img.width, "height": img.height, "app": active_window()}

    def changed(self):
        before = self.last_hash
        time.sleep(0.6)
        self.capture()
        return before is not None and self.last_hash != before


def active_window():
    try:
        if sys.platform == "win32":
            import ctypes
            h = ctypes.windll.user32.GetForegroundWindow()
            n = ctypes.windll.user32.GetWindowTextLengthW(h)
            b = ctypes.create_unicode_buffer(n + 1)
            ctypes.windll.user32.GetWindowTextW(h, b, n + 1)
            return b.value
        if sys.platform == "darwin":
            return subprocess.run(["osascript", "-e", 'tell application "System Events" to get name of first process whose frontmost is true'], capture_output=True, text=True, timeout=3).stdout.strip()
        return subprocess.run(["xdotool", "getactivewindow", "getwindowname"], capture_output=True, text=True, timeout=3).stdout.strip()
    except Exception:
        return None


_apps_cache = {"t": 0.0, "v": []}


def list_apps(max_age=60):
    """Приложения, которые реально можно запустить: ярлыки «Пуск» (Windows), /Applications (macOS), .desktop (Linux)."""
    if time.time() - _apps_cache["t"] < max_age and _apps_cache["v"]:
        return _apps_cache["v"]
    out = {}
    if sys.platform == "win32":
        import glob
        for root in (os.path.expandvars(r"%ProgramData%\Microsoft\Windows\Start Menu\Programs"), os.path.expandvars(r"%AppData%\Microsoft\Windows\Start Menu\Programs")):
            for f in glob.glob(os.path.join(root, "**", "*.lnk"), recursive=True):
                out[f] = os.path.splitext(os.path.basename(f))[0]
    elif sys.platform == "darwin":
        for d in ("/Applications", os.path.expanduser("~/Applications"), "/System/Applications"):
            if os.path.isdir(d):
                for n in os.listdir(d):
                    if n.endswith(".app"):
                        out[os.path.join(d, n)] = n[:-4]
    else:
        import configparser, glob
        for d in ("/usr/share/applications", os.path.expanduser("~/.local/share/applications"), "/var/lib/flatpak/exports/share/applications"):
            for f in glob.glob(os.path.join(d, "*.desktop")):
                c = configparser.ConfigParser(interpolation=None, strict=False)
                try:
                    c.read(f, encoding="utf-8")
                    e = c["Desktop Entry"]
                    if e.get("NoDisplay", "false").lower() != "true" and e.get("Name"):
                        out[f] = e.get("Name[ru]") or e.get("Name")
                except Exception:
                    pass
    v = sorted(({"id": k, "name": v} for k, v in out.items()), key=lambda x: x["name"].lower())[:500]
    _apps_cache.update(t=time.time(), v=v)
    return v


def launch(app):
    """app — id из apps.list (путь к ярлыку/.app/.desktop) или имя из списка."""
    known = {a["id"]: a for a in list_apps()}
    if app not in known:
        match = next((a for a in known.values() if a["name"].lower() == str(app).lower()), None)
        if not match:
            raise RuntimeError(f"приложение «{app}» не найдено — сначала apps.list")
        app = match["id"]
    if sys.platform == "win32":
        os.startfile(app)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", app])
    else:
        subprocess.Popen(["gtk-launch", os.path.basename(app)])


def type_text(text):
    # pyautogui.write не печатает кириллицу → вставляем через буфер обмена
    try:
        import pyperclip
        old = pyperclip.paste()
    except Exception:
        pyautogui.write(text, interval=0.01)  # без буфера обмена — только латиница
        return
    try:
        pyperclip.copy(text)
        pyautogui.hotkey("command" if sys.platform == "darwin" else "ctrl", "v")
        time.sleep(0.25)
    finally:
        pyperclip.copy(old)  # возвращаем буфер, даже если ввод прервался


KEYS = {"enter": "enter", "esc": "esc", "tab": "tab", "backspace": "backspace", "delete": "delete", "up": "up", "down": "down", "left": "left", "right": "right", "space": "space", "home": "home", "end": "end", "pageup": "pageup", "pagedown": "pagedown"}


class Agent:
    def __init__(self, url, token, view_only, voice=False, log=None, on_state=None):
        self.url, self.token, self.view_only, self.voice = url, token, view_only, voice
        self.eyes = Eyes()
        self.lock = threading.Lock()
        self.log = log or (lambda m: print(m, flush=True))
        self.on_state = on_state or (lambda s: None)
        self.ws = None
        self.connected = False
        self.waiting = {}  # reqId → [Event, ответ]
        self._stop = threading.Event()

    def caps(self):
        return ["screen", "apps", "tree"] + ([] if self.view_only else ["control", "clipboard"]) + (["voice"] if self.voice else [])

    def to_screen(self, x, y):
        geom = self.eyes.geom
        if not geom:
            raise RuntimeError("сначала нужен скриншот (screen.capture), чтобы знать масштаб")
        left, top, pw, ph, lw, lh, iw, ih = geom
        kx, ky = lw / pw, lh / ph  # физические → логические (HiDPI)
        X = round((float(x) * pw / iw + left) * kx)
        Y = round((float(y) * ph / ih + top) * ky)
        return max(0, min(lw - 1, X)) if left == 0 else X, max(0, min(lh - 1, Y)) if top == 0 else Y

    def handle(self, method, p):
        with self.lock:  # команды строго по одной: скриншот, клики и буфер обмена не перемешиваются
            return self._handle(method, p)

    def _handle(self, method, p):
        if method == "screen.capture":
            return self.eyes.capture(int(p.get("maxSide", 1280)), p.get("format", "jpeg"))
        if method == "apps.list":
            return list_apps()
        if method == "ui.tree":  # элементы любой программы: UI Automation (Windows) или распознавание текста
            from ui_tree import ui_tree
            return ui_tree(self.eyes)
        if method == "clipboard.get":
            import pyperclip
            return {"text": pyperclip.paste()[:20000]}
        if self.view_only:
            raise RuntimeError("агент запущен в режиме только просмотра")
        if method == "input.tap":
            pyautogui.click(*self.to_screen(p["x"], p["y"]))
        elif method == "input.swipe":
            pyautogui.moveTo(*self.to_screen(p["x"], p["y"]))
            pyautogui.dragTo(*self.to_screen(p["x2"], p["y2"]), duration=0.4)
        elif method == "input.type":
            type_text(str(p.get("text", ""))[:5000])
        elif method == "input.key":
            k = str(p.get("key", "")).lower()
            combo = [KEYS.get(x, x) for x in k.replace(" ", "").split("+") if x]
            if not combo:
                raise RuntimeError("пустая клавиша")
            pyautogui.hotkey(*combo)
        elif method == "app.launch":
            launch(str(p["app"]))
        elif method == "nav.back":
            pyautogui.hotkey("alt", "left") if sys.platform != "darwin" else pyautogui.hotkey("command", "[")
        elif method == "nav.home":
            pyautogui.hotkey("win", "d") if sys.platform == "win32" else pyautogui.hotkey("command", "f3") if sys.platform == "darwin" else pyautogui.hotkey("super")
        elif method == "clipboard.set":
            import pyperclip
            pyperclip.copy(str(p.get("text", ""))[:20000])
        else:
            raise RuntimeError("команда не поддерживается на компьютере")
        self.log(f"[Светлана] выполнено: {method} {json.dumps(p, ensure_ascii=False)[:120]}")
        return {"executed": True, "verified": self.eyes.changed()}

    # ---------- голос → ядро ----------
    def request(self, payload, timeout=180):
        """Отправить фразу/подтверждение в ядро и дождаться ответа (мозг может думать до пары минут)."""
        ws = self.ws
        if not ws or not self.connected:
            raise RuntimeError("нет связи с ядром Светланы")
        rid = uuid.uuid4().hex
        slot = [threading.Event(), None]
        self.waiting[rid] = slot
        try:
            ws.send(json.dumps({**payload, "reqId": rid}, ensure_ascii=False))
            if not slot[0].wait(timeout):
                raise RuntimeError("ядро не ответило вовремя")
            return slot[1]
        finally:
            self.waiting.pop(rid, None)

    def ask(self, text, reset=False):
        return self.request({"type": "say", "text": text, "reset": bool(reset)})

    def confirm(self, approve):
        return self.request({"type": "confirm", "approve": bool(approve)}, timeout=300)

    def on_message(self, ws, raw):
        try:
            m = json.loads(raw)
            if not isinstance(m, dict):
                return
        except ValueError:
            return
        if m.get("type") == "reply":
            slot = self.waiting.get(m.get("reqId"))
            if slot:
                slot[1] = m
                slot[0].set()
            return
        if "id" not in m:
            return
        def work():
            try:
                ws.send(json.dumps({"id": m["id"], "result": self.handle(m.get("method"), m.get("params") or {})}))
            except pyautogui.FailSafeException:
                ws.send(json.dumps({"id": m["id"], "error": "аварийная остановка: мышь в углу экрана"}))
            except Exception as e:
                ws.send(json.dumps({"id": m["id"], "error": str(e)[:300]}))
        threading.Thread(target=work, daemon=True).start()

    def on_open(self, ws):
        w, h = pyautogui.size()
        ws.send(json.dumps({"type": "hello", "platform": {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux"), "name": platform.node(), "capabilities": self.caps(), "screen": {"width": w, "height": h}}))
        self.ws, self.connected = ws, True
        self.on_state("online")
        self.log(f"[Светлана] подключено. Доступ: {', '.join(self.caps())}.")

    def on_close(self, *_a):
        self.connected = False
        self.on_state("offline")
        for slot in list(self.waiting.values()):
            slot[1] = {"error": "связь с ядром прервалась"}
            slot[0].set()

    def run(self):
        while not self._stop.is_set():
            self.on_state("connecting")
            ws = websocket.WebSocketApp(self.url, subprotocols=[self.token], on_open=self.on_open, on_message=self.on_message, on_close=self.on_close,
                                        on_error=lambda _w, e: self.log(f"[Светлана] ошибка связи: {e}"))
            self.ws = ws
            ws.run_forever(ping_interval=30, ping_timeout=10)
            self.on_close()
            if self._stop.is_set():
                break
            self.log("[Светлана] соединение потеряно, повтор через 5 с")
            self._stop.wait(5)

    def stop(self):
        self._stop.set()
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass


def start_voice(agent, require_wake=True, owner="Павел", log=None):
    """Голосовой режим: уши (Vosk) + быстрые команды + мозг через ядро. Возвращает (loop, listener, speaker)."""
    import commands, voice
    log = log or agent.log
    model = voice.find_model()
    if not model:
        log("[голос] модель распознавания не найдена — скачиваю один раз (≈45 МБ)…")
        model = voice.download_model(lambda p: None)
    speaker = voice.Speaker(log=log)
    loop = None
    acts = commands.SysActions(list_apps=list_apps, launch=launch)
    cmds = commands.Commands(acts, notify=lambda text: loop.say(text, followup=False), owner=owner)
    loop = voice.VoiceLoop(cmds, ask=agent.ask, confirm=agent.confirm, speak=speaker.say, stop_speaking=speaker.stop,
                           online=lambda: agent.connected, require_wake=require_wake, log=log)
    listener = voice.Listener(model, loop.process, is_muted=speaker.speaking.is_set, log=log)
    listener.start()
    return loop, listener, speaker


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--token", default=os.environ.get("SVETLANA_DEVICE_TOKEN"))
    ap.add_argument("--view-only", action="store_true")
    ap.add_argument("--voice", action="store_true", help="голосовое управление «Светлана, …»")
    ap.add_argument("--no-wake", action="store_true", help="реагировать на любую фразу без слова «Светлана»")
    a = ap.parse_args()
    if not a.token:
        sys.exit("нужен --token (выдаётся во вкладке «Устройства»)")
    ag = Agent(a.url, a.token, a.view_only, voice=a.voice)
    if a.voice:
        start_voice(ag, require_wake=not a.no_wake)
    ag.run()
