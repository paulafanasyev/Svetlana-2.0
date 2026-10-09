"""Живой аватар Светланы для окна Windows — тот же, что в Svetlana-self-employed.

Портрет svetlana-face.jpg (байт в байт тот же файл, что svetlana-master.jpg в Svetlana-2.0) и та же «оснастка» лица,
что в web/src/lib/svetlanaFace.js: моргание, брови, улыбка, румянец, наклоны головы, смех/кивок/подмигивание
и движение губ, пока она говорит. Перенесено с canvas на Pillow. Вокруг — кольцо состояния
(на связи / слушаю / думаю / говорю / нет связи).
"""
import math
import os
import random
import re
import sys
import time
import tkinter as tk

# ---------- оснастка лица (координаты в пикселях портрета, как в svetlanaFace.js) ----------
RIG = {"view": (90, 95, 360), "blink_ms": 130, "blink_gap": (2200, 5700),
       "eyes": [(195, 233, 36, 22), (316, 215, 36, 25)], "cheeks": [(178, 282, 34), (338, 262, 32)], "jaw_drop": 13}
ZERO = dict(bl=0, br=0, sq=0, ml=0, mr=0, jaw=0, round=0, blush=0, tear=0, sweat=0, wl=0, wr=0, rot=0, hx=0, hy=0, hs=1)
EXPRESSIONS = {
    "calm": {}, "joy": dict(bl=3, br=3, sq=.22, ml=.9, mr=.9, blush=.25),
    "laugh": dict(bl=4, br=4, sq=.95, ml=1.2, mr=1.2, jaw=.55, blush=.45, action="laugh"),
    "surprise": dict(bl=10, br=10, jaw=.75, round=.8), "question": dict(bl=1, br=9, ml=-.2, mr=.35, rot=.12, hx=4),
    "thinking": dict(bl=-2, br=6, sq=.18, ml=-.3, mr=.5, rot=-.08, hy=-3),
    "sad": dict(bl=-1, br=-1, sq=.25, ml=-1.8, mr=-1.8, rot=.04, hy=4, tear=1), "angry": dict(bl=1, br=1, ml=-.8, mr=-.8, rot=-.02),
    "fear": dict(bl=6, br=6, sq=.3, jaw=.3, round=.3, hy=-4, sweat=1), "shy": dict(bl=1, br=1, sq=.35, ml=.5, mr=.5, blush=.9, rot=.1, hy=5),
    "love": dict(bl=5, br=5, ml=1.1, mr=1.1, blush=.6), "skeptic": dict(bl=-4, br=8, sq=.15, ml=-.4, mr=.6, rot=-.05),
    "wink": dict(bl=2, br=4, ml=.4, mr=1.1, action="wink"),
}
ACTION_MS = {"laugh": 2200, "nod": 1000, "shake": 1100, "wink": 900}

STATES = {
    "offline":    {"color": "#9aa0a6", "text": "нет связи"},
    "connecting": {"color": "#d9a400", "text": "подключаюсь…"},
    "idle":       {"color": "#2f7d55", "text": "на связи"},
    "listening":  {"color": "#22a6c8", "text": "слушаю…"},
    "thinking":   {"color": "#e08a1e", "text": "думаю…"},
    "speaking":   {"color": "#2f7d55", "text": "говорю…"},
}
STATE_EXPR = {"listening": "question", "thinking": "thinking"}


def emotion_from_text(text):
    """Как в svetlanaFace.js: по ответу понять, с каким лицом его говорить."""
    t = str(text or "").lower()
    if re.search(r"ха-?ха|хах|смешно", t): return "laugh"
    if re.search(r"ого|вау|ничего себе", t): return "surprise"
    if re.search(r"не удалось|не смогла|не получилось|failed|не выполнено", t): return "sad"
    if re.search(r"опасно|срочно|внимание", t): return "fear"
    if "?" in t: return "question"
    if re.search(r"готово|отлично|супер|подтверждено|!", t): return "joy"
    return "calm"


def _clamp(v, a, b):
    return max(a, min(b, v))


def _ease(t):
    return 1 - (1 - _clamp(t, 0, 1)) ** 4


