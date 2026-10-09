"""Светлана для Windows: окно + значок в трее. Внутри — тот же agent.py (руки и глаза) и voice.py (уши и голос).

Режимы:
  • «На этом компьютере» (по умолчанию) — ядро Светланы запускается здесь же (local_core.py), ИИ — локальный через Ollama,
    ключ устройства выдаётся автоматически. Ничего копировать не нужно, интернет не обязателен.
  • «Свой сервер» — как раньше: адрес wss://…/ws/device и ключ dev_… из вкладки «Устройства».
"""
import json
import logging
import os
import queue
import sys
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import messagebox, ttk

import voice
from version import VERSION

APP = "Светлана"
CFG_PATH = os.path.join(voice.user_dir(), "config.json")
LOG_PATH = os.path.join(voice.user_dir(), "svetlana.log")
DEFAULTS = {"mode": "local", "local_model": "qwen3-vl:8b", "url": "", "token": "", "voice": True, "wake": True, "view_only": False,
            "autostart": True, "owner": "Павел"}

logging.basicConfig(filename=LOG_PATH, level=logging.INFO, format="%(asctime)s %(message)s", encoding="utf-8")
if getattr(sys, "frozen", False) and sys.stdout is None:  # окно без консоли: print → в лог
    sys.stdout = sys.stderr = open(LOG_PATH, "a", encoding="utf-8", buffering=1)


def load_cfg():
    try:
        with open(CFG_PATH, encoding="utf-8") as f:
            saved = json.load(f)
    except Exception:
        return dict(DEFAULTS)
    c = {**DEFAULTS, **saved}
    if "mode" not in saved:  # конфиг от версии 2.1.0: если сервер уже был настроен — не ломаем
        c["mode"] = "server" if c.get("url") and c.get("token") else "local"
    return c


def save_cfg(cfg):
    tmp = CFG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CFG_PATH)


def set_autostart(on):
    if sys.platform != "win32":
        return
    import winreg
    exe = f'"{sys.executable}" --minimized' if getattr(sys, "frozen", False) else f'"{sys.executable}" "{os.path.abspath(__file__)}" --minimized'
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, "Svetlana", 0, winreg.REG_SZ, exe)
        else:
            try:
                winreg.DeleteValue(k, "Svetlana")
            except FileNotFoundError:
                pass


def single_instance():
    if sys.platform != "win32":
        return True
    import ctypes
    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\SvetlanaDesktopAgent")
    return ctypes.windll.kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


