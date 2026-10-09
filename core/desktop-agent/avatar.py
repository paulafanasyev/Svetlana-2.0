"""Аватар Светланы в окне Windows: тот же образ, что в Svetlana-2.0 (public/images/avatar/svetlana-master.jpg),
круглый, с живым кольцом состояния: на связи — дышит, слушает — голубая пульсация, думает — бегущая дуга,
говорит — быстрые волны, нет связи — серая."""
import math
import os
import sys
import time
import tkinter as tk

STATES = {
    "offline":   {"color": "#9aa0a6", "text": "нет связи"},
    "connecting": {"color": "#f4b400", "text": "подключаюсь…"},
    "idle":      {"color": "#7c5ce8", "text": "на связи"},
    "listening": {"color": "#22c3e6", "text": "слушаю…"},
    "thinking":  {"color": "#f4a020", "text": "думаю…"},
    "speaking":  {"color": "#6366f1", "text": "говорю…"},
}


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


def round_image(size, path=None, grey=False):
    """PIL-картинка аватара в круге (или фирменный кружок с «С», если файла нет)."""
    from PIL import Image, ImageDraw, ImageOps, ImageFont
    path = path or find_image()
    if path:
        img = ImageOps.fit(Image.open(path).convert("RGB"), (size, size), centering=(0.5, 0.35))
    else:
        img = Image.new("RGB", (size, size), (124, 92, 232))
        d = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("segoeui.ttf", size // 2)
        except Exception:
            font = ImageFont.load_default()
        d.text((size / 2, size / 2), "С", fill="white", anchor="mm", font=font)
    if grey:
        img = ImageOps.grayscale(img).convert("RGB")
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


class AvatarWidget(tk.Canvas):
    def __init__(self, parent, size=88, bg=None):
        self.size, self.pad = size, 10
        side = size + self.pad * 2
        super().__init__(parent, width=side, height=side, highlightthickness=0, bg=bg or parent.winfo_toplevel().cget("bg"))
        self.state = "offline"
        self.t0 = time.monotonic()
        self.has_image = bool(find_image())
        try:
            from PIL import ImageTk
            self._img = {k: ImageTk.PhotoImage(round_image(size, grey=(k == "offline"))) for k in ("color", "offline")}
        except Exception:
            self._img = None
        c = side / 2
        self.ring = self.create_oval(0, 0, 0, 0, outline=STATES["offline"]["color"], width=3)
        self.arc = self.create_arc(0, 0, 0, 0, start=0, extent=0, style="arc", outline="", width=4)
        self.photo = self.create_image(c, c, image=self._img["offline"]) if self._img else self.create_oval(
            c - size / 2, c - size / 2, c + size / 2, c + size / 2, fill="#7c5ce8", outline="")
        self.after(40, self._tick)

    def set_state(self, state):
        if state in STATES and state != self.state:
            self.state = state
            if self._img:
                self.itemconfigure(self.photo, image=self._img["offline" if state == "offline" else "color"])

    def _tick(self):
        try:
            self._draw(time.monotonic() - self.t0)
            self.after(40, self._tick)
        except tk.TclError:
            pass  # окно закрыто

    def _draw(self, t):
        st, color = self.state, STATES[self.state]["color"]
        c, r0 = (self.size + self.pad * 2) / 2, self.size / 2 + 3
        grow, width, arc = 0.0, 3, None
        if st == "idle":
            grow = 1.5 + 1.5 * math.sin(t * 1.6)            # спокойное дыхание
        elif st == "listening":
            grow = 3 + 4 * abs(math.sin(t * 4.0)); width = 4  # слушает: пульс
        elif st == "speaking":
            grow = 2 + 3 * abs(math.sin(t * 9.0)); width = 4  # говорит: быстрые волны
        elif st == "thinking":
            arc = (-(t * 240) % 360, 110)                    # думает: бегущая дуга
        elif st == "connecting":
            arc = (-(t * 160) % 360, 60)
        r = r0 + grow
        self.coords(self.ring, c - r, c - r, c + r, c + r)
        self.itemconfigure(self.ring, outline=color if arc is None else "#d0d0d8", width=width)
        if arc:
            ra = r0 + 2
            self.coords(self.arc, c - ra, c - ra, c + ra, c + ra)
            self.itemconfigure(self.arc, start=arc[0], extent=arc[1], outline=color)
        else:
            self.itemconfigure(self.arc, extent=0, outline="")
