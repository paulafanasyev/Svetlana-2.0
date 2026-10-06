"""Голос Светланы на компьютере: слушает микрофон офлайн (Vosk), отзывается на «Светлана», говорит голосом Windows (SAPI5).

Схема: «Светлана, который час» → быстрая офлайн-команда (commands.py) → ответ сразу.
        «Светлана, сделай счёт Иванову на 5000» → в ядро (мозг) → ответ голосом; рискованное — «да / нет».
Звук никуда не отправляется: распознавание целиком на компьютере. В ядро уходит только распознанный текст.
"""
import json
import os
import queue
import re
import sys
import threading
import time
import zipfile

WAKE = ("светлана", "светланка", "света", "светочка")
YES = {"да", "подтверждаю", "подтверди", "давай", "конечно", "выполняй", "делай", "ага", "угу", "можно", "согласна", "согласен"}
NO = {"нет", "не", "отмена", "отмени", "не надо", "стоп", "отказ", "нельзя", "не нужно"}
STOP = {"стоп", "замолчи", "хватит", "тихо", "помолчи", "перестань", "стой", "отмена"}
MODEL_NAME = "vosk-model-small-ru-0.22"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip"
SAMPLE_RATE = 16000


def norm(t):
    t = str(t or "").lower().replace("ё", "е")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t)).strip()


def for_speech(text, limit=700):
    """Ответ модели → текст для озвучки: без разметки, ссылок и кода; длинное — коротко."""
    t = re.sub(r"```.*?```", " (код показан в приложении) ", str(text or ""), flags=re.S)
    t = re.sub(r"\(Проверка:[^)]*\)", "", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"https?://\S+", "ссылка", t)
    t = re.sub(r"[*_`#>|~]", "", t)
    t = re.sub(r"^\s*[-•]\s*", "", t, flags=re.M)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[: end + 1] if end > limit // 3 else cut.rsplit(" ", 1)[0] + "…") + " Подробности в приложении."


