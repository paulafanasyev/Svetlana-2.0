"""Быстрые офлайн-команды Светланы: выполняются прямо на компьютере, мгновенно, без интернета и без ИИ.

Правило: команда срабатывает, только если ВСЯ фраза подходит под шаблон («который час», «открой калькулятор»,
«громче на 10»). Всё остальное («сколько времени займёт отчёт», «открой счёт клиенту») уходит в мозг Светланы.
Действия с системой — через объект SysActions (в тестах подменяется заглушкой).
"""
import datetime
import difflib
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from urllib.parse import quote_plus

WD = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

UNITS = {"ноль": 0, "один": 1, "одна": 1, "одну": 1, "одной": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6,
         "семь": 7, "восемь": 8, "девять": 9, "десять": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13,
         "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18, "девятнадцать": 19}
TENS = {"двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80, "девяносто": 90}

FILLERS_HEAD = {"а", "ну", "так", "скажи", "подскажи", "пожалуйста", "слушай", "можешь", "давай", "быстро"}
FILLERS_TAIL = {"пожалуйста", "плиз", "быстро", "сейчас"}

# Сайты: открываются сразу. Приложения ищутся среди установленных (меню «Пуск»).
SITES = {
    "ютуб": "https://www.youtube.com", "youtube": "https://www.youtube.com", "гугл": "https://www.google.com",
    "яндекс": "https://ya.ru", "почту": "https://e.mail.ru", "почта": "https://e.mail.ru", "вконтакте": "https://vk.com",
    "вк": "https://vk.com", "википедию": "https://ru.wikipedia.org", "википедия": "https://ru.wikipedia.org",
    "госуслуги": "https://www.gosuslugi.ru", "мой налог": "https://lknpd.nalog.ru", "налоговую": "https://lknpd.nalog.ru",
    "кликап": "https://app.clickup.com", "clickup": "https://app.clickup.com", "гитхаб": "https://github.com", "github": "https://github.com",
    "карты": "https://yandex.ru/maps", "погоду": "https://yandex.ru/pogoda", "переводчик": "https://translate.yandex.ru",
}
WEB_FALLBACK = {"телеграм": "https://web.telegram.org", "телеграмм": "https://web.telegram.org", "ватсап": "https://web.whatsapp.com", "вотсап": "https://web.whatsapp.com"}
# Как Vosk пишет названия программ → как они называются в меню «Пуск».
APP_ALIASES = {"эксель": "excel", "ексель": "excel", "ворд": "word", "хром": "chrome", "гугл хром": "chrome", "телеграм": "telegram", "телеграмм": "telegram",
               "зум": "zoom", "скайп": "skype", "стим": "steam", "спотифай": "spotify", "фотошоп": "photoshop", "эдж": "edge",
               "фаерфокс": "firefox", "файрфокс": "firefox", "опера": "opera", "вскод": "visual studio code", "вс код": "visual studio code",
               "визуал студио код": "visual studio code", "один эс": "1с", "один с": "1с", "одинэс": "1с", "аутлук": "outlook",
               "пауэр поинт": "powerpoint", "повер поинт": "powerpoint", "дискорд": "discord", "ватсап": "whatsapp", "вотсап": "whatsapp", "обс": "obs"}
BUILTINS = {"калькулятор": "calc", "блокнот": "notepad", "проводник": "explorer", "диспетчер задач": "taskmgr", "командную строку": "cmd",
            "командная строка": "cmd", "терминал": "cmd", "параметры": "ms-settings:", "настройки": "ms-settings:", "панель управления": "control",
            "paint": "mspaint", "пейнт": "mspaint", "ножницы": "snippingtool"}

TRANSLIT = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя", ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t",
                                                         "u", "f", "h", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))


def normalize(text):
    t = str(text or "").lower().replace("ё", "е")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def strip_fillers(t):
    w = t.split()
    while w and w[0] in FILLERS_HEAD:
        w.pop(0)
    while w and w[-1] in FILLERS_TAIL:
        w.pop()
    return " ".join(w)


