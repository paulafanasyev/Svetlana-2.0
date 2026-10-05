"""Проверка агента ПК без настоящего экрана: подменяем mss/pyautogui/websocket/pyperclip заглушками."""
import json, sys, types, os
from PIL import Image

clicks, hotkeys, clip = [], [], {"v": "старое"}
class FakeShot:
    def __init__(self, w, h): self.size = (w, h); self.rgb = Image.new("RGB", (w, h), (90, 91, 232)).tobytes()
class FakeMss:
    monitors = [None, {"left": 0, "top": 0, "width": 2880, "height": 1800}]
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def grab(self, mon): return FakeShot(mon["width"], mon["height"])
sys.modules["mss"] = types.SimpleNamespace(mss=FakeMss)
pg = types.SimpleNamespace(FAILSAFE=True, PAUSE=0, size=lambda: (1440, 900), click=lambda x, y: clicks.append((x, y)),
    moveTo=lambda x, y: clicks.append(("move", x, y)), dragTo=lambda x, y, duration=0: clicks.append(("drag", x, y)),
    hotkey=lambda *k: hotkeys.append(k), write=lambda t, interval=0: None, FailSafeException=RuntimeError)
sys.modules["pyautogui"] = pg
sys.modules["websocket"] = types.SimpleNamespace(WebSocketApp=object)
sys.modules["pyperclip"] = types.SimpleNamespace(paste=lambda: clip["v"], copy=lambda v: clip.__setitem__("v", v))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-agent"))
import agent

a = agent.Agent("wss://x/ws/device", "dev_t", False)
try:
    a.handle("input.tap", {"x": 1, "y": 1}); raise SystemExit("FAIL: тап без скриншота должен отклоняться")
except RuntimeError: pass
shot = a.handle("screen.capture", {"maxSide": 1280})
assert (shot["width"], shot["height"]) == (1280, 800), shot["width"]
r = a.handle("input.tap", {"x": 640, "y": 400})
assert clicks[-1] == (720, 450), clicks            # центр скриншота → центр логического экрана (Retina 2x)
assert r["executed"] is True
a.handle("input.swipe", {"x": 0, "y": 0, "x2": 1279, "y2": 799})
assert clicks[-1] == ("drag", 1440 - 1, 900 - 1) or clicks[-1][1] >= 1438, clicks[-1]
a.handle("input.type", {"text": "Привет"}); assert clip["v"] == "старое", "буфер обмена восстановлен"
a.handle("input.key", {"key": "ctrl+s"}); assert hotkeys[-1] == ("ctrl", "s")
v = agent.Agent("wss://x", "dev_t", True); v.handle("screen.capture", {})
try:
    v.handle("input.tap", {"x": 1, "y": 1}); raise SystemExit("FAIL: view-only")
except RuntimeError: pass
assert "control" not in v.caps() and "control" in a.caps()
print("OK")
