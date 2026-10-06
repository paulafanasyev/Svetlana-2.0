"""Светлана для Windows: окно + значок в трее. Внутри — тот же agent.py (руки и глаза) и voice.py (уши и голос).

Первый запуск: вставьте адрес и ключ из вкладки «Устройства» → «Сохранить и подключить». Дальше Светлана
живёт в трее, стартует вместе с Windows (если включено) и отзывается на «Светлана, …».
"""
import json
import logging
import os
import queue
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

import voice
from version import VERSION

APP = "Светлана"
CFG_PATH = os.path.join(voice.user_dir(), "config.json")
LOG_PATH = os.path.join(voice.user_dir(), "svetlana.log")
DEFAULTS = {"url": "", "token": "", "voice": True, "wake": True, "view_only": False, "autostart": True, "owner": "Павел"}

logging.basicConfig(filename=LOG_PATH, level=logging.INFO, format="%(asctime)s %(message)s", encoding="utf-8")
if getattr(sys, "frozen", False) and sys.stdout is None:  # окно без консоли: print → в лог
    sys.stdout = sys.stderr = open(LOG_PATH, "a", encoding="utf-8", buffering=1)


def load_cfg():
    try:
        with open(CFG_PATH, encoding="utf-8") as f:
            return {**DEFAULTS, **json.load(f)}
    except Exception:
        return dict(DEFAULTS)


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
        self.tray = None
        self.root = tk.Tk()
        self.root.title(f"{APP} {VERSION}")
        self.root.geometry("560x600")
        self.root.minsize(480, 520)
        try:
            self.root.iconbitmap(os.path.join(voice.app_dir(), "svetlana.ico"))
        except Exception:
            pass
        self.root.protocol("WM_DELETE_WINDOW", self.hide)
        self.build()
        self.root.after(100, self.pump)
        self.start_tray()
        if self.cfg["url"] and self.cfg["token"]:
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

        box = ttk.LabelFrame(f, text="Подключение к ядру")
        box.pack(fill="x", **pad)
        ttk.Label(box, text="Адрес и ключ возьмите в приложении Светланы: вкладка «Устройства» → «Подключить», платформа Windows.", wraplength=500, justify="left").pack(anchor="w", padx=8, pady=(6, 2))
        self.url = tk.StringVar(value=self.cfg["url"])
        self.token = tk.StringVar(value=self.cfg["token"])
        g = ttk.Frame(box)
        g.pack(fill="x", padx=8, pady=(0, 8))
        ttk.Label(g, text="Адрес:").grid(row=0, column=0, sticky="w")
        ttk.Entry(g, textvariable=self.url).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Label(g, text="Ключ:").grid(row=1, column=0, sticky="w")
        ttk.Entry(g, textvariable=self.token, show="•").grid(row=1, column=1, sticky="ew", padx=4, pady=2)
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
        ttk.Button(btns, text="🎤 Слушать сейчас", command=self.listen_now).pack(side="left", padx=6)
        ttk.Button(btns, text="Команды", command=self.show_help).pack(side="left")

        ttk.Label(f, text="Журнал:").pack(anchor="w", padx=12)
        self.text = tk.Text(f, height=12, wrap="word", state="disabled", font=("Consolas", 9))
        self.text.pack(fill="both", expand=True, padx=12, pady=(0, 6))
        ttk.Label(f, text="Аварийная остановка мыши: увести курсор в левый верхний угол экрана.", foreground="#666").pack(anchor="w", padx=12, pady=(0, 8))

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
        url, token = self.url.get().strip(), self.token.get().strip()
        if not (url.startswith("ws://") or url.startswith("wss://")) or not token.startswith("dev_"):
            return messagebox.showerror(APP, "Нужны адрес (wss://…/ws/device) и ключ устройства (dev_…) из вкладки «Устройства».")
        self.cfg.update(url=url, token=token, voice=self.v_voice.get(), wake=self.v_wake.get(), view_only=self.v_view.get(), autostart=self.v_auto.get())
        save_cfg(self.cfg)
        try:
            set_autostart(self.cfg["autostart"])
        except Exception as e:
            self.log(f"Автозапуск не настроился: {e}")
        self.connect()

    # ---------- работа ----------
    def connect(self):
        import agent as ag
        if self.agent:
            self.agent.stop()
        if self.listener:
            self.listener.stop()
            self.listener = None
        c = self.cfg
        self.agent = ag.Agent(c["url"], c["token"], c["view_only"], voice=c["voice"], log=self.log, on_state=self.set_state)
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

    def listen_now(self):
        if self.loop:
            self.loop.wake_now()
        else:
            self.log("Голосовое управление выключено в настройках.")

    def show_help(self):
        messagebox.showinfo(APP, "Скажите «Светлана» и команду.\n\nБез интернета, мгновенно:\n• который час / какое сегодня число\n• открой калькулятор, Excel, Telegram, ютуб, почту\n"
                                 "• громче / тише / без звука (громче на 20)\n• пауза, следующий трек\n• таймер на 5 минут\n• сделай скриншот\n• заряд батареи\n"
                                 "• сверни все окна, закрой окно, заблокируй компьютер\n• загугли …\n\nВсё остальное думает мозг Светланы:\n«Светлана, сколько я заработал в сентябре?»\n"
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