class Animator:
    """Порт createAnimator(): плавные переходы между выражениями, моргание, действия."""
    def __init__(self, clock=lambda: time.monotonic() * 1000):
        self.clock, self.cur, self.expr = clock, dict(ZERO), "calm"
        self.act, self.start, self.last, self.next, self.blink = None, 0, 0, 0, -1

    def set_expression(self, name):
        name = name if name in EXPRESSIONS else "calm"
        if name != self.expr:
            self.expr = name
            a = EXPRESSIONS[name].get("action")
            if a:
                self.trigger(a)

    def trigger(self, name):
        if name in ACTION_MS:
            self.act, self.start = name, self.clock()

    def frame(self, now=None, open_=0.0, round_=0.0):
        now = self.clock() if now is None else now
        dt = min(now - self.last, 100) if self.last else 16
        self.last = now
        if not self.next:
            self.next = now + 1200
        T = {**ZERO, **{k: v for k, v in EXPRESSIONS[self.expr].items() if k != "action"}}
        A, extra = dict(rot=0, hx=0, hy=0, hs=1), 0.0
        if self.act:
            e = now - self.start
            p = e / ACTION_MS[self.act]
            if p >= 1:
                self.act = None
            elif self.act == "laugh":
                env = math.sin(math.pi * min(1, p * 1.15))
                extra = (.35 + .55 * abs(math.sin(e / 75))) * env
                A["rot"], A["hy"] = .05 * math.sin(e / 95) * env, -4 * abs(math.sin(e / 75)) * env
                T.update(sq=max(T["sq"], .95 * env), ml=1.2, mr=1.2, blush=.5, bl=4, br=4)
            elif self.act == "nod":
                A["hy"], A["rot"] = 9 * math.sin(math.pi * 4 * p) * (1 - p), .02 * math.sin(math.pi * 4 * p) * (1 - p)
            elif self.act == "shake":
                A["hx"], A["rot"] = 10 * math.sin(math.pi * 5 * p) * (1 - p), .05 * math.sin(math.pi * 5 * p) * (1 - p)
            elif self.act == "wink":
                T["wr"] = 1 if p < .65 else 0
        kf = 1 - math.exp(-dt / 95)
        for k in ZERO:
            self.cur[k] += (T[k] - self.cur[k]) * kf
        b = 0.0
        if self.blink < 0 and now >= self.next:
            self.blink = now
        if self.blink >= 0:
            q = (now - self.blink) / RIG["blink_ms"]
            if q >= 1:
                self.blink, self.next = -1, now + RIG["blink_gap"][0] + random.random() * (RIG["blink_gap"][1] - RIG["blink_gap"][0])
            else:
                b = math.sin(math.pi * q)
        c = self.cur
        return {**c, "rot": c["rot"] + A["rot"], "hx": c["hx"] + A["hx"], "hy": c["hy"] + A["hy"], "hs": c["hs"] * A["hs"],
                "open": max(open_, c["jaw"] * (.4 if open_ > .05 else 1), extra), "round": max(round_, c["round"]), "blink": b}


# ---------- картинка ----------
def _app_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def find_image():
    here = _app_dir()
    for p in (os.environ.get("SVETLANA_AVATAR"), os.path.join(here, "avatar.jpg"),
              os.path.join(here, "..", "..", "public", "images", "avatar", "svetlana-master.jpg")):
        if p and os.path.isfile(p):
            return p
    return None


class Face:
    """Портрет + цвет кожи у глаз (им «закрываются» веки), как loadFace()."""
    def __init__(self, path):
        from PIL import Image
        self.img = Image.open(path).convert("RGB")
        self.skin = []
        for cx, cy, rx, ry in RIG["eyes"]:
            box = (int(cx - rx * .7), int(cy - ry * .25), int(cx + rx * .7), int(cy + ry * .25))
            try:
                px = list(self.img.crop(box).getdata())
                self.skin.append(tuple(int(sum(p[i] for p in px) / len(px)) for i in range(3)))
            except Exception:
                self.skin.append((238, 216, 198))


