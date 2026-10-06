"""Голос на ПК без микрофона и колонок: офлайн-команды (commands.py) и голосовой цикл (voice.VoiceLoop)."""
import datetime, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-agent"))
import commands as C
import voice as V


class FakeActs:
    def __init__(self): self.keys_log, self.urls, self.launched, self.locked = [], [], [], 0
    def keys(self, *k, times=1): self.keys_log.append((k, times))
    def open_url(self, u): self.urls.append(u)
    def apps(self): return [{"id": "x1", "name": "Excel"}, {"id": "t1", "name": "Telegram"}, {"id": "c1", "name": "1С:Предприятие"}, {"id": "v1", "name": "Visual Studio Code"}]
    def launch(self, i): self.launched.append(i)
    def builtin(self, c): self.launched.append("builtin:" + c)
    def lock(self): self.locked += 1
    def screenshot(self): return os.path.join("Pictures", "Светлана", "s.png")
    def battery(self): return (57, True)


notes = []
a = FakeActs()
cmd = C.Commands(a, notify=notes.append, owner="Павел", now=lambda: datetime.datetime(2026, 10, 6, 21, 5))

# время и дата: только если вся фраза — команда
assert cmd.match("Который час?") == "Сейчас 21 час 5 минут.", cmd.match("который час")
assert cmd.match("скажи пожалуйста сколько времени") == "Сейчас 21 час 5 минут."
assert cmd.match("сколько времени займёт отчёт за сентябрь") is None, "длинный вопрос — мозгу"
assert cmd.match("какое сегодня число") == "Сегодня вторник, 6 октября."
assert cmd.match("добрый вечер").startswith("Добрый вечер, Павел")

# числа и длительности
assert C.parse_number(["двадцать", "пять"]) == (25, 2)
assert C.parse_duration("пять минут") == 300 and C.parse_duration("полчаса") == 1800
assert C.parse_duration("минуту") == 60 and C.parse_duration("один час тридцать минут") == 5400
assert C.parse_duration("полторы минуты") == 90 and C.parse_duration("сорок пять секунд") == 45
assert C.parse_duration("пять яблок") is None
assert C.plural(21, "час", "часа", "часов") == "час" and C.plural(12, "час", "часа", "часов") == "часов"

# громкость и медиа
assert cmd.match("громче") == "Громче." and a.keys_log[-1] == (("volumeup",), 5)
assert cmd.match("сделай тише на двадцать процентов") == "Тише." and a.keys_log[-1] == (("volumedown",), 10)
assert cmd.match("выключи звук") == "Готово." and a.keys_log[-1] == (("volumemute",), 1)
assert cmd.match("пауза") == "Готово." and a.keys_log[-1] == (("playpause",), 1)
assert cmd.match("следующий трек") == "Следующий."

# открыть: сайты, приложения (в т.ч. по-русски), иначе — мозгу
assert cmd.match("открой ютуб") == "Открываю." and a.urls[-1] == "https://www.youtube.com"
assert cmd.match("открой эксель") == "Открываю Excel." and a.launched[-1] == "x1"
assert cmd.match("запусти телеграм") == "Открываю Telegram." and a.launched[-1] == "t1"
assert cmd.match("открой один эс") == "Открываю 1С:Предприятие.", cmd.match("открой один эс")
assert cmd.match("открой вс код") == "Открываю Visual Studio Code."
assert cmd.match("открой мой налог") == "Открываю." and "lknpd" in a.urls[-1]
assert cmd.match("открой счёт клиенту иванову") is None, "не программа — мозгу"
assert cmd.match("загугли погода в ханое") == "Ищу: погода в ханое." and "text=" in a.urls[-1]

# система
assert cmd.match("заблокируй компьютер") == "Блокирую." and a.locked == 1
assert cmd.match("сделай скриншот") == "Сохранила скриншот в папку Светлана."
assert cmd.match("какой заряд батареи") == "Заряд 57 процентов, заряжается."