def app_dir():
    """Папка рядом с программой (в установленной версии — где лежит Svetlana.exe и модель)."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def user_dir():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    d = os.path.join(base, "Svetlana")
    os.makedirs(d, exist_ok=True)
    return d


def find_model():
    for d in (os.environ.get("SVETLANA_VOSK_MODEL"), os.path.join(app_dir(), "model"), os.path.join(user_dir(), "model")):
        if d and os.path.isdir(os.path.join(d, "am")):
            return d
    return None


def download_model(progress=lambda pct: None):
    """Скачать русскую модель (≈45 МБ) в папку пользователя. Нужен один раз; дальше всё офлайн."""
    import urllib.request
    dest = os.path.join(user_dir(), "model")
    tmp = os.path.join(user_dir(), "model.zip.part")
    with urllib.request.urlopen(MODEL_URL, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if total:
                progress(int(got * 100 / total))
    with zipfile.ZipFile(tmp) as z:
        root = os.path.join(user_dir(), "_unz")
        for n in z.namelist():  # защита от путей «../»
            p = os.path.realpath(os.path.join(root, n))
            if not p.startswith(os.path.realpath(root) + os.sep) and p != os.path.realpath(root):
                raise RuntimeError("подозрительный архив модели")
        z.extractall(root)
    os.remove(tmp)
    src = os.path.join(root, MODEL_NAME)
    if os.path.isdir(dest):
        import shutil
        shutil.rmtree(dest)
    os.replace(src, dest)
    try:
        os.rmdir(root)
    except OSError:
        pass
    return dest


class Speaker:
    """Озвучка в отдельном потоке (pyttsx3/SAPI5 любит один поток). Пока говорит — микрофон не слушается."""
    def __init__(self, log=print, rate=185):
        self.log, self.rate = log, rate
        self.q = queue.Queue()
        self.speaking = threading.Event()
        self.engine = None
        self.ok = True
        threading.Thread(target=self._run, daemon=True, name="speaker").start()

    def _pick_voice(self, engine):
        voices = engine.getProperty("voices") or []
        def is_ru(v):
            langs = " ".join(str(x) for x in (getattr(v, "languages", None) or []))
            return "ru" in langs.lower() or re.search(r"russian|ru-ru|irina|ирина|pavel|svetlana|milena|алена|elena", f"{v.name} {v.id}", re.I)
        female = [v for v in voices if is_ru(v) and re.search(r"irina|ирина|svetlana|milena|elena|алена|female|жен", f"{v.name} {v.id}", re.I)]
        ru = female or [v for v in voices if is_ru(v)]
        if ru:
            engine.setProperty("voice", ru[0].id)
            return ru[0].name
        return None

    def _run(self):
        try:
            import pyttsx3
            self.engine = pyttsx3.init()
            self.engine.setProperty("rate", self.rate)
            name = self._pick_voice(self.engine)
            self.log(f"[голос] озвучка: {name}" if name else "[голос] русского голоса в Windows нет — поставьте «Русский» в Параметры → Время и язык → Речь")
        except Exception as e:
            self.ok = False
            self.log(f"[голос] озвучка недоступна: {e}")
        while True:
            text, done = self.q.get()
            self.speaking.set()
            try:
                if self.ok and text:
                    self.engine.say(text)
                    self.engine.runAndWait()
            except Exception as e:
                self.log(f"[голос] ошибка озвучки: {e}")
            finally:
                if self.q.empty():
                    time.sleep(0.25)  # хвост эха из колонок не должен попасть в микрофон
                    self.speaking.clear()
                if done:
                    try:
                        done()
                    except Exception:
                        pass

    def say(self, text, done=None):
        self.log(f"[Светлана] {text}")
        self.speaking.set()
        self.q.put((text, done))

    def stop(self):
        try:
            while True:
                self.q.get_nowait()
        except queue.Empty:
            pass
        try:
            if self.engine:
                self.engine.stop()
        except Exception:
            pass


class Listener:
    """Микрофон → Vosk → on_text(фраза). Пока Светлана говорит, звук выбрасывается (не слышит сама себя)."""
    def __init__(self, model_dir, on_text, is_muted=lambda: False, log=print, on_level=None, device=None):
        self.model_dir, self.on_text, self.is_muted, self.log, self.on_level, self.device = model_dir, on_text, is_muted, log, on_level, device
        self.paused = threading.Event()
        self._stop = threading.Event()
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True, name="listener")
        self.thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        import sounddevice as sd
        from vosk import KaldiRecognizer, Model, SetLogLevel
        SetLogLevel(-1)
        model = Model(self.model_dir)
        rec = KaldiRecognizer(model, SAMPLE_RATE)
        audio = queue.Queue(maxsize=200)
        def cb(data, frames, t, status):
            if not audio.full():
                audio.put(bytes(data))
        while not self._stop.is_set():
            try:
                with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=4000, dtype="int16", channels=1, callback=cb, device=self.device):
                    self.log("[голос] слушаю микрофон")
                    was_muted = False
                    while not self._stop.is_set():
                        try:
                            data = audio.get(timeout=0.5)
                        except queue.Empty:
                            continue
                        muted = self.is_muted() or self.paused.is_set()
                        if muted:
                            was_muted = True
                            continue
                        if was_muted:  # после своей речи начинаем фразу с чистого листа
                            rec.Reset()
                            was_muted = False
                        if rec.AcceptWaveform(data):
                            text = json.loads(rec.Result()).get("text", "").strip()
                            if text:
                                self.log(f"[вы] {text}")
                                try:
                                    self.on_text(text)
                                except Exception as e:
                                    self.log(f"[голос] ошибка обработки: {e}")
            except Exception as e:
                self.log(f"[голос] микрофон недоступен: {e}. Повтор через 5 с")
                time.sleep(5)


class VoiceLoop:
    """Мозг голосового режима без звука (поэтому тестируется): фраза → действие → что сказать.

    ask(text, reset) → {"answer", "pending": [{"title", "voice"}], "error"} — запрос в ядро.
    confirm(approve) → такой же ответ. Всё рискованное ядро присылает в pending; голосом подтверждается только то,
    что ядро пометило voice=True (действия на этом компьютере и обычные изменения), деньги и публикации — только в приложении.
    """
    def __init__(self, commands, ask, confirm, speak, stop_speaking=lambda: None, online=lambda: True, require_wake=True,
                 wake=WAKE, awake_seconds=8, followup_seconds=6, clock=time.monotonic, spawn=None, log=print):
        self.commands, self.ask, self.confirm, self.speak, self.stop_speaking, self.online = commands, ask, confirm, speak, stop_speaking, online
        self.require_wake, self.wake, self.awake_seconds, self.followup_seconds, self.clock, self.log = require_wake, wake, awake_seconds, followup_seconds, clock, log
        self.spawn = spawn or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.awake_until = 0.0
        self.confirm_until = 0.0
        self.confirm_tries = 0
        self.busy = False
        self.last = ""
        self.enabled = True

    # кнопка «Слушать» в окне/трее: следующая фраза без слова «Светлана»
    def wake_now(self):
        self.awake_until = self.clock() + self.awake_seconds
        self.say("Слушаю.", followup=False)

    def say(self, text, followup=True):
        self.last = text
        def done():
            if followup:
                self.awake_until = max(self.awake_until, self.clock() + self.followup_seconds)
        self.speak(text, done)

    def strip_wake(self, t):
        w = t.split()
        for i, x in enumerate(w[:4]):  # «ну светлана …», «эй света …»
            if x in self.wake:
                return True, " ".join(w[i + 1:])
        return False, t

    def process(self, text):
        t = norm(text)
        if not t or not self.enabled:
            return
        now = self.clock()
        # 1) ждём «да / нет»
        if self.confirm_until > now:
            _, t2 = self.strip_wake(t)
            words = set(t2.split())
            if words & YES and not words & {"не", "нет"}:
                self.confirm_until = 0
                return self._remote(lambda: self.confirm(True), "Выполняю.")
            if words & NO or t2 in NO:
                self.confirm_until = 0
                return self._remote(lambda: self.confirm(False), None)
            self.confirm_tries += 1
            if self.confirm_tries >= 2:
                self.confirm_until = 0
                self._remote(lambda: self.confirm(False), None)
                return
            return self.say("Скажите «да» или «нет».", followup=False)
        # 2) слово-активатор
        woke, rest = self.strip_wake(t)
        if self.require_wake and not woke and self.awake_until <= now:
            return
        self.awake_until = 0
        if not rest:
            self.awake_until = now + self.awake_seconds
            return self.say("Слушаю.", followup=False)
        self.handle(rest)

    def handle(self, rest):
        words = rest.split()
        if rest in STOP or (len(words) <= 2 and words[0] in STOP):
            self.stop_speaking()
            return
        if rest in ("повтори", "повтори пожалуйста", "что ты сказала", "еще раз"):
            return self.say(self.last or "Я пока ничего не говорила.")
        if rest in ("новый разговор", "начнем заново", "начни заново", "забудь разговор", "новая тема"):
            return self._remote(lambda: self.ask("", True), "Хорошо, начинаем заново.")
        if rest in ("не слушай", "перестань слушать", "уйди в сон", "спи"):
            self.enabled_sleep()
            return
        quick = self.commands.match(rest) if self.commands else None
        if quick:
            return self.say(quick)
        if not self.online():
            return self.say("Нет связи с ядром Светланы. Без интернета я умею быстрые команды: скажите «что ты умеешь».")
        if self.busy:
            return self.say("Ещё думаю над прошлым вопросом.", followup=False)
        self._remote(lambda: self.ask(rest, False), None)

    def enabled_sleep(self):
        self.awake_until = 0
        self.say("Хорошо. Позовите «Светлана», когда понадоблюсь.", followup=False)

    def _remote(self, call, fixed_answer):
        self.busy = True
        def work():
            try:
                r = call() or {}
            except Exception as e:
                r = {"error": str(e)}
            finally:
                self.busy = False
            self.on_reply(r, fixed_answer)
        self.spawn(work)

    def on_reply(self, r, fixed_answer=None):
        if r.get("error"):
            return self.say("Не получилось: " + for_speech(r["error"], 200), followup=False)
        answer = fixed_answer if fixed_answer and not r.get("answer") else for_speech(r.get("answer") or fixed_answer or "Готово.")
        pending = r.get("pending") or []
        if not pending:
            return self.say(answer)
        titles = "; ".join(str(p.get("title", "действие")) for p in pending[:3])
        if all(p.get("voice") for p in pending):
            self.confirm_until = self.clock() + 25
            self.confirm_tries = 0
            return self.say(f"{answer} Подтверждаете: {titles}? Да или нет?", followup=False)
        return self.say(f"{answer} Это действие ({titles}) голосом подтвердить нельзя: деньги, публикации и запуск кода подтверждаются только в приложении Светланы.")