def translit(s):
    return "".join(TRANSLIT.get(c, c) for c in s)


def plural(n, one, few, many):
    n = abs(int(n)) % 100
    if 11 <= n <= 19:
        return many
    n %= 10
    return one if n == 1 else few if 2 <= n <= 4 else many


def parse_number(words):
    """('двадцать', 'пять', ...) → (25, 2). Цифры тоже понимает. Нет числа → (None, 0)."""
    if not words:
        return None, 0
    if words[0].isdigit():
        return int(words[0]), 1
    if words[0] in TENS:
        v = TENS[words[0]]
        if len(words) > 1 and words[1] in UNITS and 0 < UNITS[words[1]] < 10:
            return v + UNITS[words[1]], 2
        return v, 1
    if words[0] in UNITS:
        return UNITS[words[0]], 1
    if words[0] == "сто":
        return 100, 1
    return None, 0


def parse_duration(t):
    """«пять минут», «полчаса», «минуту», «1 час 30 минут», «90 секунд» → секунды или None."""
    t = normalize(t)
    if t in ("полчаса", "пол часа"):
        return 1800
    if t in ("полминуты", "пол минуты"):
        return 30
    w = t.split()
    total, i, found = 0, 0, False
    while i < len(w):
        n, used = parse_number(w[i:])
        if used:
            i += used
        elif w[i] in ("полтора", "полторы"):
            n, i = 1.5, i + 1
        else:
            n = 1  # «минуту», «час»
        if i >= len(w):
            return None
        u = w[i]
        if u.startswith("сек"):
            total += n
        elif u.startswith("мин"):
            total += n * 60
        elif u.startswith("час"):
            total += n * 3600
        else:
            return None
        found = True
        i += 1
        if i < len(w) and w[i] == "и":
            i += 1
    return int(total) if found and 0 < total <= 24 * 3600 else None


def say_duration(sec):
    h, rest = divmod(int(sec), 3600)
    m, s = divmod(rest, 60)
    parts = []
    if h:
        parts.append(f"{h} {plural(h, 'час', 'часа', 'часов')}")
    if m:
        parts.append(f"{m} {plural(m, 'минуту', 'минуты', 'минут')}")
    if s:
        parts.append(f"{s} {plural(s, 'секунду', 'секунды', 'секунд')}")
    return " ".join(parts) or "0 секунд"


class SysActions:
    """Настоящие действия с компьютером. Тяжёлые модули грузятся только при вызове."""
    def __init__(self, list_apps=None, launch=None, screenshot_dir=None):
        self._list_apps, self._launch = list_apps, launch
        self.screenshot_dir = screenshot_dir or os.path.join(os.path.expanduser("~"), "Pictures", "Светлана")

    def keys(self, *keys, times=1):
        import pyautogui
        for _ in range(max(1, min(50, times))):
            pyautogui.hotkey(*keys) if len(keys) > 1 else pyautogui.press(keys[0])

    def open_url(self, url):
        webbrowser.open(url)

    def apps(self):
        return self._list_apps() if self._list_apps else []

    def launch(self, app_id):
        if not self._launch:
            raise RuntimeError("запуск приложений недоступен")
        self._launch(app_id)

    def builtin(self, cmd):
        if sys.platform != "win32":
            raise RuntimeError("эта программа есть только в Windows")
        os.startfile(cmd) if cmd.endswith(":") else subprocess.Popen(cmd, shell=False, creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0) if cmd == "cmd" else 0)

    def lock(self):
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.LockWorkStation()
        elif sys.platform == "darwin":
            subprocess.Popen(["pmset", "displaysleepnow"])
        else:
            subprocess.Popen(["loginctl", "lock-session"])

    def screenshot(self):
        import mss
        import mss.tools
        os.makedirs(self.screenshot_dir, exist_ok=True)
        path = os.path.join(self.screenshot_dir, time.strftime("Скриншот %Y-%m-%d %H-%M-%S.png"))
        with mss.mss() as s:
            shot = s.grab(s.monitors[1])
            mss.tools.to_png(shot.rgb, shot.size, output=path)
        return path

    def battery(self):
        try:
            import psutil
            b = psutil.sensors_battery()
            return (round(b.percent), bool(b.power_plugged)) if b else None
        except Exception:
            return None