# таймер срабатывает и говорит
r = cmd.match("поставь таймер на две минуты")
assert r == "Поставила таймер на 2 минуты.", r
cmd.timers[-1].cancel(); cmd.timers[-1].function()
assert notes[-1] == "Таймер на 2 минуты: время вышло!"
assert cmd.match("таймер на пять яблок") is None

# речь: без разметки, длинное — коротко
assert V.for_speech("**Готово**, см. [отчёт](https://x.ru) и https://y.ru") == "Готово, см. отчёт и ссылка"
long = V.for_speech("Это предложение. " * 100)
assert len(long) < 760 and long.endswith("Подробности в приложении.")

# ---- голосовой цикл ----
t = [0.0]
said, asked, confirmed = [], [], []
answers = {"ask": {"answer": "Доход за сентябрь 120 000 ₽.", "pending": []}}
def speak(text, done=None):
    said.append(text)
    done and done()
def ask(text, reset):
    asked.append((text, reset)); return answers["ask"]
def confirm(ok):
    confirmed.append(ok); return {"answer": "Сделала." if ok else "Отменила.", "pending": []}
online = [True]
loop = V.VoiceLoop(cmd, ask=ask, confirm=confirm, speak=speak, online=lambda: online[0], clock=lambda: t[0], spawn=lambda fn: fn())

loop.process("который час")                       # без «Светлана» — тишина
assert said == []
loop.process("Светлана который час")
assert said[-1].startswith("Сейчас 21 час")
t[0] += 3; loop.process("а какое сегодня число")  # продолжение разговора без слова-активатора (6 с после ответа)
assert said[-1] == "Сегодня вторник, 6 октября."
t[0] += 30; loop.process("какое сегодня число")   # окно закрылось
assert said[-1] == "Сегодня вторник, 6 октября." and len(said) == 2
loop.process("светлана"); assert said[-1] == "Слушаю."
t[0] += 2; loop.process("сколько я заработал в сентябре")
assert asked[-1] == ("сколько я заработал в сентябре", False) and said[-1] == "Доход за сентябрь 120 000 ₽."
t[0] += 30
online[0] = False; loop.process("светлана сколько я заработал"); assert "Нет связи" in said[-1]
loop.process("светлана громче"); assert said[-1] == "Громче.", "офлайн-команды работают без связи"
online[0] = True

# подтверждение голосом
answers["ask"] = {"answer": "Открою 1С и нажму «Провести».", "pending": [{"title": "на устройстве: tap", "voice": True}]}
t[0] += 30; loop.process("светлана проведи документ в один эс")
assert said[-1].endswith("Да или нет?")
t[0] += 2; loop.process("да")
assert confirmed[-1] is True and said[-1] == "Сделала."
t[0] += 30; loop.process("светлана проведи ещё раз"); t[0] += 1; loop.process("нет, не надо")
assert confirmed[-1] is False
t[0] += 30; loop.process("светлана проведи"); t[0] += 1; loop.process("банан"); loop.process("огурец")
assert confirmed[-1] is False and said[-2] == "Скажите «да» или «нет».", said[-3:]

# деньги — только в приложении
answers["ask"] = {"answer": "Запишу доход 5000 ₽.", "pending": [{"title": "записать доход", "voice": False}]}
t[0] += 30; n = len(confirmed); loop.process("светлана запиши доход пять тысяч")
assert "только в приложении" in said[-1]; t[0] += 1; loop.process("да")
assert len(confirmed) == n, "голосом не подтверждаем"

# служебные
t[0] += 30; loop.process("светлана повтори"); assert said[-1] == said[-2]
t[0] += 30; loop.process("светлана новый разговор"); assert asked[-1] == ("", True)

# ошибка ядра
def bad(text, reset): raise RuntimeError("ядро не ответило вовремя")
loop.ask = bad; t[0] += 30; loop.process("светлана придумай стих")
assert said[-1] == "Не получилось: ядро не ответило вовремя"
print("OK")