def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def render(face, px, P, now_ms, grey=False):
    """Порт drawFace(): рисуем мимику поверх портрета в его координатах, затем поворот/сдвиг/масштаб головы и кадр px×px."""
    from PIL import Image, ImageDraw, ImageOps
    vx, vy, vs = RIG["view"]
    img = face.img.copy()
    d = ImageDraw.Draw(img, "RGBA")
    for i, (ecx, ecy, rx, ry) in enumerate(RIG["eyes"]):
        b = P["br"] if i else P["bl"]
        if abs(b) > .2:  # брови
            d.line([(ecx - rx * .65, 190 - b), (ecx, 185 - b), (ecx + rx * .65, 191 - b)], fill=(55, 30, 24, 242), width=5, joint="curve")
        close = _clamp(max(P.get("blink", 0), P["sq"], P["wr"] if i else P["wl"]), 0, 1)
        if close > .03:  # веко
            h = ry * (.18 + .82 * close)
            d.ellipse((ecx - rx * 1.05, ecy - h, ecx + rx * 1.05, ecy + h), fill=face.skin[i] + (255,))
    open_ = _clamp(P["open"], 0, 1.2) * RIG["jaw_drop"]
    smile = (P["ml"] + P["mr"]) / 2
    if open_ > .25:  # рот открыт
        oy, oh = 319 + open_ * .55, max(3, open_ * .9)
        d.ellipse((259 - 46, oy - oh, 259 + 46, oy + oh), fill=(91, 26, 34, 255))
        if open_ > 7:
            d.rectangle((239, 322 + open_ * .65, 279, 322 + open_ * .65 + max(2, open_ * .22)), fill=(180, 84, 94, 255))
    elif abs(smile) > .03:  # улыбка / грусть
        d.line([(216, 319 - smile * 5), (258, 323 - smile * 5), (303, 319 - smile * 4)], fill=(139, 61, 59, 242), width=3, joint="curve")
    if P["blush"] > .02:  # румянец
        for x, y, r in RIG["cheeks"]:
            for k in range(6, 0, -1):
                rr = r * k / 6
                d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=(236, 92, 112, int(255 * .42 * P["blush"] / 6)))
    if P["tear"] > .3:
        ty = 256 + (now_ms % 2600) / 2600 * 46
        d.ellipse((171, ty - 5, 181, ty + 5), fill=(150, 200, 240, 204))
    if P["sweat"] > .3:
        sy = 150 + math.sin(now_ms / 300) * 2
        d.ellipse((350, sy - 6, 362, sy + 6), fill=(150, 200, 240, 204))
    # голова: forward = S(k)·T(cx-vx+hx, cy-vy+hy)·R(rot)·S(hs)·T(-cx,-cy); PIL нужен обратный
    k, cx, cy = px / vs, vx + vs / 2, vy + vs / 2
    c, s, hs = math.cos(-P["rot"]), math.sin(-P["rot"]), P["hs"] or 1
    inv = _mat_mul(_mat_mul(_mat_mul(_mat_mul(
        [[1, 0, cx], [0, 1, cy], [0, 0, 1]], [[1 / hs, 0, 0], [0, 1 / hs, 0], [0, 0, 1]]),
        [[c, -s, 0], [s, c, 0], [0, 0, 1]]), [[1, 0, -(cx - vx + P["hx"])], [0, 1, -(cy - vy + P["hy"])], [0, 0, 1]]),
        [[1 / k, 0, 0], [0, 1 / k, 0], [0, 0, 1]])
    out = img.transform((px, px), Image.AFFINE, (inv[0][0], inv[0][1], inv[0][2], inv[1][0], inv[1][1], inv[1][2]),
                        resample=Image.BICUBIC, fillcolor=(241, 246, 242))
    if grey:
        out = ImageOps.grayscale(out).convert("RGB")
    return out