class Commands:
    """match(text) → ответ для озвучки (команда выполнена) или None (не офлайн-команда — отдаём мозгу)."""
    def __init__(self, actions, notify=None, owner="Павел", now=datetime.datetime.now):
        self.a, self.notify, self.owner, self.now = actions, notify or (lambda text: None), owner, now
        self.timers = []
        self.rules = [
            (r"(который час|сколько времени|сколько сейчас времени|какое время|время)", self.time),
            (r"(какое сегодня число|какое число|какая (сегодня )?дата|какой сегодня день|какой день недели|какое сегодня число и день)", self.date),
            (r"(привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро|доброй ночи)( светлана)?", self.hello),
            (r"(как дела|как ты|как поживаешь)", lambda m: "Всё отлично, работаю. Чем помочь?"),
            (r"(спасибо|благодарю)( тебе)?", lambda m: "Пожалуйста!"),
            (r"(что ты умеешь|какие (есть )?команды|список команд|помощь)", self.help),
            (r"(сделай )?(по)?громче( на (?P<n>.+))?", lambda m: self.volume("volumeup", m)),
            (r"(сделай )?(по)?тише( на (?P<n>.+))?", lambda m: self.volume("volumedown", m)),
            (r"(выключи|отключи|убери|включи|верни) звук|без звука", self.mute),
            (r"(пауза|поставь на паузу|продолжи|продолжай|играй|воспроизведи|стоп музыка|останови музыку)", lambda m: self.media("playpause", "Готово.")),
            (r"(следующий|следующая|следующую)( трек| песня| песню| видео)?|переключи (трек|песню)", lambda m: self.media("nexttrack", "Следующий.")),
            (r"(предыдущий|предыдущая|предыдущую)( трек| песня| песню| видео)?", lambda m: self.media("prevtrack", "Предыдущий.")),
            (r"(заблокируй|блокируй|заблокировать) (компьютер|экран|пк|ноутбук)", self.lock),
            (r"(сверни все( окна)?|покажи рабочий стол)", lambda m: (self.a.keys("win", "d") if sys.platform == "win32" else self.a.keys("command", "f3") if sys.platform == "darwin" else self.a.keys("super", "d"), "Готово.")[1]),
            (r"закрой (это |текущее )?(окно|программу|приложение)", lambda m: (self.a.keys("command", "q") if sys.platform == "darwin" else self.a.keys("alt", "f4"), "Закрываю.")[1]),
            (r"(сделай|сохрани) (скриншот|снимок экрана)|скриншот", self.screenshot),
            (r"(какой )?заряд( батареи| аккумулятора)?|сколько (осталось )?заряда", self.battery),
            (r"(поставь |заведи |запусти |включи )?таймер на (?P<d>.+)", self.timer),
            (r"(найди|поищи|загугли) в (интернете|гугле|яндексе|браузере) (?P<q>.+)|загугли (?P<q2>.+)", self.search),
            (r"(открой|запусти|включи|открыть) (?P<what>.+)", self.open),
        ]

    def match(self, text):
        t = strip_fillers(normalize(text))
        if not t:
            return None
        for pattern, handler in self.rules:
            m = re.fullmatch(pattern, t)
            if m:
                try:
                    return handler(m)
                except _NotMine:
                    return None
                except Exception as e:
                    return f"Не получилось: {str(e)[:120]}"
        return None

    # ---- ответы ----
    def time(self, m):
        n = self.now()
        h, mi = n.hour, n.minute
        return f"Сейчас {h} {plural(h, 'час', 'часа', 'часов')} " + ("ровно." if mi == 0 else f"{mi} {plural(mi, 'минута', 'минуты', 'минут')}.")

    def date(self, m):
        n = self.now()
        return f"Сегодня {WD[n.weekday()]}, {n.day} {MONTHS[n.month - 1]}."

    def hello(self, m):
        h = self.now().hour
        g = "Доброе утро" if 5 <= h < 12 else "Добрый день" if 12 <= h < 18 else "Добрый вечер" if 18 <= h < 23 else "Доброй ночи"
        return f"{g}{', ' + self.owner if self.owner else ''}! Я на связи."

    def help(self, m):
        return ("Без интернета я умею: сказать время и дату, открыть программу или сайт, громче, тише, без звука, пауза, следующий трек, "
                "таймер, скриншот, заряд батареи, свернуть окна, заблокировать компьютер. Всё остальное спрашивай как обычно, я подумаю.")

    def volume(self, key, m):
        n, _ = parse_number((m.group("n") or "").replace("процентов", "").split())
        steps = max(1, min(50, round(n / 2))) if n else 5  # одна клавиша ≈ 2%
        self.a.keys(key, times=steps)
        return "Громче." if key == "volumeup" else "Тише."

    def mute(self, m):
        self.a.keys("volumemute")
        return "Готово."

    def media(self, key, reply):
        self.a.keys(key)
        return reply

    def lock(self, m):
        self.a.lock()
        return "Блокирую."

    def screenshot(self, m):
        path = self.a.screenshot()
        return f"Сохранила скриншот в папку {os.path.basename(os.path.dirname(path))}."

    def battery(self, m):
        b = self.a.battery()
        if not b:
            return "Не вижу батарею: похоже, это настольный компьютер."
        p, plugged = b
        return f"Заряд {p} {plural(p, 'процент', 'процента', 'процентов')}" + (", заряжается." if plugged else ".")

    def timer(self, m):
        sec = parse_duration(m.group("d"))
        if not sec:
            raise _NotMine()
        label = say_duration(sec)
        t = threading.Timer(sec, lambda: self.notify(f"Таймер на {label}: время вышло!"))
        t.daemon = True
        t.start()
        self.timers.append(t)
        return f"Поставила таймер на {label}."

    def search(self, m):
        q = (m.group("q") or m.group("q2") or "").strip()
        if not q:
            raise _NotMine()
        self.a.open_url("https://ya.ru/search/?text=" + quote_plus(q))
        return f"Ищу: {q}."

    def open(self, m):
        what = m.group("what").strip()
        for pre in ("мне ", "пожалуйста ", "программу ", "приложение ", "сайт "):
            if what.startswith(pre):
                what = what[len(pre):]
        if what in SITES:
            self.a.open_url(SITES[what])
            return "Открываю."
        if what in BUILTINS and sys.platform == "win32":
            self.a.builtin(BUILTINS[what])
            return "Открываю."
        app = self.find_app(APP_ALIASES.get(what, what))
        if app:
            self.a.launch(app["id"])
            return f"Открываю {app['name']}."
        if what in WEB_FALLBACK:
            self.a.open_url(WEB_FALLBACK[what])
            return "Открываю в браузере."
        raise _NotMine()  # «открой счёт клиенту Иванову» — это уже работа для мозга

    def find_app(self, name):
        apps = self.a.apps() or []
        if not apps or len(name) < 2:
            return None
        variants = {name, translit(name)}
        best, score = None, 0.0
        for a in apps:
            n = normalize(a["name"])
            for v in variants:
                if n == v:
                    return a
                s = difflib.SequenceMatcher(None, v, n).ratio()
                if re.search(r"(^|\s)" + re.escape(v) + r"(\s|$)", n):
                    s = max(s, 0.9 - 0.002 * len(n))  # «excel» → «Excel 2016», короче — лучше
                if s > score:
                    best, score = a, s
        return best if score >= 0.78 else None


class _NotMine(Exception):
    """Фраза похожа на команду, но офлайн её не выполнить — пусть решает мозг."""