class App:
    def __init__(self, minimized=False):
        self.cfg = load_cfg()
        self.ui = queue.Queue()
        self.agent = self.loop = self.listener = self.speaker = None
        self.core = None
        self.gen = 0  # номер подключения: устаревший фоновый запуск ядра не перехватывает новое подключение
        self.conn_lock = threading.Lock()  # connect() и запуск агента из фонового потока не пересекаются
        self.tray = None
        self.root = tk.Tk()
        self.root.title(f"{APP} {VERSION}")
        self.root.geometry("580x680")
        self.root.minsize(500, 580)
        try:
            self.root.iconbitmap(os.path.join(voice.app_dir(), "svetlana.ico"))
        except Exception:
            pass
        self.root.protocol("WM_DELETE_WINDOW", self.hide)
        self.build()
        self.root.after(100, self.pump)
        self.start_tray()
        if self.cfg["mode"] == "local" or (self.cfg["url"] and self.cfg["token"]):
            self.connect()
            if minimized:
                self.root.withdraw()
        else:
            self.log("Вставьте адрес и ключ из вкладки «Устройства» в приложении Светланы и нажмите «Сохранить и подключить».")

    # ---------- окно ----------
    def build(self):
        pad = {"padx": 12, "pady": 4}
        f = ttk.Frame(self.root)
        f.pack(fill="both", expand=True)
        head = ttk.Frame(f)
        head.pack(fill="x", **pad)
        ttk.Label(head, text="Светлана", font=("Segoe UI", 18, "bold")).pack(side="left")
        self.status = ttk.Label(head, text="⚪ не подключена", font=("Segoe UI", 10))
        self.status.pack(side="right")

        self.mode = tk.StringVar(value=self.cfg["mode"])
        mbox = ttk.LabelFrame(f, text="Где работает мозг Светланы")
        mbox.pack(fill="x", **pad)
        ttk.Radiobutton(mbox, text="На этом компьютере (всё локально, без облака)", value="local", variable=self.mode, command=self.on_mode).pack(anchor="w", padx=8, pady=(6, 0))
        lm = ttk.Frame(mbox)
        lm.pack(fill="x", padx=28, pady=2)
        ttk.Label(lm, text="Модель Ollama:").pack(side="left")
        self.model = tk.StringVar(value=self.cfg["local_model"])
        self.model_entry = ttk.Entry(lm, textvariable=self.model, width=24)
        self.model_entry.pack(side="left", padx=4)
        ttk.Radiobutton(mbox, text="Свой сервер (VPS) по адресу и ключу", value="server", variable=self.mode, command=self.on_mode).pack(anchor="w", padx=8, pady=(6, 0))
        self.url = tk.StringVar(value=self.cfg["url"])
        self.token = tk.StringVar(value=self.cfg["token"])
        g = ttk.Frame(mbox)
        g.pack(fill="x", padx=28, pady=(0, 8))
        ttk.Label(g, text="Адрес:").grid(row=0, column=0, sticky="w")
        self.url_entry = ttk.Entry(g, textvariable=self.url)
        self.url_entry.grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Label(g, text="Ключ:").grid(row=1, column=0, sticky="w")
        self.token_entry = ttk.Entry(g, textvariable=self.token, show="•")
        self.token_entry.grid(row=1, column=1, sticky="ew", padx=4, pady=2)
        g.columnconfigure(1, weight=1)

        opt = ttk.LabelFrame(f, text="Настройки")
        opt.pack(fill="x", **pad)
        self.v_voice = tk.BooleanVar(value=self.cfg["voice"])
        self.v_wake = tk.BooleanVar(value=self.cfg["wake"])
        self.v_view = tk.BooleanVar(value=self.cfg["view_only"])
        self.v_auto = tk.BooleanVar(value=self.cfg["autostart"])
        for var, text in ((self.v_voice, "Голосовое управление (микрофон, распознавание на компьютере)"),
                          (self.v_wake, "Отзываться только на «Светлана, …»"),
                          (self.v_view, "Только смотреть экран (без кликов и ввода)"),
                          (self.v_auto, "Запускать вместе с Windows")):
            ttk.Checkbutton(opt, text=text, variable=var).pack(anchor="w", padx=8, pady=1)

        btns = ttk.Frame(f)
        btns.pack(fill="x", **pad)
        ttk.Button(btns, text="Сохранить и подключить", command=self.save_connect).pack(side="left")
        ttk.Button(btns, text="💬 Открыть чат", command=self.open_chat).pack(side="left", padx=6)
        ttk.Button(btns, text="🎤 Слушать", command=self.listen_now).pack(side="left")
        ttk.Button(btns, text="Команды", command=self.show_help).pack(side="left", padx=6)

        ttk.Label(f, text="Журнал:").pack(anchor="w", padx=12)
        self.text = tk.Text(f, height=12, wrap="word", state="disabled", font=("Consolas", 9))
        self.text.pack(fill="both", expand=True, padx=12, pady=(0, 6))
        ttk.Label(f, text="Аварийная остановка мыши: увести курсор в левый верхний угол экрана.", foreground="#666").pack(anchor="w", padx=12, pady=(0, 8))
        self.on_mode()

    def on_mode(self):
        local = self.mode.get() == "local"
        self.model_entry.configure(state="normal" if local else "disabled")
        for e in (self.url_entry, self.token_entry):
            e.configure(state="disabled" if local else "normal")

    def log(self, msg):
        logging.info(msg)
        self.ui.put(("log", msg))

    def set_state(self, s):
        self.ui.put(("state", s))

    def pump(self):
        try:
            while True:
                kind, v = self.ui.get_nowait()
                if kind == "log":
                    self.text.configure(state="normal")
                    self.text.insert("end", time.strftime("%H:%M:%S ") + v + "\n")
                    self.text.see("end")
                    if int(self.text.index("end-1c").split(".")[0]) > 600:
                        self.text.delete("1.0", "100.0")
                    self.text.configure(state="disabled")
                elif kind == "state":
                    self.status.configure(text={"online": "🟢 на связи", "connecting": "🟡 подключаюсь…", "offline": "🔴 нет связи"}.get(v, v))
                    if self.tray:
                        self.tray.title = f"Светлана: {'на связи' if v == 'online' else 'нет связи'}"
                elif kind == "show":
                    self.show()
                elif kind == "listen":
                    self.listen_now()
                elif kind == "quit":
                    self.quit()
                    return
        except queue.Empty:
            pass
        self.root.after(150, self.pump)

    def save_connect(self):
        mode = self.mode.get()
        url, token = self.url.get().strip(), self.token.get().strip()
        if mode == "server" and (not (url.startswith("ws://") or url.startswith("wss://")) or not token.startswith("dev_")):
            return messagebox.showerror(APP, "Нужны адрес (wss://…/ws/device) и ключ устройства (dev_…) из вкладки «Устройства».")
        model = self.model.get().strip() or DEFAULTS["local_model"]
        model_changed = model != self.cfg.get("local_model")
        self.cfg.update(mode=mode, local_model=model, url=url, token=token, voice=self.v_voice.get(), wake=self.v_wake.get(),
                        view_only=self.v_view.get(), autostart=self.v_auto.get())
        save_cfg(self.cfg)
        try:
            set_autostart(self.cfg["autostart"])
        except Exception as e:
            self.log(f"Автозапуск не настроился: {e}")
        if mode == "local" and model_changed and self.core and self.core.healthy():
            try:
                import local_core
                local_core.set_local_model(self.core, model)
                self.log(f"Локальная модель: {model}")
            except Exception as e:
                self.log(f"Не удалось сменить модель: {e}")
        self.connect()

    # ---------- работа ----------
    def connect(self):
        with self.conn_lock:
            self._connect()

    def _connect(self):
        if self.agent:
            self.agent.stop()
            self.agent = None
        if self.listener:
            self.listener.stop()
            self.listener = None
        self.gen += 1
        if self.cfg["mode"] == "local":
            self.set_state("connecting")
            threading.Thread(target=self.start_local, args=(self.gen,), daemon=True, name="local-core").start()
        else:
            if self.core:
                self.core.stop()
                self.core = None
            self.start_agent(self.cfg["url"], self.cfg["token"])

    def start_local(self, gen):
        import local_core
        try:
            core = self.core or local_core.LocalCore(model=self.cfg["local_model"], log=self.log)
            self.core = core
            core.start()
            token = core.ensure_device()
        except Exception as e:
            if gen == self.gen:
                self.set_state("offline")
            return self.log(f"Ядро не запустилось: {e}")
        if self._stale(gen, core):  # пока ядро запускалось, пользователь переключился
            return
        running, has, names = local_core.ollama_status(self.cfg["local_model"])
        if not running:
            self.log("Ollama не запущена. Поставьте её с ollama.com и откройте — без неё локальный мозг молчит "
                     "(быстрые голосовые команды работают и так). Или подключите облачный ИИ в чате → «ИИ-провайдеры».")
        elif not has:
            self.log(f"Модель {self.cfg['local_model']} не скачана. Выполните в терминале: ollama pull {self.cfg['local_model']}"
                     + (f"  (сейчас есть: {', '.join(names[:5])})" if names else ""))
        else:
            self.log(f"Локальный мозг готов: {self.cfg['local_model']} через Ollama.")
        with self.conn_lock:  # проверка и запуск агента атомарны относительно connect()
            if self._stale(gen, core):
                return
            self.start_agent(core.ws_url, token)

    def _stale(self, gen, core):
        if gen == self.gen and self.cfg["mode"] == "local":
            return False
        if self.cfg["mode"] != "local":
            core.stop()
            if self.core is core:
                self.core = None
        return True

    def start_agent(self, url, token):
        import agent as ag
        c = self.cfg
        self.agent = ag.Agent(url, token, c["view_only"], voice=c["voice"], log=self.log, on_state=self.set_state)
        threading.Thread(target=self.agent.run, daemon=True, name="agent").start()
        if c["voice"]:
            threading.Thread(target=self.start_voice, daemon=True, name="voice-init").start()
        else:
            self.loop = None

    def start_voice(self):
        import agent as ag
        try:
            if not voice.find_model():
                self.log("Скачиваю модель распознавания речи (≈45 МБ, один раз)…")
                voice.download_model(lambda p: self.ui.put(("state", f"🟡 модель речи {p}%")) if p % 10 == 0 else None)
            if self.speaker:  # повторное подключение — старую озвучку не плодим
                self.speaker.stop()
            self.loop, self.listener, self.speaker = ag.start_voice(self.agent, require_wake=self.cfg["wake"], owner=self.cfg.get("owner") or "", log=self.log)
            self.log("Голос включён. Скажите: «Светлана, который час?»" if self.cfg["wake"] else "Голос включён: говорите без слова «Светлана».")
        except Exception as e:
            self.log(f"Голос не запустился: {e}")

    def open_chat(self):
        if self.cfg["mode"] == "local":
            if not (self.core and self.core.healthy()):
                return self.log("Ядро ещё запускается, попробуйте через пару секунд.")
            try:
                self.root.clipboard_clear()
                self.root.clipboard_append(self.core.admin_token)
                self.log("Пароль входа скопирован: вставьте его (Ctrl+V) на странице входа.")
            except Exception:
                self.log(f"Пароль входа: {self.core.admin_token}")
            webbrowser.open(self.core.base)
        else:
            u = self.cfg["url"].replace("wss://", "https://").replace("ws://", "http://").split("/ws/")[0]
            webbrowser.open(u) if u.startswith("http") else self.log("Сначала укажите адрес сервера.")

    def listen_now(self):
        if self.loop:
            self.loop.wake_now()
        else:
            self.log("Голосовое управление выключено в настройках.")

    def show_help(self):
        messagebox.showinfo(APP, "Скажите «Светлана» и команду.\n\nБез интернета, мгновенно:\n• который час / какое сегодня число\n• открой калькулятор, Excel, Telegram, ютуб, почту\n"
                                 "• громче / тише / без звука (громче на 20)\n• пауза, следующий трек\n• таймер на 5 минут\n• сделай скриншот\n• заряд батареи\n"
                                 "• сверни все окна, закрой окно, заблокируй компьютер\n• загугли …\n\nВсё остальное думает мозг Светланы:\n«Светлана, открой Блокнот и напиши список дел»\n"
                                 "«Светлана, открой 1С и найди счёт Иванова»\n\nСлужебные: «стоп», «повтори», «новый разговор».\nРискованное Светлана переспросит: ответьте «да» или «нет».")

    def show(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def hide(self):
        if self.tray:
            self.root.withdraw()
        else:
            self.quit()

    def quit(self):
        try:
            if self.agent:
                self.agent.stop()
            if self.core:
                self.core.stop()
            if self.tray:
                self.tray.stop()
        finally:
            self.root.destroy()

    def start_tray(self):
        try:
            import pystray
            from PIL import Image
            ico = os.path.join(voice.app_dir(), "svetlana.ico")
            img = Image.open(ico) if os.path.exists(ico) else Image.new("RGB", (64, 64), (124, 92, 232))
            menu = pystray.Menu(pystray.MenuItem("Открыть", lambda *_: self.ui.put(("show", None)), default=True),
                                pystray.MenuItem("🎤 Слушать", lambda *_: self.ui.put(("listen", None))),
                                pystray.MenuItem("Выход", lambda *_: self.ui.put(("quit", None))))
            self.tray = pystray.Icon("svetlana", img, "Светлана", menu)
            self.tray.run_detached()
        except Exception as e:
            self.tray = None
            self.log(f"Значок в трее недоступен: {e}")

    def run(self):
        self.root.mainloop()


def main():
    if not single_instance():
        try:
            r = tk.Tk(); r.withdraw(); messagebox.showinfo(APP, "Светлана уже запущена — она в трее, рядом с часами."); r.destroy()
        finally:
            return
    App(minimized="--minimized" in sys.argv).run()


if __name__ == "__main__":
    main()