def _circle(img):
    from PIL import Image, ImageDraw
    n = img.size[0]
    mask = Image.new("L", (n * 4, n * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask.resize((n, n), Image.LANCZOS))
    return out


def round_image(size, path=None, grey=False):
    """Статичный круглый портрет (для значка в трее) или кружок с «С», если файла нет."""
    from PIL import Image, ImageDraw, ImageFont
    path = path or find_image()
    if path:
        img = render(Face(path), size, {**ZERO, "open": 0, "blink": 0}, 0, grey)
    else:
        img = Image.new("RGB", (size, size), (33, 82, 53))
        try:
            font = ImageFont.truetype("segoeui.ttf", size // 2)
        except Exception:
            font = ImageFont.load_default()
        ImageDraw.Draw(img).text((size / 2, size / 2), "С", fill="white", anchor="mm", font=font)
    return _circle(img)


class AvatarWidget(tk.Canvas):
    """Живое лицо + кольцо состояния. set_state() — что делает, say(text) — с каким лицом говорит."""
    def __init__(self, parent, size=96, bg=None):
        self.size, self.pad = size, 10
        side = size + self.pad * 2
        super().__init__(parent, width=side, height=side, highlightthickness=0, bg=bg or parent.winfo_toplevel().cget("bg"))
        self.state, self.t0, self.anim = "offline", time.monotonic(), Animator()
        self.speech_expr, self.speech_until = None, 0.0
        path = find_image()
        try:
            from PIL import ImageTk  # noqa: F401
            self.face = Face(path) if path else None
            self._static = None if self.face else round_image(size)
        except Exception:
            self.face, self._static = None, None
        c = side / 2
        self.ring = self.create_oval(0, 0, 0, 0, outline=STATES["offline"]["color"], width=3)
        self.arc = self.create_arc(0, 0, 0, 0, start=0, extent=0, style="arc", outline="", width=4)
        self.photo = self.create_image(c, c)
        self._tkimg = None
        self.after(40, self._tick)

    def set_state(self, state):
        if state in STATES and state != self.state:
            prev, self.state = self.state, state
            if prev in ("offline", "connecting") and state == "idle":
                self.anim.trigger("nod")  # подключилась — кивнула

    def say(self, text):
        """Светлана начала говорить эту фразу: лицо под её смысл на время речи."""
        self.speech_expr = emotion_from_text(text)
        self.speech_until = time.monotonic() + 2 + len(str(text or "")) / 14

    def react(self, action):
        self.anim.trigger(action)

    def _tick(self):
        try:
            self._draw(time.monotonic() - self.t0)
            self.after(40, self._tick)
        except tk.TclError:
            pass  # окно закрыто

    def _draw(self, t):
        st, color = self.state, STATES[self.state]["color"]
        speaking = st == "speaking"
        expr = STATE_EXPR.get(st, "calm")
        if self.speech_expr and time.monotonic() < self.speech_until and self.speech_expr != "calm":
            expr = self.speech_expr
        self.anim.set_expression(expr)
        if self.face is not None:
            from PIL import ImageTk
            # губы: без визем от голоса Windows — «говорящее» движение рта, пока идёт речь
            mouth = (.25 + .45 * abs(math.sin(t * 11)) * (.6 + .4 * math.sin(t * 3.7))) if speaking else 0.0
            frame = render(self.face, self.size * 2, self.anim.frame(open_=mouth), t * 1000, grey=(st == "offline"))
            self._tkimg = ImageTk.PhotoImage(_circle(frame.resize((self.size, self.size))))
            self.itemconfigure(self.photo, image=self._tkimg)
        elif self._static is not None and self._tkimg is None:
            from PIL import ImageTk
            self._tkimg = ImageTk.PhotoImage(self._static)
            self.itemconfigure(self.photo, image=self._tkimg)
        c, r0 = (self.size + self.pad * 2) / 2, self.size / 2 + 3
        grow, width, arc = 0.0, 3, None
        if st == "idle":
            grow = 1.5 + 1.5 * math.sin(t * 1.6)
        elif st == "listening":
            grow, width = 3 + 4 * abs(math.sin(t * 4.0)), 4
        elif speaking:
            grow, width = 2 + 3 * abs(math.sin(t * 9.0)), 4
        elif st == "thinking":
            arc = (-(t * 240) % 360, 110)
        elif st == "connecting":
            arc = (-(t * 160) % 360, 60)
        r = r0 + grow
        self.coords(self.ring, c - r, c - r, c + r, c + r)
        self.itemconfigure(self.ring, outline=color if arc is None else "#d0d8d2", width=width)
        if arc:
            ra = r0 + 2
            self.coords(self.arc, c - ra, c - ra, c + ra, c + ra)
            self.itemconfigure(self.arc, start=arc[0], extent=arc[1], outline=color)
        else:
            self.itemconfigure(self.arc, extent=0, outline="")
