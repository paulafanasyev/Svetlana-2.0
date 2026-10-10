"""Офлайн-модели: каталог, скачивание с процентами и отменой, возможности модели — против заглушки Ollama."""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
pulled = []
class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, o):
        b = json.dumps(o).encode(); self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == "/api/tags": return self._json({"models": [{"name": n} for n in ["qwen3:8b"] + pulled]})
        self.send_response(404); self.end_headers()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path == "/api/show":
            caps = {"qwen3:8b": ["completion", "tools"], "qwen3-vl:2b": ["completion", "vision", "tools"]}.get(body["model"])
            return self._json({"capabilities": caps}) if caps else (self.send_response(404), self.end_headers())
        if self.path == "/api/pull":
            self.send_response(200); self.send_header("Content-Type", "application/x-ndjson"); self.end_headers()
            if body["model"] == "bad:tag":
                self.wfile.write(b'{"status":"pulling manifest"}\n{"error":"pull model manifest: file does not exist"}\n'); return
            lines = [{"status": "pulling manifest"}] + [{"status": "pulling abc", "total": 1000, "completed": c} for c in (0, 250, 500, 1000)] + [{"status": "verifying sha256 digest"}, {"status": "success"}]
            try:
                for l in lines: self.wfile.write((json.dumps(l) + "\n").encode()); self.wfile.flush()
            except OSError: return  # клиент отменил скачивание
            pulled.append(body["model"])
srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake); threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["SVETLANA_OLLAMA"] = f"http://127.0.0.1:{srv.server_address[1]}"
sys.path.insert(0, os.environ.get("SVETLANA_AGENT_DIR") or os.path.join(HERE, "..", "desktop-agent"))
import models

# каталог: рекомендованная первая, у всех есть тег/размер, строка списка → тег, свой тег проходит как есть
assert models.CATALOG[0]["tag"] == "qwen3-vl:8b" and all(m["size"] and m["ram"] for m in models.CATALOG)
for m in models.CATALOG: assert models.tag_from_label(models.label(m)) == m["tag"]
assert models.tag_from_label("  llama3.2-vision:11b ") == "llama3.2-vision:11b"
assert "только разговор" in models.label(models.BY_TAG["qwen3:8b"])
# установленные и проверка наличия
assert models.installed() == ["qwen3:8b"] and models.has_model("qwen3:8b", ["qwen3:8b"]) and models.has_model("phi4", ["phi4:latest"])
assert not models.has_model("qwen3-vl:8b", ["qwen3:8b"])
# возможности: от Ollama, иначе из каталога
assert models.capabilities("qwen3:8b") == ["chat", "tools"], "без зрения"
assert models.capabilities("qwen3-vl:2b") == ["chat", "tools", "vision"]
assert models.capabilities("qwen3-vl:30b") == ["chat", "tools", "vision"], "Ollama не знает — берём каталог"
assert models.capabilities("unknown:1b") == ["chat", "tools"]
# скачивание: проценты растут до 100, после — модель в списке
seen = []
assert models.pull("qwen3-vl:2b", lambda p, st: seen.append(p)) is True
pcts = [p for p in seen if p >= 0]
assert pcts == sorted(pcts) and pcts[-1] == 100 and 50 in pcts, seen
assert models.has_model("qwen3-vl:2b", models.installed())
# ошибка Ollama доходит до пользователя, отмена останавливает
try: models.pull("bad:tag"); raise SystemExit("FAIL: ошибка должна подниматься")
except RuntimeError as e: assert "does not exist" in str(e)
ev = threading.Event(); ev.set()
try: models.pull("qwen3-vl:4b", cancel=ev); raise SystemExit("FAIL: отмена")
except RuntimeError as e: assert "отменено" in str(e)
# Ollama не отвечает
os.environ["SVETLANA_OLLAMA"] = "http://127.0.0.1:9"; models.OLLAMA = "http://127.0.0.1:9"
assert models.installed(timeout=1) is None
srv.shutdown()
print("OK")
